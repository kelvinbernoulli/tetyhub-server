import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/services/pg_pool.js';
import Shipment from '../src/models/shipment.model.js';
import Notification from '../src/models/notification.model.js';
import * as Controller from '../src/controllers/shipment.controller.js';
import { fulfillmentStatus, validateShipmentTransition } from '../src/services/shipment.js';
import { updateShipmentSchema, addTrackingUpdateSchema } from '../src/schemas/order.schema.js';

function database(t, options = {}) {
    const calls = [];
    const shipment = { id: 4, order_id: 1, vendor_id: 3, status: options.previous ?? 'shipped' };
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        if (options.failHistory && sql.startsWith('INSERT INTO shipment_tracking_history')) throw new Error('history failed');
        if (sql.startsWith('SELECT o.*') || sql.startsWith('SELECT * FROM orders')) {
            return { rows: options.denied ? [] : [{ id: 1, user_id: 2, payment_status: options.payment ?? 'paid', status: options.orderStatus ?? 'shipped' }] };
        }
        if (sql.startsWith('SELECT * FROM shipments')) return { rows: [shipment] };
        if (sql.startsWith('INSERT INTO shipments')) return { rows: [{ ...shipment, status: 'pending' }] };
        if (sql.startsWith('UPDATE shipments')) return { rows: [{ ...shipment, status: options.next ?? 'delivered' }] };
        if (sql.startsWith('INSERT INTO shipment_tracking_history')) return { rows: [{ id: 10, status: options.next ?? 'delivered' }] };
        if (sql.startsWith('SELECT vendor_id, status FROM shipments')) return { rows: options.shipments ?? [{ vendor_id: 3, status: options.next ?? 'delivered' }] };
        if (sql.startsWith('SELECT COUNT')) return { rows: [{ count: options.vendorCount ?? 1 }] };
        return { rows: [] };
    };
    t.mock.method(pool, 'connect', async () => ({ query, release() {} }));
    t.mock.method(pool, 'query', query);
    t.mock.method(Notification, 'notifyShipmentUpdate', async (...args) => calls.push({ sql: 'NOTIFY', values: args }));
    return calls;
}
const response = () => ({ status(code) { this.code = code; return this; }, json(body) { this.body = body; return body; } });

test('order delivery requires shipments for every vendor', () => {
    assert.equal(fulfillmentStatus([{ vendor_id: 3, status: 'delivered' }], 2), 'awaiting_shipment');
    assert.equal(fulfillmentStatus([{ vendor_id: 3, status: 'delivered' }, { vendor_id: 4, status: 'shipped' }], 2), 'shipped');
    assert.equal(fulfillmentStatus([{ vendor_id: 3, status: 'delivered' }, { vendor_id: 4, status: 'out_for_delivery' }], 2), 'out_for_delivery');
    assert.equal(fulfillmentStatus([{ vendor_id: 3, status: 'delivered' }, { vendor_id: 4, status: 'delivered' }], 2), 'delivered');
    assert.equal(fulfillmentStatus([{ vendor_id: null, status: 'delivered' }], 1), 'awaiting_shipment');
    assert.equal(fulfillmentStatus([{ vendor_id: 3, status: 'failed' }], 1), 'awaiting_shipment');
});

test('transitions reject backward progress and permit delivery retries', () => {
    assert.throws(() => validateShipmentTransition('delivered', 'shipped'), /Cannot transition/);
    assert.throws(() => validateShipmentTransition('pending', 'delivered'), /Cannot transition/);
    validateShipmentTransition('failed', 'out_for_delivery');
    validateShipmentTransition('in_transit', 'in_transit');
    for (const status of ['processing', 'out_for_delivery', 'failed', 'returned', 'cancelled']) {
        assert.equal(updateShipmentSchema.validate({ status }).error, undefined);
        assert.equal(addTrackingUpdateSchema.validate({ status }).error, undefined);
    }
    assert.ok(updateShipmentSchema.validate({}).error);
});

for (const method of ['updateShipment', 'addTrackingUpdate']) {
    test(`${method} updates delivery, history, actor and notification atomically`, async t => {
        const calls = database(t);
        await Shipment[method](4, 3, { status: 'delivered', location: 'Lagos' }, 90);
        assert.match(calls.find(x => x.sql.startsWith('UPDATE shipments')).sql, /actual_delivery = NOW\(\)/);
        assert.deepEqual(calls.find(x => x.sql.startsWith('INSERT INTO order_status_history')).values, [1, 'delivered', 'Shipment progress updated', 90]);
        assert.deepEqual(calls.find(x => x.sql.startsWith('INSERT INTO shipment_tracking_history')).values.slice(0, 3), [4, 'delivered', 'Lagos']);
        assert.equal(calls.find(x => x.sql.startsWith('INSERT INTO shipment_tracking_history')).values[4], 90);
        assert.ok(calls.findIndex(x => x.sql === 'NOTIFY') < calls.findIndex(x => x.sql === 'COMMIT'));
    });
    test(`${method} rolls back if tracking history fails`, async t => {
        const calls = database(t, { failHistory: true });
        await assert.rejects(Shipment[method](4, 3, { status: 'delivered' }, 90), /history failed/);
        assert.ok(calls.some(x => x.sql === 'ROLLBACK'));
        assert.ok(!calls.some(x => x.sql === 'COMMIT' || x.sql === 'NOTIFY'));
    });
}

