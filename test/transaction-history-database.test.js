import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import pool from '../src/services/pg_pool.js';
import TransactionHistory from '../src/models/transaction.history.model.js';

const connectionString = process.env.TRANSACTION_DATABASE_URL;
test('PostgreSQL transaction history scopes mixed orders and bookings without leaking checkout data', { skip: !connectionString, timeout: 60000 }, async t => {
    const namespace = `transaction_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString, connectionTimeoutMillis: 5000 });
    const db = new Pool({ connectionString, options: `-c search_path=${namespace}`, connectionTimeoutMillis: 5000 });
    try {
        await admin.query(`CREATE SCHEMA "${namespace}"`);
        await db.query(`
            CREATE TABLE users (id INTEGER PRIMARY KEY, firstname TEXT, lastname TEXT);
            CREATE TABLE currencies (id INTEGER PRIMARY KEY, code TEXT);
            CREATE TABLE vendor_settings (vendor_id INTEGER PRIMARY KEY, store_name TEXT);
            CREATE TABLE orders (id INTEGER PRIMARY KEY, order_number TEXT, status TEXT, total NUMERIC, payment_status TEXT);
            CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id INTEGER, vendor_id INTEGER, subtotal NUMERIC);
            CREATE TABLE service_bookings (id INTEGER PRIMARY KEY, vendor_id INTEGER, booking_status TEXT, service_name TEXT, total NUMERIC, payment_status TEXT);
            CREATE TABLE payments (id SERIAL PRIMARY KEY, user_id INTEGER, order_id INTEGER, vendor_id INTEGER, gateway TEXT, gateway_ref TEXT,
                amount NUMERIC, currency_id INTEGER, status TEXT, paid_at TIMESTAMP, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP,
                checkout_data TEXT, meta TEXT, provider_ref TEXT, initializing_until TIMESTAMP);
            INSERT INTO users VALUES (2,'Buyer','One'), (9,'Buyer','Two');
            INSERT INTO currencies VALUES (1,'NGN');
            INSERT INTO vendor_settings VALUES (5,'First Store'), (6,'Second Store');
            INSERT INTO orders VALUES (1,'ORDER1','delivered',100,'paid'), (2,'ORDER2','pending',40,'unpaid');
            INSERT INTO order_items VALUES (1,1,5,20), (2,1,5,30), (3,1,6,50), (4,2,6,40);
            INSERT INTO service_bookings VALUES (1,5,'completed','Service',25,'paid');
        `);
        await db.query(await readFile(new URL('../prisma/migrations/20260925140000_restore_booking_payment_history/migration.sql', import.meta.url), 'utf8'));
        await db.query(`
            INSERT INTO payments (user_id,order_id,booking_id,vendor_id,gateway,gateway_ref,amount,currency_id,status,checkout_data,meta)
            VALUES (2,1,NULL,NULL,'stripe','order-1',100,1,'success','private secret','private metadata'),
                   (2,NULL,1,5,'stripe','booking-1',25,1,'success','private secret','private metadata'),
                   (9,2,NULL,NULL,'stripe','order-2',40,1,'pending','private secret','private metadata');
        `);
        t.mock.method(pool, 'query', (...args) => db.query(...args));
        const own = await TransactionHistory.fetchTransactions(2);
        assert.equal(own.length, 2);
        assert.deepEqual(own.map(x => x.id), [2, 1]);
        assert.equal(await TransactionHistory.getTransactionById(3, 2), null);
        const vendor = await TransactionHistory.fetchVendorTransactions(5);
        assert.equal(vendor.length, 2);
        assert.deepEqual(vendor.map(x => x.id), [2, 1]);
        assert.equal(vendor[1].vendor_item_subtotal, '50');
        assert.deepEqual(vendor[1].vendors, [{ vendor_id: 5, vendor_name: 'First Store' }]);
        assert.equal((await TransactionHistory.fetchVendorTransactions(6)).length, 2);
        assert.equal((await TransactionHistory.fetchVendorTransactions(999)).length, 0);
        const booking = await TransactionHistory.fetchVendorTransactions(5, { type: 'booking', payment_status: 'paid' });
        assert.equal(booking.length, 1);
        assert.equal(booking[0].booking_id, 1);
        assert.equal(booking[0].booking_status, 'completed');
        assert.equal(booking[0].payment_status, 'paid');
        const all = await TransactionHistory.fetchAllTransactions();
        assert.equal(all.length, 3);
        assert.equal((await TransactionHistory.fetchAllTransactions({ vendor_id: 5 })).length, 2);
        assert.equal((await TransactionHistory.fetchAllTransactions({ payment_status: 'unpaid' })).length, 1);
        assert.equal((await TransactionHistory.fetchAllTransactions({ limit: 1, offset: 1 }))[0].id, 2);
        for (const row of [...own, ...vendor, ...all]) {
            for (const field of ['checkout_data', 'meta', 'provider_ref', 'initializing_until']) assert.ok(!Object.hasOwn(row, field));
        }
        await assert.rejects(db.query('INSERT INTO payments (booking_id) VALUES (1)'), /unique constraint/);
        await assert.rejects(db.query('INSERT INTO payments (order_id,booking_id) VALUES (1,2)'), /check constraint/);
    } finally {
        await db.end();
        await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
        await admin.end();
    }
});
