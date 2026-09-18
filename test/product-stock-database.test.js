import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from 'pg';
import {
    productStockSql,
    productAvailableSql,
} from '../src/utils/product-stock.js';

test(
    'derived stock follows active SKUs, reservations, releases and tracking',
    {
        skip: !process.env.CHECKOUT_DATABASE_URL,
    },
    async () => {
        const client = new Client({
            connectionString: process.env.CHECKOUT_DATABASE_URL,
            connectionTimeoutMillis: 5000,
        });
        await client.connect();
        try {
            await client.query('BEGIN');
            await client.query(`CREATE TEMP TABLE products (id int PRIMARY KEY, stock int,
            has_variants boolean, track_inventory boolean) ON COMMIT DROP;
            CREATE TEMP TABLE product_variants (id int PRIMARY KEY, product_id int, stock int, status text) ON COMMIT DROP;
            INSERT INTO products VALUES (1, 200, true, true), (2, 5, false, true);
            INSERT INTO product_variants VALUES (1, 1, 10, 'active'), (2, 1, 190, 'archived');`);
            const read = async () =>
                (
                    await client.query(`SELECT ${productStockSql} AS stock,
            ${productAvailableSql} AS in_stock FROM products p WHERE id = 1`)
                ).rows[0];
            assert.deepEqual(await read(), { stock: 10, in_stock: true });
            await client.query(
                'UPDATE product_variants SET stock = stock - 10 WHERE id = 1'
            );
            assert.deepEqual(await read(), { stock: 0, in_stock: false });
            await client.query(
                'UPDATE product_variants SET stock = stock + 10 WHERE id = 1'
            );
            assert.deepEqual(await read(), { stock: 10, in_stock: true });
            await client.query(
                'UPDATE product_variants SET stock = 0 WHERE id = 1'
            );
            await client.query(
                'UPDATE products SET track_inventory = false WHERE id = 1'
            );
            assert.deepEqual(await read(), { stock: 0, in_stock: true });
            await client.query(
                "UPDATE product_variants SET status = 'archived' WHERE id = 1"
            );
            assert.deepEqual(await read(), { stock: 0, in_stock: false });
            assert.equal(
                (
                    await client.query(
                        `SELECT ${productStockSql} AS stock FROM products p WHERE id = 2`
                    )
                ).rows[0].stock,
                5
            );
        } finally {
            await client.query('ROLLBACK');
            await client.end();
        }
    }
);
