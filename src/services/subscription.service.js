import pool from '#services/pg_pool.js';
import * as gatewayApi from '#utils/payment.js';
import { minorUnits, transaction } from '#utils/checkout.js';
import { PLAN_DEFINITIONS } from '#config/plans.js';
import { getEffectivePlan } from '#utils/get-effective-plan.js';
import { randomUUID } from 'node:crypto';
import { disablePendingPlanRenewals } from '#services/subscription-lifecycle.service.js';

const PLAN_ORDER = ['FREE', 'PRO', 'BUSINESS'];
const MONTHLY_PERIOD = 1;

function addMonths(date, months) {
    const value = new Date(date);
    const day = value.getUTCDate();
    value.setUTCDate(1);
    value.setUTCMonth(value.getUTCMonth() + months);
    const lastDay = new Date(
        Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)
    ).getUTCDate();
    value.setUTCDate(Math.min(day, lastDay));
    return value;
}

function eventMeta(row) {
    return typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta;
}

function publicSubscription(row) {
    if (!row) return row;
    const result = { ...row };
    delete result.paystack_email_token;
    delete result.paystack_subscription_code;
    delete result.paystack_customer_code;
    return result;
}

export class SubscriptionService {
    static gatewayApi = gatewayApi;

    static async getSubscription(providerId, now = new Date()) {
        const [subscriptionResult, plansResult] = await Promise.all([
            pool.query(
                `SELECT s.*, s.plan_version AS "planVersion",
                    s.current_period_end AS "currentPeriodEnd",
                    s.grace_ends_at AS "graceEndsAt",
                    pv.price_naira AS "priceNaira",
                    pv.commission_percent AS "commissionPercent",
                    pv.active_services AS "activeServices",
                    pv.packages_per_service AS "packagesPerService",
                    pv.portfolio_images AS "portfolioImages",
                    pv.promoted_slots_per_month AS "promotedSlotsPerMonth",
                    pv.analytics, pv.support
             FROM subscriptions s
             LEFT JOIN plan_versions pv
               ON pv.plan = s.plan AND pv.version = s.plan_version
             WHERE s.provider_id = $1`,
                [providerId]
            ),
            pool.query(
                `SELECT plan, version, price_naira AS "priceNaira",
                        commission_percent AS "commissionPercent",
                        active_services AS "activeServices",
                        packages_per_service AS "packagesPerService",
                        portfolio_images AS "portfolioImages",
                        promoted_slots_per_month AS "promotedSlotsPerMonth",
                        analytics, support
                 FROM plan_versions WHERE is_current = TRUE
                 ORDER BY CASE plan WHEN 'FREE' THEN 0 WHEN 'PRO' THEN 1 ELSE 2 END`
            ),
        ]);
        const row = subscriptionResult.rows[0] ?? null;
        const plans = plansResult.rows.map((plan) => ({
            ...plan,
            priceNaira: plan.priceNaira.toString(),
            commissionPercent: Number(plan.commissionPercent),
            analytics: plan.analytics.toLowerCase(),
            support: plan.support.toLowerCase(),
        }));
        const resolved = row
            ? getEffectivePlan(
                  {
                      ...row,
                      planDefinition:
                          row.priceNaira === null
                              ? null
                              : {
                                    plan: row.plan,
                                    ...row,
                                },
                  },
                  now
              )
            : null;
        const effectivePlan =
            resolved?.code === 'FREE' || !resolved
                ? (plans.find((plan) => plan.plan === 'FREE') ??
                  PLAN_DEFINITIONS.FREE)
                : resolved;
        if (!plans.some((plan) => plan.plan === 'FREE'))
            throw new Error('Current FREE plan definition is missing');
        if (!row) return { subscription: null, effectivePlan, plans };
        return {
            subscription: publicSubscription(row),
            effectivePlan,
            plans,
        };
    }

