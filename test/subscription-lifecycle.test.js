import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '#services/pg_pool.js';
import {
    deliverSubscriptionRenewalEmail,
    disablePendingPlanRenewals,
    runSubscriptionLifecycle,
} from '#services/subscription-lifecycle.service.js';

function mockPool(t, handler) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        return handler(sql, values) ?? { rows: [], rowCount: 0 };
    };
    t.mock.method(pool, 'query', query);
    t.mock.method(pool, 'connect', async () => ({
        query,
        release() {},
    }));
    return calls;
}

test('subscription lifecycle expires periods, lapses providers, deactivates excess services, and reminds once per period', async (t) => {
    const calls = mockPool(t, (sql, values) => {
        if (sql.includes('pg_try_advisory_xact_lock'))
            return { rows: [{ acquired: true }] };
        if (sql.includes("plan = 'FREE' AND is_current"))
            return { rows: [{ version: 2, active_services: 3 }] };
        if (values[2] === 'subscription-free')
            return { rows: [{ provider_id: 11 }] };
        if (values[2] === 'subscription-lapsed')
            return { rows: [{ provider_id: 12 }] };
        if (sql.includes("SET status = 'past_due'"))
            return { rows: [{ provider_id: 10 }], rowCount: 1 };
        if (sql.includes('UPDATE services s'))
            return { rows: [{ id: 100, vendor_id: 12 }] };
        if (sql.includes('renewal-reminder:'))
            return { rows: [{ user_id: 20 }], rowCount: 1 };
    });

    const result = await runSubscriptionLifecycle();

    assert.deepEqual(result, {
        skipped: false,
        pastDue: 1,
        lapsed: 1,
        deactivatedServices: 1,
        reminders: 1,
        renewalDisableFailures: 0,
        reminderEmails: { sent: 0, failed: 0 },
    });
    const pastDueSql = calls.find((call) =>
        call.sql.includes("SET status = 'past_due'")
    ).sql;
    assert.match(pastDueSql, /current_period_end \+ INTERVAL '5 days'/);
    assert.match(pastDueSql, /status IN \('active', 'cancelled'\)/);

    const serviceUpdate = calls.find((call) =>
        call.sql.includes('UPDATE services s')
    );
    assert.match(serviceUpdate.sql, /ORDER BY created_at DESC, id DESC/);
    assert.match(serviceUpdate.sql, /status = 'paused'/);
    assert.doesNotMatch(serviceUpdate.sql, /\bDELETE\b/i);
    assert.deepEqual(serviceUpdate.values, [
        [11, 12],
        [3, 3],
    ]);
    assert.ok(
        calls.some((call) => call.sql.includes('pg_advisory_xact_lock($1, $2)'))
    );

    const reminderSql = calls.find((call) =>
        call.sql.includes('renewal-reminder:')
    ).sql;
    assert.match(reminderSql, /INTERVAL '71 hours'/);
    assert.match(reminderSql, /INTERVAL '72 hours'/);
    assert.match(reminderSql, /ON CONFLICT \(event_key\) DO NOTHING/);
    assert.ok(calls.every((call) => !/\bUPDATE\s+payouts\b/i.test(call.sql)));
});

test('overlapping lifecycle workers skip without changing subscription or service data', async (t) => {
    const calls = mockPool(t, (sql) => {
        if (sql.includes('pg_try_advisory_xact_lock'))
            return { rows: [{ acquired: false }] };
    });

    const result = await runSubscriptionLifecycle();

    assert.deepEqual(result, {
        skipped: true,
        pastDue: 0,
        lapsed: 0,
        deactivatedServices: 0,
        reminders: 0,
        renewalDisableFailures: 0,
        reminderEmails: { sent: 0, failed: 0 },
    });
    assert.ok(
        calls.some((call) => call.sql.includes('pg_try_advisory_xact_lock'))
    );
    assert.ok(
        calls.some((call) =>
            call.sql.includes('UPDATE subscription_renewal_emails')
        )
    );
    assert.equal(
        calls.some((call) => call.sql.includes('UPDATE subscriptions')),
        false
    );
});