test('one vendor delivery does not complete a split order', async t => {
    const calls = database(t, { vendorCount: 2, orderStatus: 'awaiting_shipment' });
    await Shipment.addTrackingUpdate(4, 3, { status: 'delivered' }, 90);
    assert.ok(!calls.some(x => x.sql.startsWith('UPDATE orders')));
});

test('creation records pending shipment and awaiting shipment order histories', async t => {
    const calls = database(t, { next: 'pending', orderStatus: 'processing' });
    await Shipment.createShipment(1, 3, { carrier: 'Manual', tracking_number: 'ABC' }, 90);
    assert.deepEqual(calls.find(x => x.sql.startsWith('INSERT INTO shipments')).values.slice(0, 4), [1, 3, 'ABC', 'Manual']);
    assert.equal(calls.find(x => x.sql.startsWith('INSERT INTO order_status_history')).values[1], 'awaiting_shipment');
});

test('unpaid orders cannot be shipped', async t => {
    const calls = database(t, { payment: 'unpaid', orderStatus: 'processing' });
    await assert.rejects(Shipment.createShipment(1, 3, {}), /Only paid/);
    assert.ok(!calls.some(x => x.sql.startsWith('INSERT')));
});

test('cross-vendor writes fail before mutation', async t => {
    const calls = database(t, { denied: true });
    await assert.rejects(Shipment.updateShipment(4, 8, { status: 'delivered' }), /not found/);
    assert.deepEqual(calls[1].values, [4, 8]);
    assert.match(calls[1].sql, /s.vendor_id = \$2/);
    assert.ok(!calls.some(x => x.sql.startsWith('UPDATE')));
});

test('same-status location events notify but do not duplicate order history', async t => {
    const calls = database(t, { previous: 'in_transit', next: 'in_transit' });
    await Shipment.addTrackingUpdate(4, 3, { status: 'in_transit', location: 'New depot' });
    assert.ok(calls.some(x => x.sql.startsWith('INSERT INTO shipment_tracking_history')));
    assert.ok(calls.some(x => x.sql === 'NOTIFY'));
    assert.ok(!calls.some(x => x.sql.startsWith('INSERT INTO order_status_history')));
});

test('repeating an unchanged patch does not duplicate events or notifications', async t => {
    const calls = database(t, { previous: 'delivered', next: 'delivered' });
    await Shipment.updateShipment(4, 3, { status: 'delivered' });
    assert.ok(!calls.some(x => x.sql.startsWith('INSERT') || x.sql === 'NOTIFY'));
});

test('all tracking read methods require a scope and use customer or shipment ownership', async t => {
    const calls = database(t);
    for (const method of ['getShipmentsByOrderId', 'getShipmentById', 'getTrackingHistory']) {
        await Shipment[method](4);
        assert.equal(calls.length, 0);
        await Shipment[method](4, null, 2);
        assert.match(calls[0].sql, /o.user_id = \$2/);
        assert.deepEqual(calls[0].values, [4, 2]);
        calls.length = 0;
        await Shipment[method](4, 3);
        assert.match(calls[0].sql, /s.vendor_id = \$2/);
        calls.length = 0;
    }
});

test('customer controller scopes reads and rejects invalid identifiers', async t => {
    const calls = [];
    t.mock.method(Shipment, 'getShipmentsByOrderId', async (...args) => { calls.push(args); return []; });
    const res = response();
    await Controller.getShipmentsByOrderId({ session: { user: { id: 2 } }, params: { orderId: '1' } }, res);
    assert.deepEqual(calls[0], ['1', undefined, 2]);
    await Controller.getShipmentsByOrderId({ session: { user: { id: 2 } }, params: { orderId: 'abc' } }, res);
    assert.equal(res.code, 400);
    assert.equal(calls.length, 1);
});

test('vendor controller passes validated input, authenticated vendor and actor', async t => {
    let args;
    t.mock.method(Shipment, 'createShipment', async (...values) => { args = values; return { id: 4 }; });
    const res = response();
    await Controller.createShipment({ session: { user: { id: 90, vendor_id: 999 } }, auth: { vendorId: 3 }, params: { orderId: '1' }, body: { tracking_number: ' ABC ', carrier: ' Manual ' } }, res);
    assert.equal(res.code, 201);
    assert.deepEqual(args, ['1', 3, { tracking_number: 'ABC', carrier: 'Manual' }, 90]);
});
