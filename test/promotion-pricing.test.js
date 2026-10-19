import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculatePromotionPrice,
    getPlacementMultiplier,
    getSeasonMultiplier,
    getKeywordMultiplier,
} from '#services/promotion-pricing.service.js';

test('promotion pricing engine applies placement, duration, keyword and seasonal multipliers', () => {
    const result = calculatePromotionPrice({
        placement: 'HOMEPAGE_HERO',
        days: 14,
        baseDailyRate: 1000,
        keyword: 'luxury',
        season: 'peak',
        minTotalPrice: 1500,
        platformCommissionRate: 0.2,
    });

    assert.equal(getPlacementMultiplier('HOMEPAGE_HERO'), 2.5);
    assert.equal(getSeasonMultiplier('peak'), 1.2);
    assert.equal(getKeywordMultiplier('luxury'), 1.35);
    assert.equal(result.subtotal, 51030);
    assert.equal(result.platformFee, 10206);
    assert.equal(result.vendorPayout, 40824);
    assert.equal(result.finalPrice, 51030);
});
