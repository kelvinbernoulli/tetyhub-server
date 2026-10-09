import { PLAN_DEFINITIONS } from '../config/plans.js';

function isAfter(value, reference) {
    if (!value) return false;
    const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(timestamp) && timestamp > reference.getTime();
}

function getPlanSnapshot(subscription, planCode) {
    const snapshot = subscription.planDefinition;
    if (!snapshot || snapshot.plan !== planCode) {
        if (subscription.planVersion > 1) {
            throw new Error(
                `Plan version ${subscription.planVersion} must be loaded for ${planCode}`
            );
        }
        return PLAN_DEFINITIONS[planCode];
    }

    return {
        code: planCode,
        priceNaira: snapshot.priceNaira.toString(),
        commissionPercent: Number(snapshot.commissionPercent),
        activeServices: snapshot.activeServices,
        packagesPerService: snapshot.packagesPerService,
        portfolioImages: snapshot.portfolioImages,
        promotedSlotsPerMonth: snapshot.promotedSlotsPerMonth,
        analytics: snapshot.analytics.toLowerCase(),
        support: snapshot.support.toLowerCase(),
    };
}

export function getEffectivePlan(subscription, now = new Date()) {
    if (!subscription) return PLAN_DEFINITIONS.FREE;

    const planCode = subscription.plan;
    if (!Object.hasOwn(PLAN_DEFINITIONS, planCode)) {
        throw new RangeError(`Unknown subscription plan: ${planCode}`);
    }

    const status = subscription.status?.toUpperCase();
    const periodIsCurrent = isAfter(subscription.currentPeriodEnd, now);
    const isEntitled =
        (status === 'TRIALING' && periodIsCurrent) ||
        (status === 'ACTIVE' && periodIsCurrent) ||
        (status === 'CANCELLED' && periodIsCurrent) ||
        (status === 'PAST_DUE' && isAfter(subscription.graceEndsAt, now));

    return isEntitled
        ? getPlanSnapshot(subscription, planCode)
        : PLAN_DEFINITIONS.FREE;
}
