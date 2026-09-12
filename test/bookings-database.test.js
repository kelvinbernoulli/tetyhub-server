import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import pool from '../src/services/pg_pool.js';
import Booking from '../src/models/booking.model.js';
import BookingPayment from '../src/models/booking-payment.model.js';

const connectionString = process.env.BOOKING_DATABASE_URL;
test(
    'PostgreSQL booking migrations, concurrent capacity, settlement and cancellation',
    { skip: !connectionString, timeout: 60000 },
    async (t) => {
        const namespace = `booking_test_${randomUUID().replaceAll('-', '')}`;
        const admin = new Pool({
            connectionString,
            connectionTimeoutMillis: 5000,
        });
        const db = new Pool({
            connectionString,
            options: `-c search_path=${namespace}`,
            max: 8,
            connectionTimeoutMillis: 5000,
            statement_timeout: 15000,
        });
        const migration = (name) =>
            readFile(
                new URL(
                    `../prisma/migrations/${name}/migration.sql`,
                    import.meta.url
                ),
                'utf8'
            );
        try {
            await admin.query(`CREATE SCHEMA "${namespace}"`);
            await db.query(`
            CREATE TABLE users (id SERIAL PRIMARY KEY, email TEXT);
            CREATE TABLE vendors (id SERIAL PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active');
            CREATE TABLE currencies (id SERIAL PRIMARY KEY, code TEXT, status BOOLEAN DEFAULT true);
            CREATE TABLE services (id SERIAL PRIMARY KEY, vendor_id INT REFERENCES vendors(id), currency_id INT REFERENCES currencies(id),
                name TEXT, base_price NUMERIC(10,2), duration_mins INT DEFAULT 60, buffer_mins INT DEFAULT 0,
                max_bookings_per_slot INT DEFAULT 1, status TEXT DEFAULT 'active', deleted_at TIMESTAMP,
                location_type TEXT DEFAULT 'remote', cancellation_window_hours INT DEFAULT 24, cancellation_fee_percent FLOAT DEFAULT 0);
            CREATE TABLE products (id SERIAL PRIMARY KEY);
            CREATE TABLE orders (id SERIAL PRIMARY KEY, user_id INT REFERENCES users(id));
            CREATE TABLE order_items (id SERIAL PRIMARY KEY, order_id INT REFERENCES orders(id), product_id INT REFERENCES products(id), service_id INT REFERENCES services(id));
            CREATE TABLE service_bookings (id SERIAL PRIMARY KEY, order_item_id INT UNIQUE REFERENCES order_items(id),
                service_id INT NOT NULL REFERENCES services(id), scheduled_for TIMESTAMP NOT NULL, booking_status TEXT DEFAULT 'pending', additional_notes TEXT);
            CREATE TABLE payments (id SERIAL PRIMARY KEY, order_id INT REFERENCES orders(id), user_id INT REFERENCES users(id),
                vendor_id INT REFERENCES vendors(id), gateway TEXT, gateway_ref TEXT UNIQUE, amount NUMERIC(10,2), currency_id INT,
                status TEXT DEFAULT 'pending', meta TEXT, provider_ref TEXT UNIQUE, checkout_data TEXT, initializing_until TIMESTAMP,
                paid_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP);
            CREATE TABLE payment_events (id SERIAL PRIMARY KEY, payment_id INT REFERENCES payments(id), gateway TEXT,
                gateway_event_id TEXT, event_type TEXT, UNIQUE(gateway,gateway_event_id));
            CREATE TABLE notifications (id SERIAL PRIMARY KEY, user_id INT, type TEXT, title TEXT, message TEXT, metadata TEXT);
            INSERT INTO users (email) VALUES ('one@example.com'),('two@example.com');
            INSERT INTO vendors DEFAULT VALUES;
            INSERT INTO currencies (code) VALUES ('NGN');
            INSERT INTO services (vendor_id,currency_id,name,base_price) VALUES (1,1,'Consultation',20.50);
            INSERT INTO orders (user_id) VALUES (1);
            INSERT INTO order_items (order_id,service_id) VALUES (1,1);
        `);
            // A legacy service order must stop the migration, without dropping its record.
            const client = await db.connect();
            try {
                await assert.rejects(
                    client.query(
                        await migration(
                            '20260912120000_separate_orders_and_bookings'
                        )
                    ),
                    /Reconcile/
                );
                await client.query('ROLLBACK');
                assert.equal(
                    (await client.query('SELECT count(*) FROM order_items'))
                        .rows[0].count,
                    '1'
                );
                await client.query('DELETE FROM order_items');
                await client.query(
                    await migration(
                        '20260912120000_separate_orders_and_bookings'
                    )
                );
                await client.query(
                    await migration('20260912130000_booking_workflow')
                );
            } finally {
                client.release();
            }
            t.mock.method(pool, 'connect', () => db.connect());
            t.mock.method(pool, 'query', (...args) => db.query(...args));
            const request = {
                service_id: 1,
                scheduled_for: new Date(Date.now() + 86400000).toISOString(),
                gateway: 'paystack',
                expected_currency: 'NGN',
                expected_total: 20.5,
                idempotency_key: randomUUID(),
            };
            const requests = [
                request,
                { ...request, idempotency_key: randomUUID() },
            ];
            const results = await Promise.allSettled(
                requests.map((r, i) => Booking.create(i + 1, r))
            );
            assert.equal(
                results.filter((r) => r.status === 'fulfilled').length,
                1
            );
            assert.equal(
                results.filter(
                    (r) => r.status === 'rejected' && r.reason.code === 409
                ).length,
                1
            );
            const winner = results.findIndex((r) => r.status === 'fulfilled');
            const booking = results[winner].value;
            assert.equal(
                (await Booking.create(winner + 1, requests[winner])).id,
                booking.id
            );
            assert.equal(
                await Booking.view(booking.id, winner === 0 ? 2 : 1),
                null
            );
            const previousApi = BookingPayment.gatewayApi;
            BookingPayment.gatewayApi = {
                initializePaystack: async ({ reference }) => ({
                    authorization_url: `https://example.com/${reference}`,
                }),
            };
            t.after(() => {
                BookingPayment.gatewayApi = previousApi;
            });
            const initialized = await BookingPayment.initiate(
                winner + 1,
                booking.id
            );
            const event = {
                reference: initialized.reference,
                amount: 2050,
                currency: 'NGN',
                status: 'success',
            };
            const confirmations = await Promise.all([
                BookingPayment.settle('paystack', event, 'event-1'),
                BookingPayment.settle('paystack', event, 'event-1'),
            ]);
            assert.ok(confirmations.every((r) => r.status === 'confirmed'));
            assert.equal(
                (await db.query('SELECT count(*) FROM notifications')).rows[0]
                    .count,
                '1'
            );
            assert.equal(
                (await db.query('SELECT order_id FROM payments')).rows[0]
                    .order_id,
                null
            );
            await assert.rejects(
                db.query('UPDATE payments SET order_id = 1'),
                /payments_booking_order_check/
            );
            await assert.rejects(
                db.query('INSERT INTO order_items (order_id) VALUES (1)'),
                /not-null/
            );
            const cancelled = await Booking.change(
                booking.id,
                winner + 1,
                false,
                { reason: 'No longer needed' }
            );
            assert.equal(cancelled.booking_status, 'cancelled');
            assert.equal(cancelled.refund_due, '20.50');
            assert.equal(
                (await Booking.availability(1, request.scheduled_for))
                    .remaining_capacity,
                1
            );
            const next = await Booking.create(1, {
                ...request,
                idempotency_key: randomUUID(),
            });
            const nextPayment = await BookingPayment.initiate(1, next.id);
            await db.query(
                "UPDATE service_bookings SET reservation_expires_at = NOW() - INTERVAL '1 second' WHERE id = $1",
                [next.id]
            );
            const late = await BookingPayment.settle('paystack', {
                ...event,
                reference: nextPayment.reference,
            });
            assert.equal(late.status, 'payment_review');
            assert.equal(
                (await Booking.availability(1, request.scheduled_for))
                    .remaining_capacity,
                1
            );
        } finally {
            await db.end();
            await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
            await admin.end();
        }
    }
);
