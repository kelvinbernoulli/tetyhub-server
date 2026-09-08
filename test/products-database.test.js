import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import pool from '../src/services/pg_pool.js';
import Product from '../src/models/products.model.js';

// Opt-in: exercises real SQL inside an outer transaction that is always rolled back.
test(
    'product database lifecycle and visibility',
    { skip: process.env.PRODUCT_DATABASE_TESTS !== '1' },
    async (t) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL statement_timeout = '15s'");
            const vendors = await client.query(
                'SELECT id FROM vendors ORDER BY id LIMIT 1'
            );
            const currencies = await client.query(
                'SELECT id FROM currencies ORDER BY id LIMIT 1'
            );
            assert.ok(
                vendors.rows.length && currencies.rows.length,
                'An existing vendor and currency are required'
            );
            const vendorId = vendors.rows[0].id;
            const marker = `product-test-${randomUUID()}`;
            const category = (
                await client.query(
                    "INSERT INTO categories (name, slug, type, status) VALUES ($1, $1, 'product', true) RETURNING id",
                    [marker]
                )
            ).rows[0];
            const subcategory = (
                await client.query(
                    'INSERT INTO subcategories (category_id, name, slug, status) VALUES ($1, $2, $2, true) RETURNING id',
                    [category.id, marker]
                )
            ).rows[0];
            const child = (
                await client.query(
                    'INSERT INTO childcategories (subcategory_id, name, slug, status) VALUES ($1, $2, $2, true) RETURNING id',
                    [subcategory.id, marker]
                )
            ).rows[0];
            const proxy = {
                query(sql, values) {
                    if (sql === 'BEGIN')
                        return client.query('SAVEPOINT product_operation');
                    if (sql === 'COMMIT')
                        return client.query(
                            'RELEASE SAVEPOINT product_operation'
                        );
                    if (sql === 'ROLLBACK')
                        return client.query(
                            'ROLLBACK TO SAVEPOINT product_operation'
                        );
                    return client.query(sql, values);
                },
                release() {},
            };
            t.mock.method(pool, 'connect', async () => proxy);
            t.mock.method(pool, 'query', (sql, values) =>
                client.query(sql, values)
            );
            const payload = {
                name: marker,
                sku: 'PRODUCT-SKU',
                barcode: '1234',
                price: 10,
                compare_at_price: 20,
                cost_price: 5,
                stock: 1,
                category_id: category.id,
                subcategory_id: subcategory.id,
                childcategory_id: child.id,
                currency_id: currencies.rows[0].id,
                status: 'draft',
                has_variants: true,
                attributes: [{ name: 'Material', value: 'Cotton' }],
                options: [{ name: 'Size', values: ['M', 'L'] }],
                variants: [
                    {
                        sku: 'M',
                        price: 10,
                        cost_price: 5,
                        stock: 1,
                        options: { Size: 'M' },
                    },
                    { sku: 'L', price: 12, stock: 0, options: { Size: 'L' } },
                ],
            };
            const created = await Product.create(vendorId, payload);
            assert.equal(created.sku, 'PRODUCT-SKU');
            assert.equal(created.barcode, '1234');
            assert.equal(created.childcategory_id, child.id);
            assert.equal(created.attributes.length, 1);
            assert.equal(created.options[0].values.length, 2);
            assert.equal(created.variants.length, 2);
            assert.equal(created.variants[0].option_values.length, 1);
            assert.equal(await Product.findPublicById(created.id), null);
            assert.equal(
                (await Product.list({ q: marker })).pagination.total,
                0
            );
            assert.equal(
                (await Product.list({ q: marker }, vendorId)).pagination.total,
                1
            );
            assert.equal(
                await Product.update(created.id, vendorId + 1000000, {
                    price: 1,
                }),
                null
            );
            await assert.rejects(
                Product.update(created.id, vendorId, { price: 30 }),
                /Compare At Price/
            );
            const updated = await Product.update(created.id, vendorId, {
                status: 'active',
                is_featured: true,
                variants: [{ id: created.variants[0].id, price: 11, stock: 3 }],
            });
            assert.equal(updated.variants[0].id, created.variants[0].id);
            assert.deepEqual(
                updated.variants[0].option_values,
                created.variants[0].option_values
            );
            const archived = (
                await client.query(
                    'SELECT status FROM product_variants WHERE id = $1',
                    [created.variants[1].id]
                )
            ).rows[0];
            assert.equal(archived.status, 'archived');
            const publicProduct = await Product.findPublicById(created.id);
            assert.equal(publicProduct.cost_price, undefined);
            assert.equal(publicProduct.variants[0].cost_price, undefined);
            assert.equal(publicProduct.variants.length, 1);
            const search = await Product.search(null, {
                q: marker,
                min_price: 0,
                max_price: 10,
                limit: 1,
            });
            assert.equal(search.products.length, 1);
            assert.equal(
                (await Product.list({ q: marker, offset: 1, limit: 1 })).data
                    .length,
                0
            );
            assert.ok(
                (await Product.getFeaturedProducts(100, vendorId)).some(
                    (row) => row.id === created.id
                )
            );
            assert.ok(
                (await Product.getFilters(vendorId)).categories.some(
                    (row) => row.id === category.id
                )
            );
            const second = await Product.create(vendorId, {
                ...payload,
                name: `${marker}-second`,
                status: 'active',
            });
            assert.ok(
                (await Product.getRelatedProducts(created.id, 100)).some(
                    (row) => row.id === second.id
                )
            );
            await assert.rejects(
                Product.update(created.id, vendorId, {
                    variants: [
                        {
                            id: created.variants[0].id,
                            price: 10,
                            stock: 1,
                            option_values: second.variants[0].option_values,
                        },
                    ],
                }),
                /must belong/
            );
            await Product.update(created.id, vendorId, { has_variants: false });
            assert.equal(
                (await Product.findById(created.id, vendorId)).has_variants,
                false
            );
            assert.equal(
                await Product.delete(created.id, vendorId + 1000000),
                null
            );
            await Product.delete(created.id, vendorId);
            assert.equal(await Product.findPublicById(created.id), null);
            assert.equal(await Product.findById(created.id, vendorId), null);
            assert.equal(
                (
                    await client.query(
                        'SELECT id FROM product_variants WHERE product_id = $1',
                        [created.id]
                    )
                ).rows.length,
                2
            );
        } finally {
            await client.query('ROLLBACK');
            client.release();
            await pool.end();
        }
    }
);
