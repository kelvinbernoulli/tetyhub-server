import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import pool from '../src/services/pg_pool.js';
import {
    processCheckout,
    expireReservations,
} from '../src/services/checkout.service.js';
import Payment from '../src/models/payment.model.js';

// Only an explicitly supplied test database is used. All fixtures live in a unique schema.
test(
    'PostgreSQL checkout migration, concurrent last-item purchase, retry, webhook and expiry',
    {
        skip: !process.env.CHECKOUT_DATABASE_URL,
        timeout: 60000,
    },
    async (t) => {
        const schema = `checkout_test_${randomUUID().replaceAll('-', '')}`;
        const admin = new Pool({
            connectionString: process.env.CHECKOUT_DATABASE_URL,
            connectionTimeoutMillis: 5000,
        });
        const db = new Pool({
            connectionString: process.env.CHECKOUT_DATABASE_URL,
            options: `-c search_path=${schema}`,
            max: 8,
            connectionTimeoutMillis: 5000,
            statement_timeout: 15000,
        });
        try {
            await admin.query(`CREATE SCHEMA "${schema}"`);
            await db.query(`
            CREATE TABLE users (id SERIAL PRIMARY KEY, firstname TEXT, email TEXT);
            CREATE TABLE vendors (id SERIAL PRIMARY KEY);
            CREATE TABLE currencies (id SERIAL PRIMARY KEY, code TEXT UNIQUE, status BOOLEAN DEFAULT true);
            CREATE TABLE countries (id SERIAL PRIMARY KEY, name TEXT);
            CREATE TABLE products (id SERIAL PRIMARY KEY,vendor_id INT,currency_id INT,name TEXT,thumbnail TEXT,
                price NUMERIC(10,2),stock INT,track_inventory BOOLEAN DEFAULT true,has_variants BOOLEAN DEFAULT false,
                free_shipping BOOLEAN DEFAULT true,status TEXT DEFAULT 'active',deleted_at TIMESTAMP,updated_at TIMESTAMP);
            CREATE TABLE product_variants (id SERIAL PRIMARY KEY,product_id INT,price NUMERIC(10,2),stock INT,status TEXT,updated_at TIMESTAMP);
            CREATE TABLE carts (id SERIAL PRIMARY KEY,user_id INT UNIQUE,updated_at TIMESTAMP);
            CREATE TABLE cart_items (id SERIAL PRIMARY KEY,cart_id INT REFERENCES carts(id),product_id INT REFERENCES products(id),variant_id INT,quantity INT,price NUMERIC(10,2));
            CREATE TABLE coupons (id SERIAL PRIMARY KEY,vendor_id INT,product_id INT,service_id INT,code TEXT,type TEXT,value NUMERIC(10,2),
                min_order NUMERIC(10,2) DEFAULT 0,max_discount NUMERIC(10,2),usage_limit INT,usage_count INT DEFAULT 0,status TEXT,expires_at TIMESTAMP);
            CREATE TABLE orders (id SERIAL PRIMARY KEY,user_id INT REFERENCES users(id),order_number TEXT UNIQUE NOT NULL,
                subtotal NUMERIC(10,2),shipping_fee NUMERIC(10,2),discount NUMERIC(10,2),total NUMERIC(10,2),payment_method TEXT,note TEXT,
                coupon_id INT,coupon_code TEXT,status TEXT DEFAULT 'pending',payment_status TEXT DEFAULT 'unpaid',updated_at TIMESTAMP,created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE order_items (id SERIAL PRIMARY KEY,order_id INT REFERENCES orders(id),vendor_id INT NOT NULL,product_id INT,variant_id INT,quantity INT,price NUMERIC(10,2),subtotal NUMERIC(10,2));
            CREATE TABLE payments (id SERIAL PRIMARY KEY,order_id INT REFERENCES orders(id),user_id INT,gateway TEXT,gateway_ref TEXT UNIQUE,
                amount NUMERIC(10,2),currency_id INT NOT NULL,status TEXT DEFAULT 'pending',meta TEXT,updated_at TIMESTAMP,created_at TIMESTAMP DEFAULT NOW());
            CREATE TABLE shipping_addresses (id SERIAL PRIMARY KEY,order_id INT NOT NULL REFERENCES orders(id),user_id INT NOT NULL,
                firstname TEXT,lastname TEXT,phone_one TEXT,phone_two TEXT,address TEXT,city TEXT,state TEXT,country_id INT NOT NULL,zip_code TEXT);
        `);
            await db.query(
                await readFile(
                    new URL(
                        '../prisma/migrations/20260911120000_checkout_reliability/migration.sql',
                        import.meta.url
                    ),
                    'utf8'
                )
            );
            await db.query(`INSERT INTO users(firstname,email) VALUES ('A','a@example.com'),('B','b@example.com');
            INSERT INTO vendors DEFAULT VALUES;
            INSERT INTO currencies(code) VALUES ('NGN');
            INSERT INTO products(vendor_id,currency_id,name,price,stock) VALUES (1,1,'Last item',10,1);
            INSERT INTO carts(user_id) VALUES (1),(2);
            INSERT INTO cart_items(cart_id,product_id,quantity,price) VALUES (1,1,1,1),(2,1,1,1);`);
            t.mock.method(pool, 'connect', () => db.connect());
            t.mock.method(pool, 'query', (sql, values) =>
                db.query(sql, values)
            );
            const originalGateway = Payment.gatewayApi;
            Payment.gatewayApi = {
                initializePaystack: async ({ reference }) => ({
                    authorization_url: `https://example.com/${reference}`,
                }),
            };
            t.after(() => {
                Payment.gatewayApi = originalGateway;
            });
            const data = () => ({
                firstname: 'Buyer',
                lastname: 'Test',
                email: 'buyer@example.com',
                phone_one: '+2348012345678',
                address: 'Test Road',
                city: 'Lagos',
                state: 'Lagos',
                country: 'Nigeria',
                expected_currency: 'NGN',
                expected_total: 10,
                gateway: 'paystack',
                idempotency_key: randomUUID(),
            });
            const payloads = [data(), data()];
            const competing = await Promise.allSettled(
                payloads.map((payload, i) =>
                    processCheckout({ id: i + 1 }, payload)
                )
            );
            assert.equal(
                competing.filter((x) => x.status === 'fulfilled').length,
                1,
                'only one buyer can purchase the last item'
            );
            assert.equal(
                (await db.query('SELECT stock FROM products WHERE id = 1'))
                    .rows[0].stock,
                0
            );
            assert.equal(
                (await db.query('SELECT count(*)::int AS count FROM orders'))
                    .rows[0].count,
                1
            );
            const winner = competing.findIndex((x) => x.status === 'fulfilled');
            const result = competing[winner].value;
            const retries = await Promise.all([
                processCheckout({ id: winner + 1 }, payloads[winner]),
                processCheckout({ id: winner + 1 }, payloads[winner]),
            ]);
            assert.ok(retries.every((x) => x.order_id === result.order_id));
            assert.equal(
                (await db.query('SELECT count(*)::int AS count FROM payments'))
                    .rows[0].count,
                1
            );
            const event = {
                id: 42,
                reference: result.payment.reference,
                status: 'success',
                amount: 1000,
                currency: 'NGN',
            };
            await assert.rejects(
                Payment.settle('paystack', { ...event, amount: 999 }, 'wrong'),
                /mismatch/
            );
            assert.equal(
                (
                    await db.query(
                        'SELECT count(*)::int AS count FROM payment_events'
                    )
                ).rows[0].count,
                0
            );
            await Promise.all([
                Payment.settle('paystack', event, 'event-42'),
                Payment.settle('paystack', event, 'event-42'),
            ]);
            assert.equal(
                (await db.query('SELECT payment_status FROM orders')).rows[0]
                    .payment_status,
                'paid'
            );
            assert.equal(
                (
                    await db.query(
                        'SELECT count(*)::int AS count FROM checkout_notifications'
                    )
                ).rows[0].count,
                1
            );
            assert.equal(
                (
                    await db.query(
                        'SELECT count(*)::int AS count FROM payment_events'
                    )
                ).rows[0].count,
                1
            );
            // A second reservation expires and releases stock exactly once.
            await db.query('UPDATE products SET stock = 1 WHERE id = 1');
            const loser = winner === 0 ? 1 : 0;
            const expiring = await processCheckout(
                { id: loser + 1 },
                payloads[loser]
            );
            await db.query(
                "UPDATE orders SET reservation_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
                [expiring.order_id]
            );
            await Promise.all([expireReservations(), expireReservations()]);
            assert.equal(
                (await db.query('SELECT stock FROM products')).rows[0].stock,
                1
            );
            const late = await Payment.settle(
                'paystack',
                { ...event, reference: expiring.payment.reference },
                'late'
            );
            assert.equal(late.status, 'payment_review');
            assert.equal(
                (await db.query('SELECT stock FROM products')).rows[0].stock,
                1
            );
        } finally {
            await db.end();
            // The identifier is generated above, never accepted from user input.
            await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
            await admin.end();
        }
    }
);
