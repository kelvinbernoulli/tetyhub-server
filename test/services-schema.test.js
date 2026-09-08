import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createServiceSchema as create,
    updateServiceSchema as update,
    serviceSearchSchema as search,
} from '../src/schemas/services.schema.js';
import { normalizeServiceState } from '../src/utils/service-state.js';
const base = {
    name: 'Consultation',
    description: 'A consultation session',
    category_id: 1,
    currency_id: 1,
    base_price: 10,
};
test('service location fields agree on create and update', () => {
    for (const [input, expected] of [
        [{}, 'vendor_location'],
        [{ is_remote: true }, 'remote'],
        [{ location_type: 'remote' }, 'remote'],
        [{ location_type: 'customer_location' }, 'customer_location'],
    ]) {
        const { value, error } = create.validate({ ...base, ...input });
        assert.equal(error, undefined);
        assert.equal(value.location_type, expected);
        assert.equal(value.is_remote, expected === 'remote');
    }
    assert.ok(
        create.validate({ ...base, is_remote: false, location_type: 'remote' })
            .error
    );
    assert.ok(
        update.validate({ is_remote: true, location_type: 'customer_location' })
            .error
    );
    assert.deepEqual(update.validate({ is_remote: false }).value, {
        is_remote: false,
    });
    assert.equal(
        normalizeServiceState(
            { is_remote: false },
            { location_type: 'customer_location' }
        ).location_type,
        'customer_location'
    );
});
test('service updates accept supported fields, reject empty and unknown bodies, and omit defaults', () => {
    const body = {
        name: 'Changed service',
        base_price: 20,
        status: 'paused',
        thumbnail: null,
        subcategory_id: null,
    };
    assert.deepEqual(update.validate(body).value, body);
    assert.equal(update.validate(body).error, undefined);
    for (const body of [
        undefined,
        {},
        { vendor_id: 9 },
        { name: 'Changed', slug: 'injected' },
    ])
        assert.ok(update.validate(body, { stripUnknown: true }).error);
    assert.ok(
        create.validate({ ...base, vendor_id: 9 }, { stripUnknown: true }).error
    );
});
test('money rejects precision loss, bounds and inverted comparison prices', () => {
    for (const base_price of [10.999, '10', 0, -1, 10000001])
        assert.ok(create.validate({ ...base, base_price }).error);
    assert.ok(create.validate({ ...base, compare_at_price: 100000000 }).error);
    assert.ok(update.validate({ base_price: 20, compare_at_price: 10 }).error);
    assert.equal(update.validate({ compare_at_price: null }).error, undefined);
    assert.throws(
        () =>
            normalizeServiceState({ base_price: 30 }, { compare_at_price: 20 }),
        /higher/
    );
});
test('query validation coerces types and rejects vendor overrides and inverted ranges', () => {
    const { value, error } = search.validate({
        childcategory_id: '3',
        is_remote: 'false',
        limit: '5',
        offset: '20',
    });
    assert.equal(error, undefined);
    assert.equal(value.childcategory_id, 3);
    assert.equal(value.is_remote, false);
    for (const body of [
        { vendor_id: 3 },
        { limit: 51 },
        { min_price: 20, max_price: 10 },
    ])
        assert.ok(search.validate(body).error);
});
