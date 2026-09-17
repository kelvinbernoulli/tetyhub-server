import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/services/pg_pool.js';
import Vendor from '../src/models/vendor.model.js';
import { updateVendorSettings } from '../src/controllers/vendor.controller.js';

const response = () => ({
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
});
const request = (body) => ({ auth: { userId: 100, vendorId: 3 }, body });

test('storefront update uses authenticated vendor scope and validated partial fields', async (t) => {
    t.mock.method(Vendor, 'updateVendorSettings', async (id, fields) => {
        assert.equal(id, 3);
        assert.deepEqual(fields, { store_slug: 'my-store', description: null });
        return { vendor_id: id, user_id: 50, ...fields };
    });
    const res = response();
    await updateVendorSettings(request({ store_slug: 'My-Store', description: null }), res);
    assert.equal(res.code, 200);
    assert.equal(res.body.result.user_id, 50);
});

test('invalid or protected fields never reach the database', async (t) => {
    t.mock.method(Vendor, 'updateVendorSettings', () => assert.fail('must not write'));
    for (const body of [undefined, {}, { vendor_id: 9 }, { user_id: 9 },
        { status: 'active' }, { store_slug: 'bad slug' }, { email: 'bad' },
        { country_id: -1 }, { website: 'javascript:alert(1)' }]) {
        const res = response();
        await updateVendorSettings(request(body), res);
        assert.equal(res.code, 400);
    }
});

test('missing authentication or vendor scope is rejected', async (t) => {
    t.mock.method(Vendor, 'updateVendorSettings', () => assert.fail('must not write'));
    for (const [auth, status] of [[undefined, 401], [{ userId: 1 }, 403]]) {
        const res = response();
        await updateVendorSettings({ auth, body: { store_name: 'Shop' } }, res);
        assert.equal(res.code, status);
    }
});

test('missing vendor and duplicate slug produce actionable errors', async (t) => {
    const mock = t.mock.method(Vendor, 'updateVendorSettings', async () => null);
    const missing = response();
    await updateVendorSettings(request({ store_name: 'Shop' }), missing);
    assert.equal(missing.code, 404);
    mock.mock.mockImplementation(async () => { throw { code: '23505' }; });
    const conflict = response();
    await updateVendorSettings(request({ store_slug: 'taken' }), conflict);
    assert.equal(conflict.code, 409);
});

test('upsert derives owner from vendors and only changes supplied fields', async (t) => {
    t.mock.method(pool, 'query', async (sql, values) => {
        assert.match(sql, /SELECT id, user_id/);
        assert.match(sql, /FROM vendors WHERE id = \$1/);
        assert.match(sql, /ON CONFLICT \(vendor_id\) DO UPDATE/);
        assert.match(sql, /"linkedIn" = EXCLUDED\."linkedIn"/);
        assert.doesNotMatch(sql, /store_name|store_slug/);
        assert.deepEqual(values, [3, null]);
        return { rows: [{ vendor_id: 3, user_id: 50, linkedIn: null }] };
    });
    const result = await Vendor.updateVendorSettings(3, { linkedIn: null });
    assert.equal(result.user_id, 50);
});
