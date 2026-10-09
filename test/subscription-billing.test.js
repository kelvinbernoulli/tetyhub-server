import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '#services/pg_pool.js';
import SubscriptionService from '#services/subscription.service.js';
import { subscriptionCheckoutSchema } from '#schemas/subscription.schema.js';
import paystack from '#config/paystack.js';
import { createPaystackPlan, initializePaystack } from '#utils/payment.js';
import Payment from '#models/payment.model.js';
import { processPaystackEvent } from '#services/webhook.js';
import { publishPlanVersion } from '#services/subscription-plans.service.js';

function mockPool(t, queryHandler = () => undefined) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        const result = await queryHandler(sql, values);
        return result ?? { rows: [], rowCount: 1 };
    };
    t.mock.method(pool, 'query', query);
    t.mock.method(pool, 'connect', async () => ({
        query,
        release() {},
    }));
    return calls;
}

test('checkout validates paid plans and a valid renewal mode', () => {
    assert.equal(
        subscriptionCheckoutSchema.validate({
            plan: 'PRO',
            renewalMode: 'manual',
        }).error,
        undefined
    );
    assert.ok(
        subscriptionCheckoutSchema.validate({
            plan: 'FREE',
        }).error
    );
    assert.ok(
        subscriptionCheckoutSchema.validate({
            plan: 'BUSINESS',
            extra: true,
        }).error
    );
});

test('Paystack plan and transaction amounts are converted from naira to integer kobo', async (t) => {
    const post = t.mock.method(paystack, 'post', async () => ({
        data: {
            status: true,
            data: {
                plan_code: 'PLN_PRO',
                authorization_url: 'https://paystack.test/checkout',
            },
        },
    }));
    await createPaystackPlan({
        name: 'PRO',
        amount: '5000.00',
        interval: 'monthly',
    });
    await initializePaystack({
        email: 'provider@example.com',
        amount: '5000.00',
        reference: 'SUB-1-reference',
        currency: 'NGN',
        planCode: 'PLN_PRO',
    });
    assert.equal(post.mock.calls[0].arguments[1].amount, 500000);
    assert.equal(post.mock.calls[1].arguments[1].amount, 500000);
});

test('automatic checkout uses a versioned Paystack plan and restricts payment to card', async (t) => {
    const calls = mockPool(t, (sql) => {
        if (sql.includes('FROM subscriptions WHERE provider_id'))
            return { rows: [] };
        if (sql.includes('FROM plan_versions') && sql.includes('is_current'))
            return {
                rows: [
                    {
                        id: 22,
                        version: 3,
                        price_naira: '5000.00',
                        paystack_plan_code: null,
                    },
                ],
            };
        if (sql.includes('FROM vendors v'))
            return { rows: [{ email: 'provider@example.com' }] };
        if (sql.startsWith('INSERT INTO subscription_events'))
            return { rows: [{ id: 41 }] };
        if (sql.includes('SELECT paystack_plan_code'))
            return { rows: [{ paystack_plan_code: 'PLN_PRO_3' }] };
    });
    const original = SubscriptionService.gatewayApi;
    const providerRequests = [];
    SubscriptionService.gatewayApi = {
        async createPaystackPlan(args) {
            providerRequests.push({ type: 'plan', args });
            return { plan_code: 'PLN_PRO_3' };
        },
        async initializePaystack(args) {
            providerRequests.push({ type: 'initialize', args });
            return { authorization_url: 'https://paystack.test/checkout' };
        },
    };
    t.after(() => {
        SubscriptionService.gatewayApi = original;
    });

    const result = await SubscriptionService.startCheckout(8, 'PRO');
    assert.equal(result.authorization_url, 'https://paystack.test/checkout');
    assert.deepEqual(providerRequests[0], {
        type: 'plan',
        args: {
            name: 'TetyHub PRO v3',
            amount: '5000.00',
            interval: 'monthly',
        },
    });
    assert.equal(providerRequests[1].args.planCode, 'PLN_PRO_3');
    assert.deepEqual(providerRequests[1].args.channels, ['card']);
    assert.equal(providerRequests[1].args.currency, 'NGN');
    assert.ok(
        calls.some((call) =>
            call.sql.startsWith('INSERT INTO subscription_events')
        )
    );
});

