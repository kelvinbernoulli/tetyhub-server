import test from 'node:test';
import assert from 'node:assert/strict';
import {
    canCreatePayoutBatch,
    normalizePayoutPreferences,
} from '#services/vendor-payout.service.js';

test('manual payout mode permits vendor-requested batches only', () => {
    assert.equal(canCreatePayoutBatch({ payout_mode: 'manual' }, { onDemand: true }), true);
    assert.equal(canCreatePayoutBatch({ payout_mode: 'manual' }), false);
    assert.equal(canCreatePayoutBatch({ payout_mode: 'automatic', next_payout_at: new Date(0) }, { onDemand: true }), false);
});

test('automatic payout batches are allowed only at or after the saved due time', () => {
    const now = new Date('2026-11-21T12:00:00.000Z');
    assert.equal(canCreatePayoutBatch({ payout_mode: 'automatic', next_payout_at: '2026-11-21T11:59:00.000Z' }, { now }), true);
    assert.equal(canCreatePayoutBatch({ payout_mode: 'automatic', next_payout_at: '2026-11-21T12:01:00.000Z' }, { now }), false);
    assert.equal(canCreatePayoutBatch({ payout_mode: 'automatic', next_payout_at: null }, { now }), false);
});

test('payout preferences accept manual or automatic mode with the supported intervals', () => {
    const current = { payout_mode: 'manual', payout_cadence: 'weekly' };
    assert.deepEqual(
        normalizePayoutPreferences(current, { payoutMode: 'automatic', payoutCadence: 'bi_weekly' }),
        {
            payoutMode: 'automatic',
            payoutCadence: 'bi_weekly',
            minimumPayoutMinor: undefined,
            resetSchedule: true,
        }
    );
    assert.equal(normalizePayoutPreferences(current, { minimumPayoutMinor: 5000 }).resetSchedule, false);
    assert.throws(() => normalizePayoutPreferences(current, { payoutMode: 'scheduled' }), /payout_mode must be manual or automatic/);
    assert.throws(() => normalizePayoutPreferences(current, { payoutCadence: 'daily' }), /payout_cadence must be weekly, bi_weekly, or monthly/);
    assert.throws(() => normalizePayoutPreferences(current, { minimumPayoutMinor: -1 }), /minimum_payout_minor must be a non-negative integer/);
});
