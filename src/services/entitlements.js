import { PLAN_DEFINITIONS } from '#config/plans.js';
import { getEffectivePlan } from '#utils/get-effective-plan.js';

const PLAN_ORDER = ['FREE', 'PRO', 'BUSINESS'];
const LOCK_NAMESPACE = 74102;

export function lockProviderEntitlements(db, providerId) {
    return db.query('SELECT pg_advisory_xact_lock($1, $2)', [
        LOCK_NAMESPACE,
        providerId,
    ]);
}

function mapPlan(row) {
    return {
        code: row.plan,
        priceNaira: row.priceNaira.toString(),
        commissionPercent: Number(row.commissionPercent),
        activeServices: row.activeServices,
        packagesPerService: row.packagesPerService,
        portfolioImages: row.portfolioImages,
        promotedSlotsPerMonth: row.promotedSlotsPerMonth,
        analytics: row.analytics,
        support: row.support,
    };
}

export async function getProviderPlan(db, providerId, now = new Date()) {
    const [subscriptionResult, currentPlansResult] = await Promise.all([
        db.query(
            `SELECT s.plan, s.status, s.plan_version AS "planVersion",
                    s.current_period_end AS "currentPeriodEnd",
                    s.grace_ends_at AS "graceEndsAt",
                    pv.plan AS "versionPlan",
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
        db.query(
            `SELECT plan, price_naira AS "priceNaira",
                    commission_percent AS "commissionPercent",
                    active_services AS "activeServices",
                    packages_per_service AS "packagesPerService",
                    portfolio_images AS "portfolioImages",
                    promoted_slots_per_month AS "promotedSlotsPerMonth",
                    analytics, support
             FROM plan_versions
             WHERE is_current = TRUE`
        ),
    ]);

    const currentPlans = Object.fromEntries(
        currentPlansResult.rows.map((row) => [row.plan, mapPlan(row)])
    );
    const freePlan = currentPlans.FREE;
    if (!freePlan) throw new Error('Current FREE plan definition is missing');

    const row = subscriptionResult.rows[0];
    if (!row) return { plan: freePlan, catalog: currentPlans };

    const subscription = {
        ...row,
        planDefinition: row.versionPlan
            ? { ...row, plan: row.versionPlan }
            : null,
    };
    const effectivePlan = getEffectivePlan(subscription, now);
    if (effectivePlan.code === 'FREE')
        return { plan: freePlan, catalog: currentPlans };

    return { plan: effectivePlan, catalog: currentPlans };
}

function planNeededFor(plan, limitName, projectedCount, catalog) {
    const currentIndex = PLAN_ORDER.indexOf(plan.code);
    for (const candidateCode of PLAN_ORDER.slice(currentIndex + 1)) {
        const candidate = catalog[candidateCode];
        const candidateLimit = candidate?.[limitName];
        if (
            candidate &&
            (candidateLimit === null || candidateLimit >= projectedCount)
        ) {
            return candidateCode;
        }
    }
    return null;
}

export function assertPlanLimit({
    plan,
    limitName,
    currentCount,
    requestedCount = 1,
    catalog = PLAN_DEFINITIONS,
}) {
    const limit = plan[limitName];
    if (limit === null || currentCount + requestedCount <= limit) return;

    const planNeeded = planNeededFor(
        plan,
        limitName,
        currentCount + requestedCount,
        catalog
    );
    const error = new Error(
        `Your ${plan.code} plan allows ${limit} ${limitName}`
    );
    Object.assign(error, {
        status: 403,
        code: 'PLAN_LIMIT_REACHED',
        limitName,
        limit,
        currentCount,
        requestedCount,
        planNeeded,
    });
    throw error;
}

export function assertCanCreateService(plan, currentCount, options = {}) {
    return assertPlanLimit({
        plan,
        limitName: 'activeServices',
        currentCount,
        ...options,
    });
}

export function assertCanAddPackage(plan, currentCount, options = {}) {
    return assertPlanLimit({
        plan,
        limitName: 'packagesPerService',
        currentCount,
        ...options,
    });
}

export function assertCanUploadPortfolioImage(
    plan,
    currentCount,
    options = {}
) {
    return assertPlanLimit({
        plan,
        limitName: 'portfolioImages',
        currentCount,
        ...options,
    });
}

export default {
    lockProviderEntitlements,
    getProviderPlan,
    assertCanCreateService,
    assertCanAddPackage,
    assertCanUploadPortfolioImage,
};
