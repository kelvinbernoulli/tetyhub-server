import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import pool from '../src/services/pg_pool.js';
import Shipment from '../src/models/shipment.model.js';
import Notification from '../src/models/notification.model.js';

const connectionString = process.env.SHIPMENT_DATABASE_URL;
test('PostgreSQL migration, scoped reads and concurrent split-order delivery', { skip: !connectionString, timeout: 60000 }, async t => {
    const namespace = `shipment_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
    const db = new Pool({ connectionString, options: `-c search_path=${namespace}`, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
    try {
        await admin.query(`CREATE SCHEMA "${namespace}"`);
        await db.query(`
            CREATE TABLE vendors (id INTEGER PRIMARY KEY);
            CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, status TEXT, payment_status TEXT, updated_at TIMESTAMP);
            CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER, vendor_id INTEGER, product_id INTEGER, quantity INTEGER, variant_id INTEGER);
            CREATE TABLE shipments (id SERIAL PRIMARY KEY, order_id INTEGER, tracking_number TEXT, carrier TEXT, shipping_method TEXT,
                estimated_delivery TIMESTAMP, actual_delivery TIMESTAMP, shipping_cost DECIMAL DEFAULT 0, status TEXT DEFAULT 'pending', notes TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP);
            CREATE UNIQUE INDEX shipments_order_id_key ON shipments(order_id);
            CREATE TABLE shipment_tracking_history (id SERIAL PRIMARY KEY, shipment_id INTEGER REFERENCES shipments(id), status TEXT, location TEXT, description TEXT, created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE order_status_history (id SERIAL PRIMARY KEY, order_id INTEGER, status TEXT, note TEXT, changed_by INTEGER, created_at TIMESTAMP DEFAULT NOW());
            INSERT INTO vendors VALUES (3), (4);
            INSERT INTO products VALUES (1, 'First'), (2, 'Second');
            INSERT INTO orders VALUES (1, 2, 'processing', 'paid', NOW()), (2, 2, 'processing', 'paid', NOW()), (3, 2, 'processing', 'paid', NOW());
            INSERT INTO order_items VALUES (1,1,3,1,1,NULL), (2,1,4,2,1,NULL), (3,2,3,1,1,NULL), (4,3,3,1,1,NULL), (5,3,4,2,1,NULL);
            INSERT INTO shipments (order_id) VALUES (2), (3);
        `);
        await db.query(await readFile(new URL('../prisma/migrations/20260925120000_vendor_shipment_tracking/migration.sql', import.meta.url), 'utf8'));
        assert.equal((await db.query('SELECT vendor_id FROM shipments WHERE order_id = 2')).rows[0].vendor_id, 3);
        assert.equal((await db.query('SELECT vendor_id FROM shipments WHERE order_id = 3')).rows[0].vendor_id, null);
        t.mock.method(pool, 'connect', () => db.connect());
        t.mock.method(pool, 'query', (...args) => db.query(...args));
        t.mock.method(Notification, 'notifyShipmentUpdate', async () => {});
        const [first, second] = await Promise.all([
            Shipment.createShipment(1, 3, { carrier: 'Manual', tracking_number: 'A', notes: 'Private' }, 30),
            Shipment.createShipment(1, 4, { carrier: 'Manual', tracking_number: 'B' }, 40),
        ]);
        assert.equal((await Shipment.getShipmentsByOrderId(1, null, 2)).length, 2);
        const vendorShipments = await Shipment.getShipmentsByOrderId(1, 3);
        assert.equal(vendorShipments.length, 1);
        assert.equal(vendorShipments[0].items.length, 1);
        assert.equal(vendorShipments[0].items[0].product_id, 1);
        assert.equal((await Shipment.getShipmentsByOrderId(1, null, 999)).length, 0);
        assert.equal(await Shipment.getShipmentById(first.id, 4), null);
        assert.equal((await Shipment.getShipmentById(first.id, null, 2)).notes, undefined);
        await assert.rejects(Shipment.createShipment(1, 3, {}), /already exists/);
        await assert.rejects(Shipment.createShipment(3, 3, {}), /reconciliation/);
        await Promise.all([Shipment.updateShipment(first.id, 3, { status: 'shipped' }, 30), Shipment.updateShipment(second.id, 4, { status: 'shipped' }, 40)]);
        await Promise.all([Shipment.addTrackingUpdate(first.id, 3, { status: 'delivered' }, 30), Shipment.addTrackingUpdate(second.id, 4, { status: 'delivered' }, 40)]);
        assert.equal((await db.query('SELECT status FROM orders WHERE id = 1')).rows[0].status, 'delivered');
        assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM order_status_history WHERE order_id = 1 AND status = 'delivered'")).rows[0].count, 1);
        assert.equal((await Shipment.getTrackingHistory(first.id, null, 2)).length, 3);
        assert.ok((await Shipment.getShipmentById(first.id, null, 2)).actual_delivery);
    } finally {
        await db.end();
        await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
        await admin.end();
    }
});
