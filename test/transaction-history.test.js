import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/services/pg_pool.js';
import TransactionHistory from '../src/models/transaction.history.model.js';
import * as Controller from '../src/controllers/transaction.history.controller.js';
import { transactionIdSchema, transactionQuerySchema, adminTransactionQuerySchema } from '../src/schemas/transaction.history.schema.js';

const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return body; } });

for (const role of ['vendor', 'vendor_admin']) {
    test(`${role} history uses authenticated vendor scope`, async t => {
        let received;
        t.mock.method(TransactionHistory, 'fetchVendorTransactions', async (...args) => { received = args; return []; });
        const res = response();
        await Controller.getVendorTransactions({ session: { user: { id: 90, vendor_id: 999, role } }, auth: { vendorId: 5 }, query: { type: 'booking', status: 'success' } }, res);
        assert.equal(res.code, 200);
        assert.equal(received[0], 5);
        assert.equal(received[1].type, 'booking');
        await Controller.getVendorTransactions({ session: { user: { id: 90, vendor_id: 999, role } }, query: {} }, res);
        assert.equal(res.code, 403);
    });
}

for (const role of ['admin', 'super_admin']) {
    test(`${role} can filter platform history by validated vendor`, async t => {
        let received;
        t.mock.method(TransactionHistory, 'fetchAllTransactions', async options => { received = options; return []; });
        const res = response();
        await Controller.getAllTransactions({ session: { user: { id: 1, role } }, query: { vendor_id: '5', payment_status: 'paid' } }, res);
        assert.equal(res.code, 200);
        assert.equal(received.vendor_id, 5);
        assert.equal(received.payment_status, 'paid');
    });
}

test('customer history preserves owner and booking filters', async t => {
    let received;
    t.mock.method(TransactionHistory, 'fetchTransactions', async (...args) => { received = args; return []; });
    const res = response();
    await Controller.getTransactions({ session: { user: { id: 2 } }, query: { type: 'booking', payment_status: 'paid' } }, res);
    assert.equal(res.code, 200);
    assert.equal(received[0], 2);
    assert.equal(received[1].type, 'booking');
    await Controller.getTransactions({ session: { user: { id: 2 } }, query: { vendor_id: '5' } }, res);
    assert.equal(res.code, 400);
});

test('malformed IDs are rejected before querying and missing transactions return 404', async t => {
    let calls = 0;
    t.mock.method(TransactionHistory, 'getTransactionById', async (id, owner) => { calls++; assert.equal(id, 12); assert.equal(owner, 2); return null; });
    const res = response();
    for (const id of ['abc', '12abc', '-1', '0', '1.2', '2147483648', ['12']]) {
        await Controller.getTransactionById({ session: { user: { id: 2 } }, params: { id } }, res);
        assert.equal(res.code, 400);
    }
    assert.equal(calls, 0);
    await Controller.getTransactionById({ session: { user: { id: 2 } }, params: { id: '12' } }, res);
    assert.equal(res.code, 404);
    assert.notEqual(res.body.code, 0);
});

test('history filters reject partial IDs, unknown statuses and invalid pagination', () => {
    for (const vendor_id of ['5oops', '5.5', '0', '-2', '2147483648', ['5'], { id: '5' }]) {
        assert.ok(adminTransactionQuerySchema.validate({ vendor_id }).error);
    }
    assert.equal(transactionIdSchema.validate('2147483647').value, 2147483647);
    for (const input of [{ status: 'anything' }, { payment_status: 'anything' }, { limit: 101 }, { offset: -1 }, { limit: [] }, { type: 'other' }]) {
        assert.ok(transactionQuerySchema.validate(input).error);
    }
});

test('unauthenticated and non-platform users cannot access platform history', async t => {
    t.mock.method(TransactionHistory, 'fetchAllTransactions', async () => assert.fail('must not query'));
    const res = response();
    await Controller.getAllTransactions({ query: {} }, res);
    assert.equal(res.code, 401);
    for (const role of ['customer', 'vendor', 'vendor_admin']) {
        await Controller.getAllTransactions({ session: { user: { id: 1, role } }, query: {} }, res);
        assert.equal(res.code, 403);
    }
});

test('all history queries use an explicit public projection and booking-aware joins', async t => {
    const calls = [];
    t.mock.method(pool, 'query', async (sql, values) => { calls.push({ sql, values }); return { rows: [] }; });
    await TransactionHistory.fetchTransactions(2, { type: 'booking', payment_status: 'paid' });
    await TransactionHistory.getTransactionById(12, 2);
    await TransactionHistory.fetchVendorTransactions(5, { status: 'success', payment_status: 'paid' });
    await TransactionHistory.fetchAllTransactions({ vendor_id: 5 });
    for (const { sql } of calls) {
        assert.doesNotMatch(sql, /p\.\*|checkout_data|initializing_until|p\.meta|provider_ref|o\.vendor_id|business_name/);
        assert.match(sql, /service_bookings b ON b.id = p.booking_id/);
        assert.match(sql, /p.created_at DESC, p.id DESC/);
    }
    assert.match(calls[0].sql, /p.user_id = \$1/);
    assert.match(calls[0].sql, /COALESCE\(o.payment_status, b.payment_status\) = \$2/);
    assert.deepEqual(calls[1].values, [2, 12, 1, 0]);
    assert.match(calls[2].sql, /oi.vendor_id = \$1/);
    assert.match(calls[2].sql, /COALESCE\(b.vendor_id, p.vendor_id\) = \$1/);
    assert.match(calls[2].sql, /SUM\(oi.subtotal\)/);
    assert.deepEqual(calls[2].values, [5, 'success', 'paid', 20, 0]);
});

test('missing model owner scopes never become platform queries', async t => {
    t.mock.method(pool, 'query', async () => assert.fail('must not query'));
    assert.deepEqual(await TransactionHistory.fetchTransactions(null), []);
    assert.deepEqual(await TransactionHistory.fetchVendorTransactions(null), []);
    assert.equal(await TransactionHistory.getTransactionById(1, null), null);
});

test('database errors do not leak SQL details to clients', async t => {
    t.mock.method(TransactionHistory, 'fetchTransactions', async () => { throw new Error('private SQL detail'); });
    t.mock.method(console, 'error', () => {});
    const res = response();
    await Controller.getTransactions({ session: { user: { id: 2 } }, query: {} }, res);
    assert.equal(res.code, 500);
    assert.equal(res.body.message, 'Internal Server Error');
});