test('manual renewal checkout does not create or attach an auto-renewing plan', async (t) => {
    mockPool(t, (sql) => {
        if (sql.includes('FROM subscriptions WHERE provider_id'))
            return { rows: [] };
        if (sql.includes('FROM plan_versions') && sql.includes('is_current'))
            return {
                rows: [
                    {
                        id: 22,
                        version: 3,
                        price_naira: '5000.00',
                        paystack_plan_code: null,
                    },
                ],
            };
        if (sql.includes('FROM vendors v'))
            return { rows: [{ email: 'provider@example.com' }] };
        if (sql.startsWith('INSERT INTO subscription_events'))
            return { rows: [{ id: 41 }] };
    });
    const original = SubscriptionService.gatewayApi;
    let initialized;
    SubscriptionService.gatewayApi = {
        async createPaystackPlan() {
            assert.fail('manual renewal must not create a recurring plan');
        },
        async initializePaystack(args) {
            initialized = args;
            return { authorization_url: 'https://paystack.test/renew' };
        },
    };
    t.after(() => {
        SubscriptionService.gatewayApi = original;
    });
    const result = await SubscriptionService.startCheckout(8, 'PRO', {
        renewalMode: 'manual',
    });
    assert.equal(result.renewalMode, 'manual');
    assert.equal(Object.hasOwn(initialized, 'planCode'), false);
    assert.equal(Object.hasOwn(initialized, 'channels'), false);
});

test('a pending paid plan can only be checked out after period end and must match the scheduled plan', async (t) => {
    mockPool(t, (sql) => {
        if (sql.includes('FROM subscriptions WHERE provider_id'))
            return {
                rows: [
                    {
                        id: 6,
                        plan: 'BUSINESS',
                        status: 'past_due',
                        pending_plan: 'PRO',
                        current_period_end: new Date(
                            '2026-10-08T10:00:00.000Z'
                        ),
                    },
                ],
            };
    });
    await assert.rejects(
        SubscriptionService.startCheckout(8, 'BUSINESS'),
        /scheduled PRO plan/
    );
});

test('a provider can start a 14-day trial once and the trial is audited', async (t) => {
    const calls = mockPool(t, (sql) => {
        if (sql.includes('FROM subscriptions WHERE provider_id'))
            return { rows: [] };
        if (sql.includes('FROM subscription_events') && sql.includes('LIMIT 1'))
            return { rows: [] };
        if (sql.includes("WHERE plan = 'PRO' AND is_current"))
            return { rows: [{ version: 3 }] };
        if (sql.startsWith('INSERT INTO subscriptions'))
            return {
                rows: [
                    {
                        id: 6,
                        provider_id: 8,
                        plan: 'PRO',
                        plan_version: 3,
                        status: 'trialing',
                        paystack_email_token: 'secret-token',
                    },
                ],
            };
    });
    const result = await SubscriptionService.startTrial(8);
    assert.equal(result.status, 'trialing');
    assert.equal(Object.hasOwn(result, 'paystack_email_token'), false);
    assert.ok(
        calls.some((call) => call.sql.includes("NOW() + INTERVAL '14 days'"))
    );
    assert.ok(calls.some((call) => call.sql.includes("'trial.started'")));
});

test('downgrades are stored as pending plan changes rather than applied immediately', async (t) => {
    const calls = mockPool(t, (sql, values) => {
        if (sql.includes('SELECT * FROM subscriptions WHERE provider_id'))
            return {
                rows: [
                    {
                        id: 6,
                        provider_id: 8,
                        plan: 'BUSINESS',
                        current_period_end: new Date(
                            '2026-11-09T10:00:00.000Z'
                        ),
                    },
                ],
            };
        if (sql.includes('SELECT version, id FROM plan_versions'))
            return { rows: [{ version: 1, id: 3 }] };
        if (sql.startsWith('UPDATE subscriptions'))
            return {
                rows: [
                    {
                        id: 6,
                        plan: 'BUSINESS',
                        pending_plan: 'PRO',
                        pending_plan_version: 1,
                    },
                ],
            };
    });
    const result = await SubscriptionService.scheduleDowngrade(8, 'PRO');
    assert.equal(result.plan, 'BUSINESS');
    assert.equal(result.pending_plan, 'PRO');
    const update = calls.find((call) =>
        call.sql.startsWith('UPDATE subscriptions')
    );
    assert.match(update.sql, /cancel_at_period_end = TRUE/);
    assert.equal(result.renewalCancellationPending, false);
});

