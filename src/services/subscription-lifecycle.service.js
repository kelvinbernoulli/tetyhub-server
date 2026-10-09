import cron from 'node-cron';
import pool from '#services/pg_pool.js';
import { transaction } from '#utils/checkout.js';
import * as gatewayApi from '#utils/payment.js';
import { sendSubscriptionRenewalEmail } from '#models/mail.model.js';

const LIFECYCLE_LOCK_ID = 74105;

export async function disablePendingPlanRenewals({
    providerId,
    paymentApi = gatewayApi,
} = {}) {
    const { rows } = await pool.query(
        `SELECT s.id, s.provider_id, s.pending_plan, s.pending_plan_version,
                s.current_period_end, s.paystack_subscription_code,
                s.paystack_email_token,
                'plan-change-autorenew-disabled:' || s.id || ':' ||
                    s.pending_plan::text || ':' || s.pending_plan_version || ':' ||
                    EXTRACT(EPOCH FROM s.current_period_end)::bigint AS event_key
         FROM subscriptions s
         WHERE s.pending_plan IS NOT NULL AND s.cancel_at_period_end = TRUE
           AND s.current_period_end > NOW()
           AND s.paystack_subscription_code IS NOT NULL
           AND ($1::integer IS NULL OR s.provider_id = $1)
           AND NOT EXISTS (
               SELECT 1 FROM subscription_events e
               WHERE e.event_key =
                   'plan-change-autorenew-disabled:' || s.id || ':' ||
                   s.pending_plan::text || ':' || s.pending_plan_version || ':' ||
                   EXTRACT(EPOCH FROM s.current_period_end)::bigint
           )`,
        [providerId ?? null]
    );
    const failures = [];
    let disabled = 0;
    for (const subscription of rows) {
        if (!subscription.paystack_email_token) {
            console.error(
                'Unable to disable scheduled Paystack renewal:',
                subscription.provider_id,
                'Paystack subscription email token is unavailable'
            );
            failures.push({ providerId: subscription.provider_id });
            continue;
        }
        try {
            await paymentApi.disablePaystackSubscription({
                code: subscription.paystack_subscription_code,
                token: subscription.paystack_email_token,
            });
            await pool.query(
                `INSERT INTO subscription_events
                    (subscription_id, provider_id, type, event_key, meta)
                 VALUES ($1, $2, 'plan.change.autorenew_disabled', $3, $4::jsonb)
                 ON CONFLICT (event_key) DO NOTHING`,
                [
                    subscription.id,
                    subscription.provider_id,
                    subscription.event_key,
                    JSON.stringify({
                        pendingPlan: subscription.pending_plan,
                        pendingPlanVersion: subscription.pending_plan_version,
                        currentPeriodEnd: subscription.current_period_end,
                    }),
                ]
            );
            disabled += 1;
        } catch (error) {
            console.error(
                'Unable to disable scheduled Paystack renewal:',
                subscription.provider_id,
                error.message
            );
            failures.push({ providerId: subscription.provider_id });
        }
    }
    return { disabled, failures };
}

