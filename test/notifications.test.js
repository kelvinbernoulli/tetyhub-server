import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/services/pg_pool.js';
import Notification from '../src/models/notification.model.js';
import * as controllers from '../src/controllers/notification.controller.js';
import {
    vendorRecipients,
    notifyOrder,
    notifyBooking,
    notifyReturn,
    notifyLowStock,
    notifyPaymentFailure,
} from '../src/services/notifications.js';
import Shipment from '../src/models/shipment.model.js';
import Return from '../src/models/return.model.js';
import { expireBookings } from '../src/models/booking.model.js';

function database(t, handler = () => undefined) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        const result = handler(sql, values);
        if (result !== undefined) return result;
        if (sql.includes('FROM users u JOIN vendors'))
            return { rows: [{ id: 11 }, { id: 12 }] };
        if (sql.includes('FROM users u JOIN admins'))
            return { rows: [{ id: 20 }] };
        if (sql.includes('SELECT DISTINCT'))
            return { rows: [{ vendor_id: 5 }] };
        return { rows: [], rowCount: 0 };
    };
    t.mock.method(pool, 'query', query);
    t.mock.method(pool, 'connect', async () => ({
        query,
        release() {
            calls.push({ sql: 'RELEASE' });
        },
    }));
    return calls;
}
const notifications = (calls) =>
    calls.filter(({ sql }) => sql.includes('INSERT INTO notifications'));
const response = () => ({
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
});

test('all inbox handlers reject missing authentication before querying', async (t) => {
    const calls = database(t);
    for (const handler of Object.values(controllers)) {
        const res = response();
        await handler({ params: { notificationId: '1' }, query: {} }, res);
        assert.equal(res.statusCode, 401);
    }
    assert.equal(calls.length, 0);
});

test('inbox validates IDs and filters and does not expose database errors', async (t) => {
    const calls = database(t);
    for (const id of ['1junk', '-1', '0', '2147483648', '1e2']) {
        const res = response();
        await controllers.getUserNotification(
            { auth: { userId: 1 }, params: { notificationId: id } },
            res
        );
        assert.equal(res.statusCode, 400);
    }
    for (const query of [
        { unread_only: 'maybe' },
        { limit: 101 },
        { user_id: 2 },
        { offset: -1 },
    ]) {
        const res = response();
        await controllers.getUserNotifications(
            { auth: { userId: 1 }, query },
            res
        );
        assert.equal(res.statusCode, 400);
    }
    assert.equal(calls.length, 0);
});

test('list filters are bound and every read, read update and delete is owner scoped', async (t) => {
    const calls = database(t);
    await Notification.getUserNotifications(7, {
        unreadOnly: true,
        type: 'support',
        before: 30,
        limit: 10,
    });
    assert.deepEqual(calls[0].values, [7, 'support', 30, 10, 0]);
    assert.match(calls[0].sql, /read_at IS NULL/);
    await Notification.getUserNotification(7, 2);
    await Notification.markAsRead(2, 7);
    await Notification.deleteNotification(2, 7);
    assert.deepEqual(calls[1].values, [7, 2]);
    assert.deepEqual(calls[2].values, [2, 7]);
    assert.match(calls[2].sql, /COALESCE\(read_at, NOW\(\)\)/);
    assert.deepEqual(calls[3].values, [2, 7]);
    assert.match(calls[3].sql, /user_id = \$2/);
    await Notification.markAllAsRead(7, 30);
    assert.deepEqual(calls[4].values, [7, 30]);
    assert.match(calls[4].sql, /id <= \$2/);
});

test('batch writes deduplicate recipients and use the provided transaction', async (t) => {
    const poolCalls = database(t);
    const calls = [];
    const client = {
        query: async (sql, values) => {
            calls.push({ sql, values });
            return { rows: [{ id: 1 }] };
        },
    };
    await Notification.createMany(
        [3, 3, null, undefined, -1, 4],
        'support',
        'Reply',
        'New reply',
        { ticket_id: 5 },
        client
    );
    assert.equal(poolCalls.length, 0);
    assert.deepEqual(calls[0].values, [
        [3, 4],
        'support',
        'Reply',
        'New reply',
        '{"ticket_id":5}',
    ]);
});

test('vendor recipients use database vendor membership and active, unexpired resource grants', async (t) => {
    const calls = database(t);
    assert.deepEqual(await vendorRecipients(pool, [5], 'orders'), [11, 12]);
    assert.deepEqual(calls[0].values, [[5], 'orders']);
    assert.match(calls[0].sql, /v.user_id = u.id/);
    assert.match(calls[0].sql, /ap.expires_at > NOW\(\)/);
    assert.match(calls[0].sql, /at.slug = \$2/);
    assert.match(calls[0].sql, /a.scope::text = 'vendor'/);
});

test('unpaid checkout alerts the buyer; paid orders alert vendor users with minimal metadata', async (t) => {
    const calls = database(t);
    const order = {
        id: 3,
        user_id: 1,
        contact_email: 'private@example.com',
        total: 100,
    };
    await notifyOrder(pool, order, 'pending', { vendors: false });
    assert.equal(notifications(calls).length, 1);
    await notifyOrder(pool, order, 'processing');
    assert.deepEqual(notifications(calls).at(-1).values[0], [11, 12]);
    assert.ok(
        !JSON.stringify(notifications(calls)).includes('private@example.com')
    );
    await notifyOrder(pool, order, 'payment_review');
    assert.deepEqual(notifications(calls).at(-1).values[0], [20]);
});