    static async startTrial(providerId) {
        return transaction(pool, async (client) => {
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
                providerId,
            ]);
            const existing = (
                await client.query(
                    'SELECT * FROM subscriptions WHERE provider_id = $1 FOR UPDATE',
                    [providerId]
                )
            ).rows[0];
            if (existing?.trial_used)
                throw Object.assign(
                    new Error('The PRO trial has already been used'),
                    {
                        status: 409,
                    }
                );
            const priorPaidSubscription = await client.query(
                `SELECT 1 FROM subscription_events
                 WHERE provider_id = $1
                   AND type IN ('payment.succeeded', 'payment.renewed')
                 LIMIT 1`,
                [providerId]
            );
            if (
                (existing && existing.plan !== 'FREE') ||
                priorPaidSubscription.rows.length
            )
                throw Object.assign(
                    new Error(
                        'The PRO trial is only available to providers who have not subscribed before'
                    ),
                    { status: 409 }
                );
            if (
                existing &&
                ['active', 'trialing'].includes(existing.status) &&
                existing.current_period_end &&
                new Date(existing.current_period_end) > new Date()
            )
                throw Object.assign(
                    new Error('A paid subscription or trial is already active'),
                    { status: 409 }
                );
            const pro = (
                await client.query(
                    `SELECT version FROM plan_versions
                     WHERE plan = 'PRO' AND is_current = TRUE`
                )
            ).rows[0];
            if (!pro) throw new Error('Current PRO plan definition is missing');
            const { rows } = await client.query(
                `INSERT INTO subscriptions
                    (provider_id, plan, plan_version, status,
                     current_period_start, current_period_end, trial_used)
                 VALUES ($1, 'PRO', $2, 'trialing', NOW(),
                         NOW() + INTERVAL '14 days', TRUE)
                 ON CONFLICT (provider_id) DO UPDATE SET
                    plan = 'PRO', plan_version = EXCLUDED.plan_version,
                    status = 'trialing', current_period_start = NOW(),
                    current_period_end = NOW() + INTERVAL '14 days',
                    grace_ends_at = NULL, cancel_at_period_end = FALSE,
                    pending_plan = NULL, pending_plan_version = NULL,
                    trial_used = TRUE, updated_at = NOW()
                 RETURNING *`,
                [providerId, pro.version]
            );
            await client.query(
                `INSERT INTO subscription_events
                    (subscription_id, provider_id, plan_version_id, type, meta)
                 SELECT $1, $2, id, 'trial.started', '{"durationDays":14}'::jsonb
                 FROM plan_versions WHERE plan = 'PRO' AND version = $3`,
                [rows[0].id, providerId, pro.version]
            );
            return publicSubscription(rows[0]);
        });
    }

    static async startCheckout(
        providerId,
        planCode,
        { renewalMode = 'automatic' } = {}
    ) {
        if (!['PRO', 'BUSINESS'].includes(planCode))
            throw Object.assign(new Error('Choose a paid plan'), {
                status: 400,
            });
        if (!['automatic', 'manual'].includes(renewalMode))
            throw Object.assign(new Error('Invalid renewal mode'), {
                status: 400,
            });

        const checkout = await transaction(pool, async (client) => {
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
                providerId,
            ]);
            const current = (
                await client.query(
                    'SELECT * FROM subscriptions WHERE provider_id = $1 FOR UPDATE',
                    [providerId]
                )
            ).rows[0];
            const currentRank = PLAN_ORDER.indexOf(current?.plan ?? 'FREE');
            const targetRank = PLAN_ORDER.indexOf(planCode);
            const periodIsCurrent =
                current?.current_period_end &&
                new Date(current.current_period_end) > new Date();
            if (current?.pending_plan && periodIsCurrent)
                throw Object.assign(
                    new Error(
                        'Checkout for the scheduled plan is available after the current paid period ends'
                    ),
                    { status: 409 }
                );
            if (
                current?.pending_plan &&
                !periodIsCurrent &&
                planCode !== current.pending_plan
            )
                throw Object.assign(
                    new Error(
                        `Renewal checkout must use the scheduled ${current.pending_plan} plan`
                    ),
                    { status: 409 }
                );
            if (
                periodIsCurrent &&
                targetRank === currentRank &&
                renewalMode === 'automatic' &&
                current.status !== 'trialing' &&
                !current.cancel_at_period_end
            )
                throw Object.assign(
                    new Error('The selected plan is already active'),
                    { status: 409 }
                );
            if (periodIsCurrent && targetRank < currentRank)
                throw Object.assign(
                    new Error(
                        'Downgrades must be scheduled for the next renewal'
                    ),
                    { status: 409 }
                );

            const version = (
                await client.query(
                    `SELECT id, version, price_naira, paystack_plan_code
                     FROM plan_versions
                     WHERE plan = $1 AND is_current = TRUE`,
                    [planCode]
                )
            ).rows[0];
            if (!version)
                throw new Error(
                    `Current ${planCode} plan definition is missing`
                );
            const provider = (
                await client.query(
                    `SELECT u.email FROM vendors v
                     JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
                    [providerId]
                )
            ).rows[0];
            if (!provider?.email)
                throw Object.assign(new Error('Provider account not found'), {
                    status: 404,
                });
            const reference = `SUB-${providerId}-${randomUUID()}`;
            const amountNaira = version.price_naira.toString();
            const metadata = {
                provider_id: String(providerId),
                plan: planCode,
                plan_version: String(version.version),
                renewal_mode: renewalMode,
                subscription_checkout: true,
            };
            const { rows } = await client.query(
                `INSERT INTO subscription_events
                    (subscription_id, provider_id, plan_version_id, type, event_key, meta)
                 VALUES ($1, $2, $3, 'checkout.initialized', $4, $5::jsonb)
                 RETURNING id`,
                [
                    current?.id ?? null,
                    providerId,
                    version.id,
                    `checkout:${reference}`,
                    JSON.stringify({
                        reference,
                        plan: planCode,
                        planVersion: version.version,
                        planVersionId: version.id,
                        amountNaira,
                        renewalMode,
                        status: 'pending',
                    }),
                ]
            );
            return {
                providerId,
                email: provider.email,
                planCode,
                planVersion: version.version,
                planVersionId: version.id,
                amountNaira,
                reference,
                metadata,
                renewalMode,
                paystackPlanCode: version.paystack_plan_code,
                eventId: rows[0].id,
            };
        });

        try {
            let paystackPlanCode = checkout.paystackPlanCode;
            if (checkout.renewalMode === 'automatic' && !paystackPlanCode) {
                const paystackPlan = await this.gatewayApi.createPaystackPlan({
                    name: `TetyHub ${checkout.planCode} v${checkout.planVersion}`,
                    amount: checkout.amountNaira,
                    interval: 'monthly',
                });
                paystackPlanCode = paystackPlan.plan_code;
                await pool.query(
                    `UPDATE plan_versions SET paystack_plan_code = COALESCE(paystack_plan_code, $1)
                     WHERE id = $2`,
                    [paystackPlanCode, checkout.planVersionId]
                );
                const saved = (
                    await pool.query(
                        'SELECT paystack_plan_code FROM plan_versions WHERE id = $1',
                        [checkout.planVersionId]
                    )
                ).rows[0];
                paystackPlanCode = saved.paystack_plan_code;
            }
            const result = await this.gatewayApi.initializePaystack({
                email: checkout.email,
                amount: checkout.amountNaira,
                reference: checkout.reference,
                currency: 'NGN',
                metadata: checkout.metadata,
                ...(checkout.renewalMode === 'automatic'
                    ? { planCode: paystackPlanCode, channels: ['card'] }
                    : {}),
            });
            return {
                reference: checkout.reference,
                authorization_url: result.authorization_url,
                plan: checkout.planCode,
                renewalMode: checkout.renewalMode,
            };
        } catch (error) {
            await pool.query(
                `UPDATE subscription_events SET type = 'checkout.initialization_failed',
                 meta = meta || '{"status":"failed"}'::jsonb WHERE id = $1`,
                [checkout.eventId]
            );
            throw error;
        }
    }

    static async scheduleDowngrade(providerId, planCode) {
        if (!PLAN_ORDER.includes(planCode))
            throw Object.assign(new Error('Invalid subscription plan'), {
                status: 400,
            });
        const subscription = await transaction(pool, async (client) => {
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
                providerId,
            ]);
            const current = (
                await client.query(
                    'SELECT * FROM subscriptions WHERE provider_id = $1 FOR UPDATE',
                    [providerId]
                )
            ).rows[0];
            if (!current || !current.current_period_end)
                throw Object.assign(
                    new Error(
                        'There is no paid period to schedule a downgrade for'
                    ),
                    { status: 409 }
                );
            if (
                PLAN_ORDER.indexOf(planCode) >= PLAN_ORDER.indexOf(current.plan)
            )
                throw Object.assign(
                    new Error('Choose a lower plan to schedule a downgrade'),
                    { status: 400 }
                );
            const version = (
                await client.query(
                    'SELECT version, id FROM plan_versions WHERE plan = $1 AND is_current = TRUE',
                    [planCode]
                )
            ).rows[0];
            if (!version)
                throw new Error(`Current ${planCode} plan is missing`);
            const { rows } = await client.query(
                `UPDATE subscriptions
                 SET pending_plan = $2, pending_plan_version = $3,
                     cancel_at_period_end = TRUE, updated_at = NOW()
                 WHERE provider_id = $1 RETURNING *`,
                [providerId, planCode, version.version]
            );
            await client.query(
                `INSERT INTO subscription_events
                    (subscription_id, provider_id, plan_version_id, type, meta)
                 VALUES ($1, $2, $3, 'downgrade.scheduled', $4::jsonb)`,
                [
                    current.id,
                    providerId,
                    version.id,
                    JSON.stringify({ plan: planCode }),
                ]
            );
            return publicSubscription(rows[0]);
        });
        const renewalCancellation = await disablePendingPlanRenewals({
            providerId,
            paymentApi: this.gatewayApi,
        });
        return {
            ...subscription,
            renewalCancellationPending: renewalCancellation.failures.length > 0,
        };
    }

    static async cancelAtPeriodEnd(providerId) {
        const current = (
            await pool.query(
                `SELECT id, paystack_subscription_code, paystack_email_token
                 FROM subscriptions
                 WHERE provider_id = $1 AND plan <> 'FREE'
                   AND status IN ('trialing', 'active', 'past_due')`,
                [providerId]
            )
        ).rows[0];
        if (!current)
            throw Object.assign(
                new Error('No active paid subscription was found'),
                { status: 404 }
            );
        if (current.paystack_subscription_code && current.paystack_email_token)
            await this.gatewayApi.disablePaystackSubscription({
                code: current.paystack_subscription_code,
                token: current.paystack_email_token,
            });
        else if (current.paystack_subscription_code)
            throw Object.assign(
                new Error('Paystack cancellation credentials are unavailable'),
                { status: 409 }
            );
        return transaction(pool, async (client) => {
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
                providerId,
            ]);
            const { rows } = await client.query(
                `UPDATE subscriptions
                 SET cancel_at_period_end = TRUE, pending_plan = NULL,
                     pending_plan_version = NULL, updated_at = NOW()
                 WHERE provider_id = $1 AND plan <> 'FREE'
                   AND status IN ('trialing', 'active', 'past_due')
                 RETURNING *`,
                [providerId]
            );
            if (!rows.length)
                throw Object.assign(
                    new Error('No active paid subscription was found'),
                    { status: 404 }
                );
            await client.query(
                `INSERT INTO subscription_events
                    (subscription_id, provider_id, type, meta)
                 VALUES ($1, $2, 'cancellation.scheduled', '{}'::jsonb)`,
                [rows[0].id, providerId]
            );
            return publicSubscription(rows[0]);
        });
    }

    static async handleChargeSuccess(data, eventId) {
        if (data.status !== 'success' || !data.reference)
            throw new Error('Paystack subscription charge is not successful');
        return transaction(pool, async (client) => {
            const checkoutResult = await client.query(
                `SELECT * FROM subscription_events
                 WHERE event_key = $1
                   AND type IN ('checkout.initialized', 'checkout.completed')
                 FOR UPDATE`,
                [`checkout:${data.reference}`]
            );
            if (!checkoutResult.rows.length) {
                const subscriptionCode =
                    data.subscription?.subscription_code ??
                    data.subscription_code;
                if (!subscriptionCode) return false;
                const subscription = (
                    await client.query(
                        `SELECT s.*, pv.id AS plan_version_id,
                                pv.price_naira
                         FROM subscriptions s
                         JOIN plan_versions pv
                           ON pv.plan = s.plan AND pv.version = s.plan_version
                         WHERE s.paystack_subscription_code = $1 FOR UPDATE`,
                        [subscriptionCode]
                    )
                ).rows[0];
                if (!subscription) return false;
                if (
                    Number(data.amount) !==
                        minorUnits(subscription.price_naira) ||
                    String(data.currency).toUpperCase() !== 'NGN'
                )
                    throw new Error('Paystack renewal amount mismatch');
                const inserted = await client.query(
                    `INSERT INTO subscription_events
                        (subscription_id, provider_id, plan_version_id, type,
                         event_key, meta)
                     VALUES ($1, $2, $3, 'payment.renewed', $4, '{}'::jsonb)
                     ON CONFLICT (event_key) DO NOTHING RETURNING id`,
                    [
                        subscription.id,
                        subscription.provider_id,
                        subscription.plan_version_id,
                        `paystack:${eventId}`,
                    ]
                );
                if (!inserted.rowCount) return true;
                const paidAt = data.paid_at
                    ? new Date(data.paid_at)
                    : new Date();
                const periodStart =
                    subscription.current_period_end &&
                    new Date(subscription.current_period_end) > paidAt
                        ? new Date(subscription.current_period_end)
                        : paidAt;
                await client.query(
                    `UPDATE subscriptions SET status = 'active',
                     current_period_start = $1, current_period_end = $2,
                     grace_ends_at = NULL, updated_at = NOW()
                     WHERE id = $3`,
                    [
                        periodStart,
                        addMonths(periodStart, MONTHLY_PERIOD),
                        subscription.id,
                    ]
                );
                return true;
            }
            const checkout = checkoutResult.rows[0];
            if (checkout.type === 'checkout.completed') return true;
            const meta = eventMeta(checkout);
            const planVersion = (
                await client.query(
                    `SELECT * FROM plan_versions WHERE id = $1`,
                    [meta.planVersionId]
                )
            ).rows[0];
            if (
                !planVersion ||
                Number(data.amount) !== minorUnits(planVersion.price_naira) ||
                String(data.currency).toUpperCase() !== 'NGN'
            )
                throw new Error(
                    'Paystack subscription payment amount mismatch'
                );
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
                checkout.provider_id,
            ]);
            const eventKey = `paystack:${eventId}`;
            const inserted = await client.query(
                `INSERT INTO subscription_events
                    (subscription_id, provider_id, plan_version_id, type, event_key, meta)
                 VALUES ($1, $2, $3, 'payment.succeeded', $4, $5::jsonb)
                 ON CONFLICT (event_key) DO NOTHING RETURNING id`,
                [
                    checkout.subscription_id,
                    checkout.provider_id,
                    planVersion.id,
                    eventKey,
                    JSON.stringify({ reference: data.reference }),
                ]
            );
            if (!inserted.rowCount) return true;

            const existing = (
                await client.query(
                    'SELECT * FROM subscriptions WHERE provider_id = $1 FOR UPDATE',
                    [checkout.provider_id]
                )
            ).rows[0];
            const newSubscriptionCode =
                data.subscription?.subscription_code ?? null;
            if (
                existing?.paystack_subscription_code &&
                existing.paystack_email_token &&
                (meta.renewalMode === 'manual' ||
                    (newSubscriptionCode &&
                        newSubscriptionCode !==
                            existing.paystack_subscription_code))
            )
                await this.gatewayApi.disablePaystackSubscription({
                    code: existing.paystack_subscription_code,
                    token: existing.paystack_email_token,
                });
            const paidAt = data.paid_at ? new Date(data.paid_at) : new Date();
            const currentEnd =
                meta.renewalMode === 'manual' &&
                existing?.current_period_end &&
                new Date(existing.current_period_end) > paidAt
                    ? new Date(existing.current_period_end)
                    : paidAt;
            const periodStart = currentEnd;
            const periodEnd = addMonths(periodStart, MONTHLY_PERIOD);
            const customerCode =
                data.customer?.customer_code ??
                existing?.paystack_customer_code ??
                null;
            const { rows } = await client.query(
                `INSERT INTO subscriptions
                    (provider_id, plan, plan_version, status,
                     current_period_start, current_period_end, trial_used,
                     paystack_customer_code, cancel_at_period_end,
                     pending_plan, pending_plan_version, grace_ends_at)
                 VALUES ($1, $2, $3, 'active', $4, $5, $6, $7, FALSE, NULL, NULL, NULL)
                 ON CONFLICT (provider_id) DO UPDATE SET
                    plan = EXCLUDED.plan, plan_version = EXCLUDED.plan_version,
                    status = 'active', current_period_start = $4,
                    current_period_end = $5, grace_ends_at = NULL,
                    cancel_at_period_end = FALSE,
                    pending_plan = NULL, pending_plan_version = NULL,
                    paystack_customer_code = COALESCE(EXCLUDED.paystack_customer_code,
                                                      subscriptions.paystack_customer_code),
                    paystack_subscription_code = CASE WHEN $8 = 'manual' THEN NULL
                        ELSE COALESCE(EXCLUDED.paystack_subscription_code,
                                      subscriptions.paystack_subscription_code) END,
                    paystack_email_token = CASE WHEN $8 = 'manual' THEN NULL
                        ELSE COALESCE(EXCLUDED.paystack_email_token,
                                      subscriptions.paystack_email_token) END,
                    trial_used = subscriptions.trial_used,
                    updated_at = NOW()
                 RETURNING *`,
                [
                    checkout.provider_id,
                    meta.plan,
                    meta.planVersion,
                    periodStart,
                    periodEnd,
                    existing?.trial_used ?? false,
                    customerCode,
                    meta.renewalMode,
                ]
            );
            await client.query(
                `UPDATE subscription_events
                 SET subscription_id = $1, type = 'checkout.completed',
                     meta = meta || '{"status":"paid"}'::jsonb
                 WHERE id = $2`,
                [rows[0].id, checkout.id]
            );
            if (data.subscription?.subscription_code)
                await client.query(
                    `UPDATE subscriptions SET paystack_subscription_code = $1,
                     paystack_email_token = $2, updated_at = NOW()
                     WHERE provider_id = $3`,
                    [
                        data.subscription.subscription_code,
                        data.subscription.email_token ?? null,
                        checkout.provider_id,
                    ]
                );
            return true;
        });
    }

    static async handleChargeFailed(data, eventId) {
        const subscriptionCode =
            data.subscription?.subscription_code ?? data.subscription_code;
        if (!subscriptionCode)
            throw new Error('Paystack invoice has no subscription code');
        return transaction(pool, async (client) => {
            let subscription = (
                await client.query(
                    `SELECT * FROM subscriptions
                     WHERE paystack_subscription_code = $1 FOR UPDATE`,
                    [subscriptionCode]
                )
            ).rows[0];
            if (!subscription) return;
            const inserted = await client.query(
                `INSERT INTO subscription_events
                    (subscription_id, provider_id, type, event_key, meta)
                 VALUES ($1, $2, 'payment.failed', $3, '{}'::jsonb)
                 ON CONFLICT (event_key) DO NOTHING RETURNING id`,
                [
                    subscription.id,
                    subscription.provider_id,
                    `paystack:${eventId}`,
                ]
            );
            if (!inserted.rowCount) return;
            await client.query(
                `UPDATE subscriptions
                 SET status = 'past_due',
                     grace_ends_at = COALESCE(grace_ends_at,
                         COALESCE(current_period_end, NOW()) +
                             INTERVAL '5 days'),
                     updated_at = NOW()
                 WHERE id = $1`,
                [subscription.id]
            );
        });
    }

    static async handleSubscriptionEvent(event) {
        const code = event.subscriptionCode;
        if (!code) return;
        return transaction(pool, async (client) => {
            const subscription = (
                await client.query(
                    `SELECT * FROM subscriptions
                     WHERE paystack_subscription_code = $1 FOR UPDATE`,
                    [code]
                )
            ).rows[0];
            if (!subscription && event.customerCode) {
                subscription = (
                    await client.query(
                        `SELECT * FROM subscriptions
                         WHERE paystack_customer_code = $1 FOR UPDATE`,
                        [event.customerCode]
                    )
                ).rows[0];
                if (subscription)
                    await client.query(
                        `UPDATE subscriptions SET paystack_subscription_code = $1,
                         updated_at = NOW() WHERE id = $2`,
                        [code, subscription.id]
                    );
            }
            if (!subscription && event.eventType !== 'subscription.create')
                return;
            if (!subscription)
                throw new Error(
                    'Paystack subscription has not been linked yet'
                );
            const inserted = await client.query(
                `INSERT INTO subscription_events
                    (subscription_id, provider_id, type, event_key, meta)
                 VALUES ($1, $2, $3, $4, $5::jsonb)
                 ON CONFLICT (event_key) DO NOTHING RETURNING id`,
                [
                    subscription.id,
                    subscription.provider_id,
                    `paystack.${event.eventType}`,
                    `paystack:${event.eventKey}`,
                    JSON.stringify({ status: event.eventStatus }),
                ]
            );
            if (!inserted.rowCount) return;
            if (event.eventType === 'subscription.not_renew') {
                await client.query(
                    'UPDATE subscriptions SET cancel_at_period_end = TRUE, updated_at = NOW() WHERE id = $1',
                    [subscription.id]
                );
            } else if (event.eventType === 'subscription.disable') {
                await client.query(
                    `UPDATE subscriptions SET status = 'cancelled',
                     cancel_at_period_end = TRUE, updated_at = NOW()
                     WHERE id = $1`,
                    [subscription.id]
                );
            } else if (event.eventType === 'subscription.create') {
                await client.query(
                    `UPDATE subscriptions SET paystack_customer_code = COALESCE($1,
                        paystack_customer_code), updated_at = NOW() WHERE id = $2`,
                    [event.customerCode, subscription.id]
                );
            }
        });
    }
}

export default SubscriptionService;