async function moveToFree(
    client,
    freePlanVersion,
    where,
    eventType,
    eventPrefix
) {
    const { rows } = await client.query(
        `WITH due AS (
            SELECT s.id, s.provider_id, s.plan, s.plan_version,
                   old_plan.id AS old_plan_version_id,
                   s.current_period_end, s.grace_ends_at
            FROM subscriptions s
            LEFT JOIN plan_versions old_plan
              ON old_plan.plan = s.plan AND old_plan.version = s.plan_version
            WHERE ${where}
            FOR UPDATE OF s
         ),
         changed AS (
            UPDATE subscriptions s
            SET plan = 'FREE', plan_version = $1, status = 'cancelled',
                current_period_start = NULL, current_period_end = NULL,
                grace_ends_at = NULL, cancel_at_period_end = FALSE,
                pending_plan = NULL, pending_plan_version = NULL,
                paystack_subscription_code = NULL,
                paystack_email_token = NULL,
                updated_at = NOW()
            FROM due d
            WHERE s.id = d.id
            RETURNING s.id, s.provider_id, d.plan AS previous_plan,
                      d.plan_version AS previous_plan_version,
                      d.old_plan_version_id, d.current_period_end,
                      d.grace_ends_at
         ),
         recorded AS (
            INSERT INTO subscription_events
                (subscription_id, provider_id, plan_version_id, type,
                 event_key, meta)
            SELECT c.id, c.provider_id, c.old_plan_version_id, $2,
                   $3 || ':' || c.id || ':' ||
                       COALESCE(EXTRACT(EPOCH FROM
                           COALESCE(c.current_period_end, c.grace_ends_at)
                       )::bigint, 0),
                   jsonb_build_object(
                       'fromPlan', c.previous_plan,
                       'fromVersion', c.previous_plan_version
                   )
            FROM changed c
            ON CONFLICT (event_key) DO NOTHING
            RETURNING provider_id
         )
         SELECT provider_id FROM changed`,
        [freePlanVersion, eventType, eventPrefix]
    );
    return rows.map((row) => row.provider_id);
}

async function deactivateExcessServices(client, providerIds, serviceLimits) {
    if (!providerIds.length) return [];
    const { rows } = await client.query(
        `WITH ranked_services AS (
            SELECT id, vendor_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY vendor_id
                       ORDER BY created_at DESC, id DESC
                   ) AS service_rank
            FROM services
            WHERE vendor_id = ANY($1::integer[])
              AND status = 'active' AND deleted_at IS NULL
         )
         UPDATE services s
         SET status = 'paused', updated_at = NOW()
         FROM ranked_services ranked
         JOIN unnest($1::integer[], $2::integer[])
              AS limits(vendor_id, service_limit)
           ON limits.vendor_id = ranked.vendor_id
         WHERE s.id = ranked.id AND ranked.service_rank > limits.service_limit
         RETURNING s.id, s.vendor_id`,
        [providerIds, providerIds.map((id) => serviceLimits.get(id))]
    );
    return rows;
}

async function sendRenewalReminders(client) {
    const { rows } = await client.query(
        `WITH due AS (
            SELECT s.id, s.provider_id, s.current_period_end,
                   s.plan, s.plan_version, s.pending_plan,
                   s.pending_plan_version
            FROM subscriptions s
            WHERE s.plan <> 'FREE' AND s.status IN ('active', 'cancelled')
              AND (s.cancel_at_period_end = FALSE
                   OR s.pending_plan IS NOT NULL)
              AND s.current_period_end > NOW() + INTERVAL '71 hours'
              AND s.current_period_end <= NOW() + INTERVAL '72 hours'
         ),
         recorded AS (
            INSERT INTO subscription_events
                (subscription_id, provider_id, plan_version_id, type,
                 event_key, meta)
            SELECT s.id, s.provider_id, pv.id, 'renewal.reminder',
                   'renewal-reminder:' || s.id || ':' ||
                       EXTRACT(EPOCH FROM s.current_period_end)::bigint,
                   jsonb_build_object(
                       'currentPeriodEnd', s.current_period_end,
                       'pendingPlan', s.pending_plan,
                       'pendingPlanVersion', s.pending_plan_version
                   )
            FROM due s
            JOIN plan_versions pv
              ON pv.plan = s.plan AND pv.version = s.plan_version
            ON CONFLICT (event_key) DO NOTHING
            RETURNING provider_id, meta, event_key
         ),
         notifications AS (
            INSERT INTO notifications (user_id, type, title, message, metadata)
            SELECT u.id, 'subscription_renewal',
                CASE WHEN recorded.meta->>'pendingPlan' IS NOT NULL
                     THEN 'Plan change requires checkout'
                     ELSE 'Subscription renewal coming up' END,
                CASE WHEN recorded.meta->>'pendingPlan' IS NOT NULL
                     THEN 'Your current Paystack renewal has been disabled. Complete checkout for your scheduled plan after this paid period ends.'
                     ELSE 'Your subscription renews in about 3 days. Review your plan and payment method.' END,
                jsonb_build_object(
                    'currentPeriodEnd', recorded.meta->>'currentPeriodEnd'
                )
         FROM recorded
         JOIN vendors v ON v.id = recorded.provider_id
         JOIN users u ON u.id = v.user_id
         WHERE u.status::text = 'active'
            RETURNING id
         ),
         queued AS (
            INSERT INTO subscription_renewal_emails
                (event_key, provider_id, user_id, recipient_email, firstname,
                 current_period_end, pending_plan)
            SELECT recorded.event_key, recorded.provider_id, u.id, u.email,
                   u.firstname, (recorded.meta->>'currentPeriodEnd')::timestamp,
                   NULLIF(recorded.meta->>'pendingPlan', '')::"SubscriptionPlan"
            FROM recorded
            JOIN vendors v ON v.id = recorded.provider_id
            JOIN users u ON u.id = v.user_id
            WHERE u.status::text = 'active' AND u.email IS NOT NULL
            ON CONFLICT (event_key) DO NOTHING
            RETURNING id
         )
         SELECT id FROM queued`,
        []
    );
    return rows.length;
}