test('bookings and returns notify the customer and correct vendor resource', async (t) => {
    const calls = database(t);
    await notifyBooking(
        pool,
        { id: 1, user_id: 11, vendor_id: 5 },
        'confirmed'
    );
    assert.deepEqual(notifications(calls).at(-1).values[0], [12]);
    assert.equal(
        calls.find(({ sql }) => sql.includes('FROM users u JOIN vendors'))
            .values[1],
        'services'
    );
    await notifyReturn(pool, { id: 3, user_id: 1, order_id: 4 }, 'pending', {
        vendors: true,
    });
    assert.equal(
        calls
            .filter(({ sql }) => sql.includes('FROM users u JOIN vendors'))
            .at(-1).values[1],
        'returns'
    );
    assert.ok(
        calls.some(({ sql }) =>
            sql.includes('JOIN order_items oi ON oi.id = ri.order_item_id')
        )
    );
});

test('low stock alerts only when crossing the threshold', async (t) => {
    const calls = database(t, (sql) =>
        sql.includes('SELECT stock, low_stock_threshold')
            ? { rows: [{ stock: 4, low_stock_threshold: 5 }] }
            : undefined
    );
    const item = { product_id: 8, vendor_id: 5, quantity: 1 };
    await notifyLowStock(pool, item);
    assert.equal(notifications(calls).length, 0);
    await notifyLowStock(pool, { ...item, quantity: 2 });
    assert.equal(notifications(calls).length, 1);
});

test('payment failures ignore pending attempts and suppress repeated terminal states', async (t) => {
    const calls = database(t);
    const payment = { id: 1, user_id: 1 };
    await notifyPaymentFailure(pool, payment, 'pending', { order_id: 2 });
    assert.equal(calls.length, 0);
    await notifyPaymentFailure(pool, payment, 'failed', { order_id: 2 });
    assert.equal(notifications(calls).length, 1);
    const meta = calls.at(-1).values[0];
    await notifyPaymentFailure(pool, { ...payment, meta }, 'failed', {
        order_id: 2,
    });
    assert.equal(notifications(calls).length, 1);
});

test('shipment updates commit notifications together and omit private notes', async (t) => {
    const shipment = {
        id: 9,
        order_id: 3,
        status: 'pending',
        notes: 'Private note',
    };
    const calls = database(t, (sql) => {
        if (sql.includes('SELECT * FROM shipments')) return { rows: [shipment] };
        if (sql.includes('UPDATE shipments'))
            return { rows: [{ ...shipment, status: 'shipped' }] };
        if (sql.includes('SELECT o.*'))
            return { rows: [{ id: 3, user_id: 1, status: 'awaiting_shipment', payment_status: 'paid' }] };
        if (sql.includes('SELECT vendor_id, status'))
            return { rows: [{ vendor_id: 5, status: 'shipped' }] };
        if (sql.includes('SELECT COUNT(DISTINCT vendor_id)'))
            return { rows: [{ count: 1 }] };
    });
    await Shipment.updateShipment(9, 5, { status: 'shipped' });
    assert.equal(notifications(calls).length, 1);
    assert.ok(!JSON.stringify(notifications(calls)).includes('Private note'));
    assert.equal(calls.at(-2).sql, 'COMMIT');
});

test('failed shipment notification rolls back the shipment and tracking changes', async (t) => {
    const calls = database(t, (sql) => {
        if (sql.includes('SELECT * FROM shipments'))
            return { rows: [{ id: 9, order_id: 3, status: 'pending' }] };
        if (sql.includes('UPDATE shipments'))
            return { rows: [{ id: 9, order_id: 3, status: 'shipped' }] };
        if (sql.includes('SELECT o.*'))
            return { rows: [{ id: 3, user_id: 1, status: 'awaiting_shipment', payment_status: 'paid' }] };
        if (sql.includes('SELECT vendor_id, status'))
            return { rows: [{ vendor_id: 5, status: 'shipped' }] };
        if (sql.includes('SELECT COUNT(DISTINCT vendor_id)'))
            return { rows: [{ count: 1 }] };
        if (sql.includes('INSERT INTO notifications'))
            throw new Error('Notification write failed');
    });
    t.mock.method(console, 'error', () => {});
    await assert.rejects(
        Shipment.updateShipment(9, 5, { status: 'shipped' }),
        /Notification write failed/
    );
    assert.equal(calls.at(-2).sql, 'ROLLBACK');
});

test('unchanged return status sends no notification or refund', async (t) => {
    const calls = database(t, (sql) =>
        sql.includes('SELECT r.*')
            ? { rows: [{ id: 1, status: 'approved', return_type: 'refund' }] }
            : undefined
    );
    await Return.updateReturnStatus(1, 5, 'approved');
    assert.equal(notifications(calls).length, 0);
    assert.equal(calls.at(-2).sql, 'COMMIT');
});

test('reservation expiry notifies only rows that actually transition, in one transaction', async (t) => {
    const calls = database(t, (sql) =>
        sql.startsWith('UPDATE service_bookings')
            ? { rows: [{ id: 2, user_id: 1, vendor_id: 5 }], rowCount: 1 }
            : undefined
    );
    await expireBookings();
    assert.equal(notifications(calls).length, 1);
    assert.equal(calls[0].sql, 'BEGIN');
    assert.equal(calls.at(-2).sql, 'COMMIT');
});