test('failed renewals preserve grace through five days after the paid period ends', async (t) => {
    const calls = mockPool(t, (sql) => {
        if (sql.includes('WHERE paystack_subscription_code = $1'))
            return {
                rows: [
                    {
                        id: 6,
                        provider_id: 8,
                        current_period_end: new Date(
                            '2026-11-09T10:00:00.000Z'
                        ),
                    },
                ],
            };
        if (sql.startsWith('INSERT INTO subscription_events'))
            return { rowCount: 1, rows: [{ id: 55 }] };
    });

    await SubscriptionService.handleChargeFailed(
        { subscription_code: 'SUB_CODE' },
        'invoice-failed-1'
    );

    const update = calls.find((call) =>
        call.sql.includes("SET status = 'past_due'")
    );
    assert.match(
        update.sql,
        /COALESCE\(current_period_end, NOW\(\)\)\s*\+\s*INTERVAL '5 days'/
    );
});

test('admin plan edits publish a new version and schedule it without mutating the current snapshot', async (t) => {
    const calls = mockPool(t, (sql) => {
        if (sql.includes('COALESCE(MAX(version)'))
            return { rows: [{ version: 4 }] };
        if (sql.startsWith('INSERT INTO plan_versions'))
            return {
                rows: [
                    {
                        id: 42,
                        plan: 'PRO',
                        version: 4,
                        priceNaira: '6000.00',
                        commissionPercent: '9.00',
                        activeServices: 18,
                        packagesPerService: 4,
                        portfolioImages: 30,
                        promotedSlotsPerMonth: 2,
                        analytics: 'basic',
                        support: 'standard',
                        isCurrent: true,
                    },
                ],
            };
    });
    const result = await publishPlanVersion('PRO', {
        priceNaira: '6000',
        commissionPercent: 9,
        activeServices: 18,
        packagesPerService: 4,
        portfolioImages: 30,
        promotedSlotsPerMonth: 2,
        analytics: 'basic',
        support: 'standard',
    });
    assert.equal(result.version, 4);
    assert.equal(result.commissionPercent, 9);
    assert.ok(
        calls.some((call) =>
            call.sql.includes(
                'SET pending_plan = $1, pending_plan_version = $2'
            )
        )
    );
    assert.ok(
        calls.some((call) =>
            call.sql.startsWith('INSERT INTO subscription_events')
        )
    );
    assert.ok(
        calls.some((call) => call.sql.includes('cancel_at_period_end = TRUE'))
    );
});

test('verified subscription checkout snapshots the paid plan and period', async (t) => {
    const checkout = {
        id: 41,
        provider_id: 8,
        subscription_id: null,
        type: 'checkout.initialized',
        event_key: 'checkout:SUB-8-example',
        meta: {
            plan: 'PRO',
            planVersion: 3,
            planVersionId: 22,
            renewalMode: 'manual',
        },
    };
    const calls = mockPool(t, (sql) => {
        if (
            sql.includes('FROM subscription_events') &&
            sql.includes('FOR UPDATE')
        )
            return { rows: [checkout] };
        if (sql.includes('FROM plan_versions WHERE id'))
            return { rows: [{ id: 22, price_naira: '5000.00' }] };
        if (sql.includes('INSERT INTO subscription_events'))
            return { rows: [{ id: 45 }], rowCount: 1 };
        if (sql.includes('SELECT * FROM subscriptions WHERE provider_id'))
            return { rows: [] };
        if (sql.startsWith('INSERT INTO subscriptions'))
            return {
                rows: [
                    {
                        id: 6,
                        provider_id: 8,
                        plan: 'PRO',
                        plan_version: 3,
                        status: 'active',
                    },
                ],
            };
    });
    const applied = await SubscriptionService.handleChargeSuccess(
        {
            id: 91,
            reference: 'SUB-8-example',
            status: 'success',
            amount: 500000,
            currency: 'NGN',
            paid_at: '2026-10-09T10:00:00.000Z',
            customer: { customer_code: 'CUS_123' },
        },
        'charge.success:91'
    );
    assert.equal(applied, true);
    const update = calls.find((call) =>
        call.sql.startsWith('INSERT INTO subscriptions')
    );
    assert.equal(update.values[1], 'PRO');
    assert.equal(update.values[2], 3);
    assert.equal(
        +update.values[4] - +update.values[3],
        31 * 24 * 60 * 60 * 1000
    );
    assert.ok(
        calls.some((call) => call.sql.includes("type = 'checkout.completed'"))
    );
});