export async function deliverSubscriptionRenewalEmail({
    sendEmail = sendSubscriptionRenewalEmail,
} = {}) {
    const { rows } = await pool.query(
        `WITH ready AS (
            SELECT id FROM subscription_renewal_emails
            WHERE (status = 'pending' AND available_at <= NOW())
               OR (status = 'processing' AND processing_until < NOW())
            ORDER BY id
            FOR UPDATE SKIP LOCKED
            LIMIT 10
         )
         UPDATE subscription_renewal_emails email
         SET status = 'processing', attempts = attempts + 1,
             processing_until = NOW() + INTERVAL '5 minutes'
         FROM ready
         WHERE email.id = ready.id
         RETURNING email.*`,
        []
    );
    let sent = 0;
    let failed = 0;
    for (const email of rows) {
        try {
            const delivered = await sendEmail(
                {
                    email: email.recipient_email,
                    firstname: email.firstname,
                },
                {
                    currentPeriodEnd: email.current_period_end,
                    pendingPlan: email.pending_plan,
                }
            );
            if (!delivered)
                throw new Error('Subscription renewal email delivery failed');
            await pool.query(
                `UPDATE subscription_renewal_emails
                 SET status = 'sent', sent_at = NOW(),
                     processing_until = NULL, last_error = NULL
                 WHERE id = $1`,
                [email.id]
            );
            sent += 1;
        } catch (error) {
            await pool.query(
                `UPDATE subscription_renewal_emails
                 SET status = CASE WHEN attempts >= 10
                                   THEN 'failed' ELSE 'pending' END,
                     available_at = NOW() + make_interval(secs =>
                         LEAST(3600, 30 * POWER(2, LEAST(attempts, 7)))),
                     processing_until = NULL, last_error = $2
                 WHERE id = $1`,
                [email.id, String(error.message).slice(0, 500)]
            );
            console.error(
                'Subscription renewal email queue delivery failed:',
                email.id,
                error.message
            );
            failed += 1;
        }
    }
    return { sent, failed };
}

