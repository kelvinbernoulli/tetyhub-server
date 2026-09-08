import test from 'node:test';
import assert from 'node:assert/strict';
import Services from '../src/models/services.model.js';
import pool from '../src/services/pg_pool.js';
import * as controllers from '../src/controllers/services.controller.js';
const existing = {
    id: 7,
    vendor_id: 3,
    category_id: 1,
    currency_id: 1,
    base_price: 10,
    compare_at_price: 20,
    location_type: 'customer_location',
    is_remote: false,
};
function database(t, handler = () => undefined) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        const result = handler(sql, values);
        if (result !== undefined) return result;
        if (sql.startsWith('SELECT id FROM')) return { rows: [{ id: 1 }] };
        if (sql.startsWith('SELECT COUNT')) return { rows: [{ total: 1 }] };
        return { rows: [existing] };
    };
    t.mock.method(pool, 'query', query);
    t.mock.method(pool, 'connect', async () => ({ query, release() {} }));
    return calls;
}
test('service list binds child category and vendor scope, includes deleted filter and pagination', async (t) => {
    const calls = database(t);
    const result = await Services.read(3, {
        childcategory_id: 8,
        limit: 5,
        offset: 20,
        vendor_id: 99,
    });
    assert.deepEqual(calls[0].values, [3, 8, 5, 20]);
    assert.match(calls[0].sql, /s.vendor_id = \$1 AND s.deleted_at IS NULL/);
    assert.equal(result.pagination.total, 1);
    assert.equal(result.pagination.offset, 20);
    await Services.read(3);
    assert.ok(!calls.at(-2).sql.includes('WHERE ORDER'));
});
test('service detail, update and delete all require and bind vendor scope', async (t) => {
    const calls = database(t);
    await Services.view(7, 3);
    await Services.delete(7, 3);
    for (const call of calls) {
        assert.deepEqual(call.values, [7, 3]);
        assert.match(call.sql, /vendor_id = \$2/);
    }
    await assert.rejects(Services.view(7), /authentication/);
    await Services.update(7, 3, { name: 'Changed name' });
    assert.deepEqual(
        calls.find((call) => call.sql.startsWith('UPDATE services SET name'))
            .values,
        ['Changed name', 7, 3]
    );
});
test('partial update checks stored prices under a row lock and rolls back', async (t) => {
    const calls = database(t);
    await assert.rejects(Services.update(7, 3, { base_price: 30 }), /higher/);
    assert.match(calls[1].sql, /FOR UPDATE/);
    assert.equal(calls.at(-1).sql, 'ROLLBACK');
    assert.ok(!calls.some((call) => call.sql.startsWith('UPDATE')));
});
test('wrong owner is not found before mutation and invalid categories prevent creation', async (t) => {
    const calls = database(t, (sql) =>
        sql.startsWith('SELECT * FROM services') ||
        sql.startsWith('SELECT id FROM categories')
            ? { rows: [] }
            : undefined
    );
    assert.equal(await Services.update(7, 99, { name: 'Changed name' }), null);
    await assert.rejects(
        Services.create(3, {
            name: 'Consultation',
            category_id: 1,
            currency_id: 1,
            base_price: 10,
        }),
        /category/
    );
    assert.ok(
        !calls.some(
            (call) =>
                call.sql.startsWith('INSERT') || call.sql.startsWith('UPDATE')
        )
    );
});
const res = () => ({
    status(code) {
        this.code = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
});
test('controller uses trusted identity and returns pagination metadata', async (t) => {
    t.mock.method(Services, 'read', async (vendorId, filters) => {
        assert.equal(vendorId, 3);
        assert.equal(filters.limit, 5);
        return { data: [], pagination: { total: 0 } };
    });
    const response = res();
    await controllers.fetchServices(
        { auth: { vendorId: 3 }, query: { limit: '5' } },
        response
    );
    assert.equal(response.code, 200);
    assert.equal(response.body.result.pagination.total, 0);
    const denied = res();
    await controllers.fetchServices(
        { session: { user: { vendor_id: 3 } }, query: {} },
        denied
    );
    assert.equal(denied.code, 403);
});
test('controller uses defined error codes and validates IDs before lookup', async (t) => {
    t.mock.method(Services, 'view', async () => null);
    const missing = res();
    await controllers.viewService(
        { auth: { vendorId: 3 }, params: { id: '7' } },
        missing
    );
    assert.equal(missing.code, 404);
    assert.equal(missing.body.code, 5000);
    const invalid = res();
    await controllers.viewService(
        { auth: { vendorId: 3 }, params: { id: 'abc' } },
        invalid
    );
    assert.equal(invalid.code, 400);
});
