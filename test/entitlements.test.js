import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_DEFINITIONS } from '../src/config/plans.js';
import {
    assertCanAddPackage,
    assertCanCreateService,
    assertCanUploadPortfolioImage,
    getProviderPlan,
} from '../src/services/entitlements.js';

const entitlementChecks = [
    ['active services', assertCanCreateService, 'activeServices'],
    ['packages per service', assertCanAddPackage, 'packagesPerService'],
    ['portfolio images', assertCanUploadPortfolioImage, 'portfolioImages'],
];

for (const [label, assertLimit, limitName] of entitlementChecks) {
    test(`${label} allows counts below and at the plan limit`, () => {
        const plan = PLAN_DEFINITIONS.FREE;
        assert.doesNotThrow(() =>
            assertLimit(plan, plan[limitName] - 2)
        );
        assert.doesNotThrow(() =>
            assertLimit(plan, plan[limitName] - 1)
        );
    });

    test(`${label} rejects additions above the plan limit with upgrade details`, () => {
        const plan = PLAN_DEFINITIONS.FREE;
        assert.throws(
            () => assertLimit(plan, plan[limitName]),
            {
                status: 403,
                code: 'PLAN_LIMIT_REACHED',
                limitName,
                limit: plan[limitName],
                currentCount: plan[limitName],
                requestedCount: 1,
                planNeeded: 'PRO',
            }
        );
    });
}

test('portfolio image check accounts for multiple images in one upload', () => {
    assert.throws(
        () => assertCanUploadPortfolioImage(PLAN_DEFINITIONS.FREE, 4, {
            requestedCount: 2,
        }),
        {
            code: 'PLAN_LIMIT_REACHED',
            currentCount: 4,
            requestedCount: 2,
            planNeeded: 'PRO',
        }
    );
});

test('business plan has no active-service limit', () => {
    assert.doesNotThrow(() =>
        assertCanCreateService(PLAN_DEFINITIONS.BUSINESS, 100000)
    );
});

test('plan limit checks use the supplied current plan catalog', () => {
    const catalog = {
        FREE: { ...PLAN_DEFINITIONS.FREE, activeServices: 2 },
        PRO: { ...PLAN_DEFINITIONS.PRO, activeServices: 4 },
        BUSINESS: PLAN_DEFINITIONS.BUSINESS,
    };
    assert.throws(
        () =>
            assertCanCreateService(catalog.FREE, 2, {
                catalog,
            }),
        {
            code: 'PLAN_LIMIT_REACHED',
            planNeeded: 'PRO',
        }
    );
});

test('provider without a subscription uses the current database FREE plan', async () => {
    const db = {
        async query(sql) {
            if (sql.includes('FROM subscriptions s')) return { rows: [] };
            return {
                rows: [
                    {
                        plan: 'FREE',
                        priceNaira: '0.00',
                        commissionPercent: '15.00',
                        activeServices: 4,
                        packagesPerService: 1,
                        portfolioImages: 7,
                        promotedSlotsPerMonth: 0,
                        analytics: 'none',
                        support: 'standard',
                    },
                ],
            };
        },
    };

    const { plan } = await getProviderPlan(db, 10);
    assert.equal(plan.priceNaira, '0.00');
    assert.equal(plan.activeServices, 4);
    assert.equal(plan.portfolioImages, 7);
});

test('paid provider uses the subscription plan-version snapshot', async () => {
    const end = new Date('2026-11-09T10:00:00.000Z');
    const db = {
        async query(sql) {
            if (sql.includes('FROM subscriptions s')) {
                return {
                    rows: [
                        {
                            plan: 'PRO',
                            status: 'active',
                            planVersion: 1,
                            currentPeriodEnd: end,
                            graceEndsAt: null,
                            versionPlan: 'PRO',
                            priceNaira: '5000.00',
                            commissionPercent: '10.00',
                            activeServices: 15,
                            packagesPerService: 3,
                            portfolioImages: 25,
                            promotedSlotsPerMonth: 1,
                            analytics: 'basic',
                            support: 'standard',
                        },
                    ],
                };
            }
            return {
                rows: [
                    {
                        plan: 'FREE',
                        priceNaira: '0.00',
                        commissionPercent: '15.00',
                        activeServices: 3,
                        packagesPerService: 1,
                        portfolioImages: 5,
                        promotedSlotsPerMonth: 0,
                        analytics: 'none',
                        support: 'standard',
                    },
                    {
                        plan: 'PRO',
                        priceNaira: '6000.00',
                        commissionPercent: '9.50',
                        activeServices: 20,
                        packagesPerService: 4,
                        portfolioImages: 30,
                        promotedSlotsPerMonth: 2,
                        analytics: 'basic',
                        support: 'standard',
                    },
                ],
            };
        },
    };

    const { plan } = await getProviderPlan(
        db,
        10,
        new Date('2026-10-09T10:00:00.000Z')
    );
    assert.equal(plan.priceNaira, '5000.00');
    assert.equal(plan.commissionPercent, 10);
    assert.equal(plan.activeServices, 15);
});
