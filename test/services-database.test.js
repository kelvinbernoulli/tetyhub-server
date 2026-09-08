import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import pool from '../src/services/pg_pool.js';
import Services from '../src/models/services.model.js';
import { createServiceSchema } from '../src/schemas/services.schema.js';

test(
    'service PostgreSQL lifecycle, location updates and vendor isolation',
    { skip: process.env.SERVICE_DATABASE_TESTS !== '1' },
    async (t) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query("SET LOCAL statement_timeout = '15s'");
            const vendorId = (
                await client.query('SELECT id FROM vendors ORDER BY id LIMIT 1')
            ).rows[0]?.id;
            const currencyId = (
                await client.query(
                    'SELECT id FROM currencies ORDER BY id LIMIT 1'
                )
            ).rows[0]?.id;
            assert.ok(
                vendorId && currencyId,
                'An existing vendor and currency are required'
            );
            const marker = `service-test-${randomUUID()}`;
            const categoryId = (
                await client.query(
                    "INSERT INTO categories (name, slug, type, status) VALUES ($1, $1, 'service', true) RETURNING id",
                    [marker]
                )
            ).rows[0].id;
            const subcategoryId = (
                await client.query(
                    'INSERT INTO subcategories (category_id, name, slug, status) VALUES ($1, $2, $2, true) RETURNING id',
                    [categoryId, marker]
                )
            ).rows[0].id;
            const childId = (
                await client.query(
                    'INSERT INTO childcategories (subcategory_id, name, slug, status) VALUES ($1, $2, $2, true) RETURNING id',
                    [subcategoryId, marker]
                )
            ).rows[0].id;
            const productCategory = (
                await client.query(
                    "INSERT INTO categories (name, slug, type, status) VALUES ($1, $1, 'product', true) RETURNING id",
                    [`${marker}-product`]
                )
            ).rows[0].id;
            const proxy = {
                query(sql, values) {
                    if (sql === 'BEGIN')
                        return client.query('SAVEPOINT service_operation');
                    if (sql === 'COMMIT')
                        return client.query(
                            'RELEASE SAVEPOINT service_operation'
                        );
                    if (sql === 'ROLLBACK')
                        return client.query(
                            'ROLLBACK TO SAVEPOINT service_operation'
                        );
                    return client.query(sql, values);
                },
                release() {},
            };
            t.mock.method(pool, 'connect', async () => proxy);
            t.mock.method(pool, 'query', (sql, values) =>
                client.query(sql, values)
            );
            const { value, error } = createServiceSchema.validate({
                name: marker,
                description: 'Temporary service integration test',
                category_id: categoryId,
                subcategory_id: subcategoryId,
                childcategory_id: childId,
                currency_id: currencyId,
                base_price: 10,
                compare_at_price: 20,
                location_type: 'remote',
                images: ['https://example.com/service.png'],
                tags: ['test'],
                buffer_mins: 15,
            });
            assert.equal(error, undefined);
            const service = await Services.create(vendorId, value);
            assert.ok(service.slug);
            assert.equal(service.is_remote, true);
            assert.equal(service.location_type, 'remote');
            assert.equal(service.buffer_mins, 15);
            assert.deepEqual(service.images, value.images);
            assert.equal(
                (await Services.view(service.id, vendorId)).childcategory_name,
                marker
            );
            assert.equal(
                await Services.view(service.id, vendorId + 1000000),
                null
            );
            assert.equal(
                await Services.update(service.id, vendorId + 1000000, {
                    name: 'Invalid edit',
                }),
                null
            );
            assert.equal(
                await Services.delete(service.id, vendorId + 1000000),
                null
            );
            const listed = await Services.read(vendorId, {
                childcategory_id: childId,
                min_price: 0,
                is_remote: true,
                limit: 1,
            });
            assert.equal(listed.pagination.total, 1);
            assert.equal(listed.data[0].id, service.id);
            assert.equal(
                (
                    await Services.read(vendorId, {
                        childcategory_id: childId,
                        offset: 1,
                        limit: 1,
                    })
                ).data.length,
                0
            );
            await Services.read(vendorId);
            await assert.rejects(
                Services.update(service.id, vendorId, { base_price: 30 }),
                /higher/
            );
            await assert.rejects(
                Services.update(service.id, vendorId, {
                    category_id: productCategory,
                }),
                /category/
            );
            const changed = await Services.update(service.id, vendorId, {
                name: `${marker}-changed`,
                location_type: 'customer_location',
                status: 'paused',
            });
            assert.equal(changed.is_remote, false);
            assert.equal(changed.slug, service.slug);
            const unchangedLocation = await Services.update(
                service.id,
                vendorId,
                { is_remote: false, compare_at_price: null }
            );
            assert.equal(unchangedLocation.location_type, 'customer_location');
            assert.equal(unchangedLocation.compare_at_price, null);
            await Services.update(service.id, vendorId, { is_remote: true });
            assert.equal(
                (await Services.view(service.id, vendorId)).location_type,
                'remote'
            );
            const sibling = await Services.create(vendorId, value);
            assert.notEqual(sibling.slug, service.slug);
            await Services.delete(service.id, vendorId);
            assert.equal(await Services.view(service.id, vendorId), null);
            assert.equal(
                (await Services.read(vendorId, { childcategory_id: childId }))
                    .pagination.total,
                1
            );
            const deleted = (
                await client.query(
                    'SELECT deleted_at, status FROM services WHERE id = $1',
                    [service.id]
                )
            ).rows[0];
            assert.ok(deleted.deleted_at);
            assert.equal(deleted.status, 'deleted');
        } finally {
            await client.query('ROLLBACK');
            client.release();
            await pool.end();
        }
    }
);
