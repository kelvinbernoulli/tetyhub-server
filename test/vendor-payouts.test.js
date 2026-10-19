import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildVendorPayoutsFromFulfillments,
    processPendingVendorPayouts,
    settleVendorPayouts,
} from '#services/vendor-payout.service.js';

test('eligible vendor fulfillments become pending payout records', () => {
    const rows = [
        { id: 1, vendor_id: 10, order_id: 22, net_amount: 5000, payout_status: 'eligible' },
        { id: 2, vendor_id: 10, order_id: 23, net_amount: 1500, payout_status: 'held' },
        { id: 3, vendor_id: 12, order_id: 24, net_amount: 8200, payout_status: 'eligible' },
    ];

    const result = buildVendorPayoutsFromFulfillments(rows);

    assert.deepEqual(result, [
        { fulfillment_id: 1, vendor_id: 10, order_id: 22, amount: 5000, status: 'pending' },
        { fulfillment_id: 3, vendor_id: 12, order_id: 24, amount: 8200, status: 'pending' },
    ]);
});

test('pending vendor payouts can advance to processing', () => {
    const payouts = [
        { id: 101, vendor_id: 10, amount: 5000, status: 'pending' },
        { id: 102, vendor_id: 10, amount: 1500, status: 'paid' },
        { id: 103, vendor_id: 12, amount: 8200, status: 'pending' },
    ];

    const result = processPendingVendorPayouts(payouts);

    assert.deepEqual(result, [
        { id: 101, vendor_id: 10, amount: 5000, status: 'processing' },
        { id: 103, vendor_id: 12, amount: 8200, status: 'processing' },
    ]);
});

test('processing payouts can be settled as paid', () => {
    const payouts = [
        { id: 201, vendor_id: 10, amount: 5000, status: 'processing' },
        { id: 202, vendor_id: 10, amount: 1500, status: 'paid' },
        { id: 203, vendor_id: 12, amount: 8200, status: 'processing' },
    ];

    const result = settleVendorPayouts(payouts);
    const newlyPaid = result.filter(
        (row) => row.status === 'paid' && row.id !== 202
    );

    assert.equal(result.filter((row) => row.status === 'paid').length, 3);
    assert.equal(newlyPaid.length, 2);
    assert.ok(newlyPaid.every((row) => row.paid_at instanceof Date));
    assert.equal(result.find((row) => row.id === 202)?.status, 'paid');
});
