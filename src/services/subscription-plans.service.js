import pool from '#services/pg_pool.js';
import { transaction } from '#utils/checkout.js';
import * as gatewayApi from '#utils/payment.js';
import { disablePendingPlanRenewals } from '#services/subscription-lifecycle.service.js';

export async function listPlanVersions() {
    const { rows } = await pool.query(
        `SELECT plan, version, price_naira AS "priceNaira",
                commission_percent AS "commissionPercent",
                active_services AS "activeServices",
                packages_per_service AS "packagesPerService",
                portfolio_images AS "portfolioImages",
                promoted_slots_per_month AS "promotedSlotsPerMonth",
                analytics, support, is_current AS "isCurrent",
                created_at AS "createdAt"
         FROM plan_versions
         ORDER BY CASE plan WHEN 'FREE' THEN 0 WHEN 'PRO' THEN 1 ELSE 2 END,
                  version DESC`
    );
    return rows.map((row) => ({
        ...row,
        priceNaira: row.priceNaira.toString(),
        commissionPercent: Number(row.commissionPercent),
        analytics: row.analytics.toLowerCase(),
        support: row.support.toLowerCase(),
    }));
}

export async function publishPlanVersion(planCode, definition) {
    const published = await transaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [
            74103,
            planCode,
        ]);
        const version = (
            await client.query(
                `SELECT COALESCE(MAX(version), 0) + 1 AS version
                 FROM plan_versions WHERE plan = $1`,
                [planCode]
            )
        ).rows[0].version;
        await client.query(
            'UPDATE plan_versions SET is_current = FALSE WHERE plan = $1 AND is_current = TRUE',
            [planCode]
        );
        const plan = (
            await client.query(
                `INSERT INTO plan_versions
                    (plan, version, price_naira, commission_percent,
                     active_services, packages_per_service, portfolio_images,
                     promoted_slots_per_month, analytics, support, is_current)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE)
                 RETURNING id, plan, version, price_naira AS "priceNaira",
                           commission_percent AS "commissionPercent",
                           active_services AS "activeServices",
                           packages_per_service AS "packagesPerService",
                           portfolio_images AS "portfolioImages",
                           promoted_slots_per_month AS "promotedSlotsPerMonth",
                           analytics, support, is_current AS "isCurrent",
                           created_at AS "createdAt"`,
                [
                    planCode,
                    version,
                    definition.priceNaira,
                    definition.commissionPercent.toFixed(2),
                    definition.activeServices,
                    definition.packagesPerService,
                    definition.portfolioImages,
                    definition.promotedSlotsPerMonth,
                    definition.analytics,
                    definition.support,
                ]
            )
        ).rows[0];

        await client.query(
            `UPDATE subscriptions
             SET pending_plan_version = $2, cancel_at_period_end = TRUE,
                 updated_at = NOW()
             WHERE pending_plan = $1
               AND status IN ('trialing', 'active', 'past_due')`,
            [planCode, version]
        );
        await client.query(
            `UPDATE subscriptions
             SET pending_plan = $1, pending_plan_version = $2,
                 cancel_at_period_end = TRUE,
                 updated_at = NOW()
             WHERE plan = $1 AND pending_plan IS NULL
               AND status IN ('trialing', 'active', 'past_due')
               AND current_period_end > NOW()`,
            [planCode, version]
        );
        await client.query(
            `INSERT INTO subscription_events
                (subscription_id, provider_id, plan_version_id, type, meta)
             SELECT s.id, s.provider_id, $1, 'plan.version.scheduled',
                    jsonb_build_object('plan', $2, 'version', $3)
             FROM subscriptions s
             WHERE s.pending_plan = $2
               AND s.pending_plan_version = $3`,
            [plan.id, planCode, version]
        );
        return {
            ...plan,
            priceNaira: plan.priceNaira.toString(),
            commissionPercent: Number(plan.commissionPercent),
            analytics: plan.analytics.toLowerCase(),
            support: plan.support.toLowerCase(),
        };
    });
    const renewalCancellation = await disablePendingPlanRenewals({
        paymentApi: gatewayApi,
    });
    return {
        ...published,
        renewalCancellationPending: renewalCancellation.failures.map(
            (failure) => failure.providerId
        ),
    };
}
