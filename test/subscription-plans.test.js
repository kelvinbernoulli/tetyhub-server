import test from 'node:test';
import assert from 'node:assert/strict';
import { PLAN_DEFINITIONS } from '../src/config/plans.js';
import { getEffectivePlan } from '../src/utils/get-effective-plan.js';

const now = new Date('2026-10-09T10:00:00.000Z');
const future = new Date('2026-11-09T10:00:00.000Z');
const past = new Date('2026-10-08T10:00:00.000Z');

test('plan definitions use naira amounts and null for unlimited service count', () => {
    assert.deepEqual(
        Object.fromEntries(
            Object.entries(PLAN_DEFINITIONS).map(([code, plan]) => [
                code,
                [
                    plan.priceNaira,
                    plan.commissionPercent,
                    plan.activeServices,
                    plan.packagesPerService,
                    plan.portfolioImages,
                    plan.promotedSlotsPerMonth,
                ],
            ])
        ),
        {
            FREE: ['0', 15, 3, 1, 5, 0],
            PRO: ['5000', 10, 15, 3, 25, 1],
            BUSINESS: ['15000', 7, null, 3, 100, 5],
        }
    );
});

test('providers without a subscription receive FREE', () => {
    assert.equal(getEffectivePlan(null, now), PLAN_DEFINITIONS.FREE);
});

test('trial and active subscriptions receive their plan through period end', () => {
    for (const status of ['TRIALING', 'ACTIVE']) {
        assert.equal(
            getEffectivePlan(
                { plan: 'PRO', status, currentPeriodEnd: future },
                now
            ).code,
            'PRO'
        );
    }
});

test('past-due subscription keeps its plan only during the grace period', () => {
    assert.equal(
        getEffectivePlan(
            { plan: 'PRO', status: 'PAST_DUE', currentPeriodEnd: past, graceEndsAt: future },
            now
        ).code,
        'PRO'
    );
    assert.equal(
        getEffectivePlan(
            { plan: 'PRO', status: 'PAST_DUE', currentPeriodEnd: past, graceEndsAt: past },
            now
        ).code,
        'FREE'
    );
});

test('cancelled subscription keeps its plan until the paid period ends', () => {
    assert.equal(
        getEffectivePlan(
            {
                plan: 'PRO',
                status: 'CANCELLED',
                currentPeriodEnd: future,
                cancelAtPeriodEnd: true,
            },
            now
        ).code,
        'PRO'
    );
    assert.equal(
        getEffectivePlan(
            { plan: 'PRO', status: 'CANCELLED', currentPeriodEnd: past },
            now
        ).code,
        'FREE'
    );
});

test('expired trial and active periods fall back to FREE', () => {
    for (const status of ['TRIALING', 'ACTIVE']) {
        assert.equal(
            getEffectivePlan(
                { plan: 'PRO', status, currentPeriodEnd: past },
                now
            ).code,
            'FREE'
        );
    }
});

test('current plan version snapshot supplies the entitled limits and commission', () => {
    const plan = getEffectivePlan(
        {
            plan: 'PRO',
            status: 'ACTIVE',
            currentPeriodEnd: future,
            planDefinition: {
                plan: 'PRO',
                priceNaira: '6000',
                commissionPercent: '9.50',
                activeServices: 20,
                packagesPerService: 4,
                portfolioImages: 30,
                promotedSlotsPerMonth: 2,
                analytics: 'BASIC',
                support: 'STANDARD',
            },
        },
        now
    );

    assert.equal(plan.priceNaira, '6000');
    assert.equal(plan.commissionPercent, 9.5);
    assert.equal(plan.activeServices, 20);
});

test('unknown plan code is rejected', () => {
    assert.throws(
        () => getEffectivePlan({ plan: 'ENTERPRISE', status: 'ACTIVE' }, now),
        RangeError
    );
});
