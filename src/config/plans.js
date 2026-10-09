export const PLAN_DEFINITIONS = Object.freeze({
    FREE: Object.freeze({
        code: 'FREE',
        priceNaira: '0',
        commissionPercent: 15,
        activeServices: 3,
        packagesPerService: 1,
        portfolioImages: 5,
        promotedSlotsPerMonth: 0,
        analytics: 'none',
        support: 'standard',
    }),
    PRO: Object.freeze({
        code: 'PRO',
        priceNaira: '5000',
        commissionPercent: 10,
        activeServices: 15,
        packagesPerService: 3,
        portfolioImages: 25,
        promotedSlotsPerMonth: 1,
        analytics: 'basic',
        support: 'standard',
    }),
    BUSINESS: Object.freeze({
        code: 'BUSINESS',
        priceNaira: '15000',
        commissionPercent: 7,
        activeServices: null,
        packagesPerService: 3,
        portfolioImages: 100,
        promotedSlotsPerMonth: 5,
        analytics: 'full',
        support: 'priority',
    }),
});

export const UNLIMITED_LIMIT = null;
