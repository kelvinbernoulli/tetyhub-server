import test from 'node:test';
import assert from 'node:assert/strict';
import { updateCommissionRatesSchema } from '../src/schemas/commission.schema.js';
import { commissionAmount, vendorSaleAllocations } from '../src/utils/commission.js';

test('commission rate inputs accept percent precision and reject out-of-range values', () => {
    assert.equal(
        updateCommissionRatesSchema.validate({
            product_rate: 0.29,
            service_rate: 7,
        }).error,
        undefined
    );
    for (const invalid of [-0.01, 100.01, 1.234, '10%']) {
        assert.ok(
            updateCommissionRatesSchema.validate({
                product_rate: invalid,
                service_rate: 5,
            }).error
        );
    }
});

test('commission amounts use minor units and rounded percentage points', () => {
    assert.equal(commissionAmount(10001, 10), 1000);
    assert.equal(commissionAmount(999, 12.5), 125);
});

test('product vendor split subtracts only the applicable vendor discount first', () => {
    assert.deepEqual(
        vendorSaleAllocations(
            [
                { vendor_id: 3, subtotal_minor: 10000 },
                { vendor_id: 4, subtotal_minor: 5000 },
            ],
            { vendor_id: 3 },
            '10.00',
            '10.00'
        ).map(({ vendorId, commissionAmount, netAmount }) => ({
            vendorId,
            commissionAmount,
            netAmount,
        })),
        [
            { vendorId: 3, commissionAmount: '9.00', netAmount: '81.00' },
            { vendorId: 4, commissionAmount: '5.00', netAmount: '45.00' },
        ]
    );
});