export async function runSubscriptionLifecycle() {
    const lifecycle = await transaction(pool, async (client) => {
        const lock = await client.query(
            'SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired',
            [LIFECYCLE_LOCK_ID]
        );
        if (!lock.rows[0]?.acquired)
            return {
                skipped: true,
                pastDue: 0,
                lapsed: 0,
                deactivatedServices: 0,
                reminders: 0,
                renewalDisableFailures: 0,
            };

        const renewalDisables = await disablePendingPlanRenewals();
        const freePlan = (
            await client.query(
                `SELECT version, active_services
                 FROM plan_versions
                 WHERE plan = 'FREE' AND is_current = TRUE`
            )
        ).rows[0];
        if (!freePlan)
            throw new Error('Current FREE plan definition is missing');

        const freeProviders = await moveToFree(
            client,
            freePlan.version,
            `(s.status = 'trialing' AND s.pending_plan IS NULL
              OR s.pending_plan = 'FREE')
             AND s.current_period_end <= NOW()`,
            'subscription.free_applied',
            'subscription-free'
        );

        const pastDueResult = await client.query(
            `WITH due AS (
               SELECT id, provider_id, plan, plan_version, pending_plan,
                      pending_plan_version, current_period_end
                FROM subscriptions
                WHERE plan <> 'FREE' AND status IN ('active', 'cancelled')
                  AND current_period_end <= NOW()
                FOR UPDATE
             ),
             changed AS (
                UPDATE subscriptions s
                SET status = 'past_due',
                    grace_ends_at = d.current_period_end + INTERVAL '5 days',
                    updated_at = NOW()
                FROM due d
                WHERE s.id = d.id
                RETURNING s.id, s.provider_id, s.plan_version,
                          d.plan AS previous_plan, d.pending_plan,
                          d.pending_plan_version, d.current_period_end
             )
             INSERT INTO subscription_events
                (subscription_id, provider_id, plan_version_id, type,
                 event_key, meta)
             SELECT c.id, c.provider_id, pv.id, 'subscription.past_due',
                    'subscription-past-due:' || c.id || ':' ||
                        EXTRACT(EPOCH FROM c.current_period_end)::bigint,
                    jsonb_build_object(
                        'periodEndedAt', c.current_period_end,
                        'pendingPlan', c.pending_plan,
                        'pendingPlanVersion', c.pending_plan_version
                    )
             FROM changed c
             LEFT JOIN plan_versions pv
               ON pv.plan = c.previous_plan AND pv.version = c.plan_version
             ON CONFLICT (event_key) DO NOTHING
             RETURNING provider_id`
        );

        const lapsedProviders = await moveToFree(
            client,
            freePlan.version,
            `s.plan <> 'FREE' AND s.status = 'past_due'
             AND s.grace_ends_at <= NOW()`,
            'subscription.lapsed',
            'subscription-lapsed'
        );
        const serviceLimits = new Map([
            ...freeProviders.map((id) => [
                id,
                freePlan.active_services ?? 2147483647,
            ]),
            ...lapsedProviders.map((id) => [
                id,
                freePlan.active_services ?? 2147483647,
            ]),
        ]);
        const providersToAdjust = [...serviceLimits.keys()].sort(
            (left, right) => left - right
        );
        for (const providerId of providersToAdjust) {
            await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
                74102,
                providerId,
            ]);
        }
        const deactivated = providersToAdjust.length
            ? await deactivateExcessServices(
                  client,
                  providersToAdjust,
                  serviceLimits
              )
            : [];
        const reminders = await sendRenewalReminders(client);

        return {
            skipped: false,
            pastDue: pastDueResult.rowCount ?? 0,
            lapsed: lapsedProviders.length,
            deactivatedServices: deactivated.length,
            reminders,
            renewalDisableFailures: renewalDisables.failures.length,
        };
    });
    const emailDelivery = await deliverSubscriptionRenewalEmail();
    return { ...lifecycle, reminderEmails: emailDelivery };
}

export function startSubscriptionLifecycleJob() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const result = await runSubscriptionLifecycle();
            if (result.skipped)
                console.info(
                    'Subscription lifecycle job skipped; another worker holds the lock'
                );
        } catch (error) {
            console.error('Subscription lifecycle job failed:', error.message);
        } finally {
            running = false;
        }
    };
    const task = cron.schedule('0 * * * *', run);
    void run();
    return () => task.stop();
}