test('renewal email queue sends reminders and marks them delivered', async (t) => {
    const calls = mockPool(t, (sql) => {
        if (sql.includes('RETURNING email.*'))
            return {
                rows: [
                    {
                        id: 45,
                        recipient_email: 'provider@example.com',
                        firstname: 'Provider',
                        current_period_end: new Date('2026-12-01T00:00:00Z'),
                        pending_plan: null,
                    },
                ],
            };
    });
    const deliveredTo = [];

    const result = await deliverSubscriptionRenewalEmail({
        async sendEmail(user, subscription) {
            deliveredTo.push({ user, subscription });
            return true;
        },
    });

    assert.deepEqual(result, { sent: 1, failed: 0 });
    assert.deepEqual(deliveredTo, [
        {
            user: {
                email: 'provider@example.com',
                firstname: 'Provider',
            },
            subscription: {
                currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
                pendingPlan: null,
            },
        },
    ]);
    assert.ok(calls.some((call) => call.sql.includes("SET status = 'sent'")));
});

test('failed renewal email delivery is queued for retry with bounded attempts', async (t) => {
    const calls = mockPool(t, (sql) => {
        if (sql.includes('RETURNING email.*'))
            return {
                rows: [
                    {
                        id: 46,
                        recipient_email: 'provider@example.com',
                        firstname: 'Provider',
                        current_period_end: new Date('2026-12-01T00:00:00Z'),
                        pending_plan: 'PRO',
                        attempts: 2,
                    },
                ],
            };
    });

    const result = await deliverSubscriptionRenewalEmail({
        async sendEmail() {
            return false;
        },
    });

    assert.deepEqual(result, { sent: 0, failed: 1 });
    const retry = calls.find((call) =>
        call.sql.includes('SET status = CASE WHEN attempts >= 10')
    );
    assert.ok(retry);
    assert.match(retry.sql, /LEAST\(3600/);
    assert.match(retry.sql, /processing_until = NULL/);
});

test('scheduled plan changes disable the old Paystack recurring authorization once', async (t) => {
    const calls = mockPool(t, (sql) => {
        if (sql.includes('s.pending_plan IS NOT NULL'))
            return {
                rows: [
                    {
                        id: 7,
                        provider_id: 12,
                        pending_plan: 'PRO',
                        pending_plan_version: 2,
                        current_period_end: new Date('2026-12-01T00:00:00Z'),
                        paystack_subscription_code: 'SUB_OLD',
                        paystack_email_token: 'email-token',
                        event_key:
                            'plan-change-autorenew-disabled:7:PRO:2:1796083200',
                    },
                ],
            };
    });
    const disabled = [];
    const result = await disablePendingPlanRenewals({
        providerId: 12,
        paymentApi: {
            async disablePaystackSubscription(credentials) {
                disabled.push(credentials);
            },
        },
    });

    assert.deepEqual(result, { disabled: 1, failures: [] });
    assert.deepEqual(disabled, [
        {
            code: 'SUB_OLD',
            token: 'email-token',
        },
    ]);
    assert.ok(
        calls.some((call) =>
            call.sql.includes("'plan.change.autorenew_disabled'")
        )
    );
});

test('a scheduled paid downgrade enters grace while retaining its current plan until checkout', async (t) => {
    const calls = mockPool(t, (sql, values) => {
        if (sql.includes('pg_try_advisory_xact_lock'))
            return { rows: [{ acquired: true }] };
        if (sql.includes("plan = 'FREE' AND is_current"))
            return { rows: [{ version: 2, active_services: 3 }] };
        if (sql.includes('s.pending_plan IS NOT NULL')) return { rows: [] };
        if (sql.includes("SET status = 'past_due'"))
            return { rows: [{ provider_id: 13 }], rowCount: 1 };
    });

    const result = await runSubscriptionLifecycle();

    assert.equal(result.pastDue, 1);
    const pastDue = calls.find((call) =>
        call.sql.includes("SET status = 'past_due'")
    );
    assert.match(pastDue.sql, /current_period_end \+ INTERVAL '5 days'/);
    assert.match(pastDue.sql, /pending_plan_version/);
    assert.equal(
        calls.some((call) => call.sql.includes('UPDATE services s')),
        false
    );
});
