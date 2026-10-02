import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/services/pg_pool.js';
import Order from '../src/models/order.model.js';
import Return from '../src/models/return.model.js';
import Notification from '../src/models/notification.model.js';
import { getOrderHistory } from '../src/controllers/vendor.controller.js';

function database(t, handler = () => undefined) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        return handler(sql, values) ?? { rows: [] };
    };
    t.mock.method(pool, 'query', query);
    t.mock.method(pool, 'connect', async () => ({ query, release() {} }));
    t.mock.method(Notification, 'notifyShipmentUpdate', async () => {});
    t.mock.method(Notification, 'notifyReturnStatusUpdate', async () => {});
    return calls;
}

test('order reads use the product name column present in the schema', async (t) => {
    const calls = database(t);
    await Order.getOrderById(1, 2);
    await Order.fetchCustomerOrders(2, null, {});
    await Order.fetchVendorOrders(3, {});
    for (const { sql } of calls) {
        assert.doesNotMatch(sql, /oi\.product_name/);
        assert.match(sql, /'product_name', p\.name/);
    }
});

test('history scopes customers and vendors separately and fails closed without scope', async (t) => {
    const calls = database(t);
    await Order.fetchOrderHistory(1, 2);
    await Order.fetchOrderHistory(1, null, 3);
    assert.deepEqual(await Order.fetchOrderHistory(1), []);
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /o.user_id = \$2/);
    assert.match(calls[1].sql, /oi.vendor_id = \$2/);
    assert.deepEqual(calls[0].values, [1, 2]);
    assert.deepEqual(calls[1].values, [1, 3]);
    assert.match(calls[1].sql, /osh.created_at ASC, osh.id ASC/);
});

test('vendor history uses the authorized vendor rather than the session user', async (t) => {
    const calls = [];
    t.mock.method(Order, 'fetchOrderHistory', async (...args) => { calls.push(args); return []; });
    const res = { status(code) { this.code = code; return this; }, json(body) { return body; } };
    await getOrderHistory({ session: { user: { id: 90 } }, params: { orderId: '12' }, auth: { vendorId: 5 } }, res);
    assert.equal(res.code, 200);
    assert.deepEqual(calls, [['12', null, 5]]);
    await getOrderHistory({ session: { user: { id: 90 } }, params: { orderId: '12' } }, res);
    assert.equal(res.code, 403);
    assert.equal(calls.length, 1);
});

test('return request records the customer actor before commit', async (t) => {
    const calls = database(t, sql => {
        if (sql.startsWith('SELECT * FROM orders')) return { rows: [{ id: 1, status: 'delivered' }] };
        if (sql.startsWith('SELECT * FROM order_items')) return { rows: [{ id: 9, vendor_id: 3, quantity: 1 }] };
        if (sql.startsWith('INSERT INTO returns')) return { rows: [{ id: 4, user_id: 2 }] };
    });
    await Return.createReturnRequest(1, 2, { items: [{ order_item_id: 9, quantity: 1 }], reason: 'Damaged', return_type: 'refund' });
    const history = calls.findIndex(x => x.sql.startsWith('INSERT INTO order_status_history'));
    assert.ok(history > 0);
    assert.match(calls[history].sql, /'returned'/);
    assert.deepEqual(calls[history].values, [1, 2]);
    assert.ok(history < calls.findIndex(x => x.sql === 'COMMIT'));
});
