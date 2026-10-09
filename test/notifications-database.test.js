import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import pool from '../src/services/pg_pool.js';
import Notification from '../src/models/notification.model.js';
import {
    notifyOrder,
    notifyBooking,
    vendorRecipients,
} from '../src/services/notifications.js';
import Shipment from '../src/models/shipment.model.js';
import Return from '../src/models/return.model.js';
import Order from '../src/models/order.model.js';

const connectionString = process.env.NOTIFICATION_DATABASE_URL;
test(
    'PostgreSQL notification ownership, recipient grants, migration and workflow commits',
    { skip: !connectionString, timeout: 60000 },
    async (t) => {
        const namespace = `notification_test_${randomUUID().replaceAll('-', '')}`;
        const admin = new Pool({
            connectionString,
            connectionTimeoutMillis: 5000,
        });
        const db = new Pool({
            connectionString,
            options: `-c search_path=${namespace}`,
            connectionTimeoutMillis: 5000,
            statement_timeout: 15000,
        });
        try {
            await admin.query(`CREATE SCHEMA "${namespace}"`);
            await db.query(`
            CREATE TABLE users (id SERIAL PRIMARY KEY, status TEXT DEFAULT 'active', role TEXT DEFAULT 'customer');
            CREATE TABLE vendors (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), status TEXT DEFAULT 'active');
            CREATE TABLE admins (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), vendor_id INTEGER, scope TEXT, status TEXT);
            CREATE TABLE admin_types (id SERIAL PRIMARY KEY, slug TEXT, scope TEXT, status BOOLEAN);
            CREATE TABLE admin_permissions (admin_id INTEGER, admin_type_id INTEGER, status BOOLEAN, can_read BOOLEAN, expires_at TIMESTAMP);
            CREATE TABLE notifications (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), type TEXT, title TEXT, message TEXT, metadata TEXT, read_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE orders (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), order_number TEXT, status TEXT DEFAULT 'pending', payment_status TEXT DEFAULT 'paid', updated_at TIMESTAMP);
            CREATE TABLE order_items (id SERIAL PRIMARY KEY, order_id INTEGER, vendor_id INTEGER, quantity INTEGER, price NUMERIC);
            CREATE TABLE vendor_order_fulfillments (id SERIAL PRIMARY KEY, order_id INTEGER, vendor_id INTEGER, status TEXT DEFAULT 'processing', updated_at TIMESTAMP, UNIQUE(order_id, vendor_id));
            CREATE TABLE order_status_history (order_id INTEGER, status TEXT, note TEXT, changed_by INTEGER);
            CREATE TABLE shipments (id SERIAL PRIMARY KEY, order_id INTEGER UNIQUE, tracking_number TEXT, carrier TEXT, shipping_method TEXT, estimated_delivery TIMESTAMP, shipping_cost NUMERIC, status TEXT, notes TEXT, updated_at TIMESTAMP);
            CREATE TABLE shipment_tracking_history (id SERIAL PRIMARY KEY, shipment_id INTEGER, status TEXT, location TEXT, description TEXT);
            CREATE TABLE returns (id SERIAL PRIMARY KEY, order_id INTEGER, user_id INTEGER, vendor_id INTEGER, reason TEXT, description TEXT, return_type TEXT, refund_amount NUMERIC, status TEXT, updated_at TIMESTAMP);
            CREATE TABLE return_items (id SERIAL PRIMARY KEY, return_id INTEGER, order_item_id INTEGER, quantity INTEGER);
            INSERT INTO users (role) VALUES ('customer'), ('vendor'), ('vendor_admin'), ('vendor_admin'), ('admin');
            INSERT INTO vendors (user_id) VALUES (2);
            INSERT INTO admins (user_id,vendor_id,scope,status) VALUES (3,1,'vendor','active'), (4,1,'vendor','suspended'), (5,NULL,'platform','active');
            INSERT INTO admin_types (slug,scope,status) VALUES ('orders','both',true), ('services','both',true), ('payments','platform',true);
            INSERT INTO admin_permissions VALUES (1,1,true,true,NULL),(2,1,true,true,NULL),(1,2,true,true,NOW()-INTERVAL '1 day'),(3,3,true,true,NULL);
            INSERT INTO orders (user_id, status) VALUES (1,'processing');
            INSERT INTO order_items (order_id,vendor_id,quantity,price) VALUES (1,1,2,10);
            INSERT INTO vendor_order_fulfillments (order_id,vendor_id,status) VALUES (1,1,'processing');
        `);
            await db.query(
                await readFile(
                    new URL(
                        '../prisma/migrations/20260924150000_notification_indexes/migration.sql',
                        import.meta.url
                    ),
                    'utf8'
                )
            );
            t.mock.method(pool, 'query', (...args) => db.query(...args));
            t.mock.method(pool, 'connect', () => db.connect());
            assert.deepEqual(
                (await vendorRecipients(db, [1], 'orders')).sort(),
                [2, 3]
            );
            assert.deepEqual(await vendorRecipients(db, [1], 'services'), [2]);
            const order = { id: 1, user_id: 1 };
            await notifyOrder(db, order, 'processing');
            assert.equal(await Notification.getUnreadCount(1), 1);
            assert.equal(await Notification.getUnreadCount(2), 1);
            assert.equal(await Notification.getUnreadCount(3), 1);
            assert.equal(await Notification.getUnreadCount(4), 0);
            const [row] = await Notification.getUserNotifications(1);
            assert.equal(
                await Notification.getUserNotification(2, row.id),
                null
            );
            assert.equal(await Notification.markAsRead(row.id, 2), null);
            assert.equal(
                await Notification.deleteNotification(row.id, 2),
                null
            );
            const marked = await Notification.markAsRead(row.id, 1);
            assert.deepEqual(
                (await Notification.markAsRead(row.id, 1)).read_at,
                marked.read_at
            );
            await notifyBooking(
                db,
                { id: 1, user_id: 1, vendor_id: 1 },
                'payment_review'
            );
            assert.equal(await Notification.getUnreadCount(5), 1);
            const client = await db.connect();
            try {
                await client.query('BEGIN');
                await Notification.createNotification(
                    1,
                    'test',
                    'Rolled back',
                    'Must not appear',
                    null,
                    client
                );
                await client.query('ROLLBACK');
            } finally {
                client.release();
            }
            assert.equal(
                (await Notification.getUserNotifications(1, { type: 'test' }))
                    .length,
                0
            );
            const shipment = await Shipment.createShipment(1, 1, {
                tracking_number: 'TRACK-1',
                carrier: 'Courier',
            });
            assert.equal(
                (
                    await Notification.getUserNotifications(1, {
                        type: 'shipment_update',
                    })
                ).length,
                1
            );
            await Shipment.updateShipment(shipment.id, 1, {
                status: 'delivered',
            });
            assert.equal(
                (
                    await Notification.getUserNotifications(1, {
                        type: 'shipment_update',
                    })
                ).length,
                2
            );
            await Shipment.updateShipment(shipment.id, 1, {
                status: 'delivered',
            });
            assert.equal(
                (
                    await Notification.getUserNotifications(1, {
                        type: 'shipment_update',
                    })
                ).length,
                2
            );
            const request = await Return.createReturnRequest(1, 1, {
                reason: 'Wrong size',
                return_type: 'exchange',
                items: [{ order_item_id: 1, quantity: 1 }],
            });
            assert.ok(request.id);
            await Return.updateReturnStatus(
                request.id,
                1,
                'approved',
                'Approved privately'
            );
            assert.equal(
                (
                    await Notification.getUserNotifications(1, {
                        type: 'return_status',
                    })
                ).length,
                2
            );
            assert.ok(
                !(
                    await db.query('SELECT metadata FROM notifications')
                ).rows.some((row) =>
                    row.metadata?.includes('Approved privately')
                )
            );
            await db.query(
                'INSERT INTO order_items (order_id,vendor_id,quantity,price) VALUES (1,999,1,10)'
            );
            const rejected = await Order.updateOrderStatus(1, 999, 2, {
                status: 'refunded',
            });
            assert.equal(rejected.code, 404);
            const before = (await Notification.getUserNotifications(1))[0].id;
            const newer = await Notification.createNotification(
                1,
                'test',
                'New',
                'Unseen'
            );
            await Notification.markAllAsRead(1, before);
            assert.equal(
                (await Notification.getUserNotification(1, newer.id)).read_at,
                null
            );
            assert.ok(await Notification.deleteNotification(newer.id, 1));
        } finally {
            t.mock.restoreAll();
            await db.end();
            await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
            await admin.end();
        }
    }
);