test('manual renewal extends from the existing paid period end', async (t) => {
    const paidPeriodEnd = new Date('2026-11-09T10:00:00.000Z');
    const checkout = {
        id: 41,
        provider_id: 8,
        subscription_id: 6,
        type: 'checkout.initialized',
        event_key: 'checkout:SUB-8-renewal',
        meta: {
            plan: 'PRO',
            planVersion: 3,
            planVersionId: 22,
            renewalMode: 'manual',
        },
    };
    const calls = mockPool(t, (sql) => {
        if (
            sql.includes('FROM subscription_events') &&
            sql.includes('FOR UPDATE')
        )
            return { rows: [checkout] };
        if (sql.includes('FROM plan_versions WHERE id'))
            return { rows: [{ id: 22, price_naira: '5000.00' }] };
        if (sql.includes('INSERT INTO subscription_events'))
            return { rows: [{ id: 45 }], rowCount: 1 };
        if (sql.includes('SELECT * FROM subscriptions WHERE provider_id'))
            return {
                rows: [
                    {
                        id: 6,
                        provider_id: 8,
                        plan: 'PRO',
                        current_period_end: paidPeriodEnd,
                        trial_used: false,
                        paystack_subscription_code: null,
                    },
                ],
            };
        if (sql.startsWith('INSERT INTO subscriptions'))
            return { rows: [{ id: 6 }] };
    });
    await SubscriptionService.handleChargeSuccess(
        {
            reference: 'SUB-8-renewal',
            status: 'success',
            amount: 500000,
            currency: 'NGN',
            paid_at: '2026-10-09T10:00:00.000Z',
        },
        'charge.success:92'
    );
    const update = calls.find((call) =>
        call.sql.startsWith('INSERT INTO subscriptions')
    );
    assert.equal(+update.values[3], +paidPeriodEnd);
    assert.equal(+update.values[4], +new Date('2026-12-09T10:00:00.000Z'));
});

test('Paystack charge events are verified before subscription activation', async (t) => {
    const originalGateway = Payment.gatewayApi;
    const calls = [];
    Payment.gatewayApi = {
        async verifyPaystack(reference) {
            calls.push(['verify', reference]);
            return {
                reference,
                status: 'success',
                amount: 500000,
                currency: 'NGN',
            };
        },
    };
    t.after(() => {
        Payment.gatewayApi = originalGateway;
    });
    t.mock.method(
        SubscriptionService,
        'handleChargeSuccess',
        async (verified, eventKey) => {
            calls.push(['activate', verified.status, eventKey]);
            return true;
        }
    );
    t.mock.method(Payment, 'settle', async () =>
        assert.fail('subscription charge must not settle as a product order')
    );

    await processPaystackEvent({
        event_type: 'charge.success',
        event_key: 'charge.success:91',
        reference: 'SUB-8-reference',
    });
    assert.deepEqual(calls, [
        ['verify', 'SUB-8-reference'],
        ['activate', 'success', 'charge.success:91'],
    ]);
});

test('subscription response omits Paystack email token and exposes database plan prices', async (t) => {
    mockPool(t, (sql) => {
        if (sql.includes('FROM subscriptions s'))
            return {
                rows: [
                    {
                        id: 6,
                        provider_id: 8,
                        plan: 'PRO',
                        planVersion: 3,
                        status: 'active',
                        currentPeriodEnd: new Date(Date.now() + 86400000),
                        graceEndsAt: null,
                        priceNaira: '5000.00',
                        commissionPercent: '10.00',
                        activeServices: 15,
                        packagesPerService: 3,
                        portfolioImages: 25,
                        promotedSlotsPerMonth: 1,
                        analytics: 'basic',
                        support: 'standard',
                        paystack_email_token: 'never-return-this',
                    },
                ],
            };
        return {
            rows: ['FREE', 'PRO', 'BUSINESS'].map((plan, index) => ({
                plan,
                version: 1,
                priceNaira: ['0.00', '5000.00', '15000.00'][index],
                commissionPercent: [15, 10, 7][index],
                activeServices: [3, 15, null][index],
                packagesPerService: [1, 3, 3][index],
                portfolioImages: [5, 25, 100][index],
                promotedSlotsPerMonth: [0, 1, 5][index],
                analytics: ['none', 'basic', 'full'][index],
                support: ['standard', 'standard', 'priority'][index],
            })),
        };
    });
    const result = await SubscriptionService.getSubscription(8);
    assert.equal(result.effectivePlan.commissionPercent, 10);
    assert.equal(result.plans[2].priceNaira, '15000.00');
    assert.equal(
        Object.hasOwn(result.subscription, 'paystack_email_token'),
        false
    );
});
