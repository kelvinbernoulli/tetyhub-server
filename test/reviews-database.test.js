import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import pool from '../src/services/pg_pool.js';
import Review from '../src/models/review.model.js';

const connectionString = process.env.REVIEW_DATABASE_URL;
test(
    'PostgreSQL review migration, concurrent duplicates, moderation, visibility and rating totals',
    { skip: !connectionString, timeout: 60000 },
    async (t) => {
        const namespace = `review_test_${randomUUID().replaceAll('-', '')}`;
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
            CREATE TABLE users (id SERIAL PRIMARY KEY, firstname TEXT, status TEXT DEFAULT 'active', role TEXT DEFAULT 'customer');
            CREATE TABLE vendors (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), status TEXT DEFAULT 'active');
            CREATE TABLE products (id SERIAL PRIMARY KEY, vendor_id INTEGER REFERENCES vendors(id), status TEXT DEFAULT 'active', deleted_at TIMESTAMP);
            CREATE TABLE services (id SERIAL PRIMARY KEY, vendor_id INTEGER REFERENCES vendors(id), status TEXT DEFAULT 'active', deleted_at TIMESTAMP);
            CREATE TABLE orders (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), status TEXT, payment_status TEXT);
            CREATE TABLE order_items (id SERIAL PRIMARY KEY, order_id INTEGER REFERENCES orders(id), product_id INTEGER REFERENCES products(id));
            CREATE TABLE service_bookings (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), service_id INTEGER REFERENCES services(id), booking_status TEXT, payment_status TEXT);
            CREATE TABLE reviews (id SERIAL PRIMARY KEY, product_id INTEGER REFERENCES products(id), service_id INTEGER REFERENCES services(id), user_id INTEGER REFERENCES users(id), order_id INTEGER, rating INTEGER DEFAULT 5,
                title TEXT, comment TEXT, status TEXT DEFAULT 'pending', verified_purchase BOOLEAN DEFAULT false, helpful_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP);
            CREATE TABLE notifications (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), type TEXT, title TEXT, message TEXT, metadata TEXT);
            CREATE TABLE admins (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), vendor_id INTEGER, scope TEXT, status TEXT);
            CREATE TABLE admin_types (id SERIAL PRIMARY KEY, admin_type TEXT UNIQUE, slug TEXT UNIQUE, description TEXT, scope TEXT, is_system BOOLEAN, status BOOLEAN, updated_at TIMESTAMP);
            CREATE TABLE admin_permissions (admin_id INTEGER, admin_type_id INTEGER, status BOOLEAN, can_read BOOLEAN, expires_at TIMESTAMP);
            INSERT INTO users (firstname,role) VALUES ('Buyer','customer'),('Seller','vendor'),('Moderator','admin'),('Other buyer','customer');
            INSERT INTO vendors (user_id) VALUES (2);
            INSERT INTO products (vendor_id) VALUES (1),(1);
            INSERT INTO services (vendor_id) VALUES (1);
            INSERT INTO orders (user_id,status,payment_status) VALUES (1,'delivered','paid'),(4,'processing','paid');
            INSERT INTO order_items (order_id,product_id) VALUES (1,1),(2,1);
            INSERT INTO service_bookings (user_id,service_id,booking_status,payment_status) VALUES (1,1,'completed','paid');
            INSERT INTO admins (user_id,scope,status) VALUES (3,'platform','active');
            INSERT INTO reviews (user_id,product_id,rating) VALUES (1,1,9);
        `);
            const migration = await readFile(
                new URL(
                    '../prisma/migrations/20260924170000_reviews_and_ratings/migration.sql',
                    import.meta.url
                ),
                'utf8'
            );
            const client = await db.connect();
            try {
                await client.query('BEGIN');
                await assert.rejects(
                    client.query(migration),
                    /Correct existing reviews/
                );
                await client.query('ROLLBACK');
            } finally {
                client.release();
            }
            assert.equal(
                (await db.query('SELECT rating FROM reviews')).rows[0].rating,
                9
            );
            await db.query('DELETE FROM reviews');
            await db.query(migration);
            await db.query(
                "INSERT INTO admin_permissions SELECT 1,id,true,true,NULL FROM admin_types WHERE slug = 'reviews'"
            );
            t.mock.method(pool, 'query', (...args) => db.query(...args));
            t.mock.method(pool, 'connect', () => db.connect());
            await assert.rejects(
                Review.create('product', 1, 4, { rating: 4 }),
                { status: 403 }
            );
            const raced = await Promise.allSettled([
                Review.create('product', 1, 1, {
                    rating: 5,
                    comment: 'Excellent',
                }),
                Review.create('product', 1, 1, { rating: 4, comment: 'Good' }),
            ]);
            assert.equal(
                raced.filter((result) => result.status === 'fulfilled').length,
                1
            );
            assert.equal(
                raced.find((result) => result.status === 'rejected').reason
                    .status,
                409
            );
            const review = raced.find(
                (result) => result.status === 'fulfilled'
            ).value;
            assert.equal(review.order_id, 1);
            assert.equal(review.verified_purchase, true);
            assert.equal((await Review.listPublic('product', 1)).total, 0);
            assert.equal(
                (
                    await db.query(
                        'SELECT COUNT(*)::integer AS total FROM notifications WHERE user_id = 3'
                    )
                ).rows[0].total,
                1
            );
            await assert.rejects(Review.update(review.id, 4, { rating: 1 }), {
                status: 404,
            });
            const approved = await Review.moderate(review.id, 3, {
                status: 'approved',
                revision: review.revision,
            });
            let visible = await Review.listPublic('product', 1);
            assert.equal(visible.total, 1);
            assert.equal(visible.summary.average_rating, review.rating);
            assert.equal(visible.rows[0].order_id, undefined);
            assert.equal(visible.rows[0].user_id, undefined);
            const edited = await Review.update(review.id, 1, { rating: 2 });
            assert.equal(edited.status, 'pending');
            assert.equal(
                (await Review.listPublic('product', 1)).summary.average_rating,
                null
            );
            await assert.rejects(
                Review.moderate(review.id, 3, {
                    status: 'approved',
                    revision: approved.revision,
                }),
                { status: 409 }
            );
            await Review.moderate(review.id, 3, {
                status: 'approved',
                revision: edited.revision,
            });
            await db.query(
                "UPDATE orders SET status = 'delivered' WHERE id = 2"
            );
            const other = await Review.create('product', 1, 4, { rating: 4 });
            await Review.moderate(other.id, 3, {
                status: 'approved',
                revision: other.revision,
            });
            visible = await Review.listPublic('product', 1, {
                rating: 4,
                limit: 1,
            });
            assert.equal(visible.total, 1);
            assert.equal(visible.summary.review_count, 2);
            assert.equal(visible.summary.average_rating, 3);
            assert.deepEqual(visible.summary.ratings, {
                1: 0,
                2: 1,
                3: 0,
                4: 1,
                5: 0,
            });
            const service = await Review.create('service', 1, 1, { rating: 5 });
            assert.equal(service.booking_id, 1);
            assert.equal(service.order_id, null);
            await Review.moderate(service.id, 3, {
                status: 'approved',
                revision: 1,
            });
            assert.equal(
                (await Review.listPublic('service', 1)).summary.average_rating,
                5
            );
            await db.query(
                "UPDATE orders SET payment_status = 'refunded' WHERE id = 1"
            );
            await assert.rejects(Review.update(review.id, 1, { rating: 1 }), {
                status: 403,
            });
            await Review.delete(review.id, 1);
            assert.equal(
                (await Review.listPublic('product', 1)).summary.average_rating,
                4
            );
            await assert.rejects(
                db.query(
                    'INSERT INTO reviews (user_id,product_id,service_id,rating) VALUES (4,2,1,4)'
                ),
                { code: '23514' }
            );
            await assert.rejects(
                db.query(
                    'INSERT INTO reviews (user_id,product_id,rating) VALUES (4,2,0)'
                ),
                { code: '23514' }
            );
            await db.query("UPDATE products SET status = 'draft' WHERE id = 1");
            await assert.rejects(Review.listPublic('product', 1), {
                status: 404,
            });
        } finally {
            t.mock.restoreAll();
            await db.end();
            await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
            await admin.end();
        }
    }
);
