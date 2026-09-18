import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../src/services/pg_pool.js';
import { Product } from '../src/models/products.model.js';
import { productObjectKey } from '../src/utils/product-media.js';

const input = {
    name: 'Test product',
    price: 10,
    stock: 0,
    category_id: 1,
    currency_id: 1,
};
const existing = {
    ...input,
    id: 7,
    vendor_id: 3,
    has_variants: true,
    compare_at_price: 20,
};
function database(t, handle = () => undefined) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        const result = await handle(sql, values);
        if (result !== undefined) return result;
        if (
            sql.startsWith('SELECT id FROM categories') ||
            sql.startsWith('SELECT id FROM currencies')
        )
            return { rows: [{ id: 1 }] };
        if (sql.startsWith('SELECT * FROM products'))
            return { rows: [existing] };
        if (sql.startsWith('INSERT INTO products'))
            return { rows: [{ id: 7 }] };
        if (sql.includes('AS avg_rating')) return { rows: [existing] };
        return { rows: [] };
    };
    const client = {
        query,
        release() {
            calls.push({ sql: 'RELEASE' });
        },
    };
    t.mock.method(pool, 'connect', async () => client);
    t.mock.method(pool, 'query', query);
    return calls;
}

for (const failRead of [false, true]) {
    test(
        failRead
            ? 'failed hydration rolls back creation'
            : 'creation hydrates before committing on the transaction connection',
        async (t) => {
            const failure = new Error('read failed');
            const calls = database(t, (sql) => {
                if (failRead && sql.includes('AS avg_rating')) throw failure;
            });
            t.mock.method(pool, 'query', async () => {
                throw new Error('must use transaction connection');
            });
            if (failRead)
                await assert.rejects(
                    Product.create(3, input),
                    (error) => error === failure
                );
            else assert.deepEqual(await Product.create(3, input), existing);
            assert.deepEqual(
                calls.slice(-2).map((call) => call.sql),
                [failRead ? 'ROLLBACK' : 'COMMIT', 'RELEASE']
            );
        }
    );
}

test('public listing enforces visibility, excludes costs, and binds pagination and filters', async (t) => {
    const calls = database(t, (sql) =>
        sql.includes('COUNT(*)::int AS total')
            ? { rows: [{ total: 1 }] }
            : undefined
    );
    const result = await Product.list({
        offset: 40,
        limit: 5,
        category_id: 8,
        status: 'draft',
        min_price: 0,
    });
    const query = calls.at(-1);
    assert.deepEqual(query.values, [8, 0, 5, 40]);
    assert.match(query.sql, /p.status = 'active'/);
    assert.match(query.sql, /p.deleted_at IS NULL/);
    assert.ok(!query.sql.includes('p.*'));
    assert.ok(!query.sql.includes('p.cost_price'));
    assert.match(query.sql, /to_jsonb\(pv\) - 'cost_price'/);
    assert.equal(result.pagination.offset, 40);
});

test('vendor list uses trusted scope and ignores a supplied vendor filter', async (t) => {
    const calls = database(t, (sql) =>
        sql.includes('COUNT(*)::int AS total')
            ? { rows: [{ total: 0 }] }
            : undefined
    );
    await Product.list({ vendor_id: 99, status: 'draft' }, 3);
    assert.deepEqual(calls.at(-1).values, [3, 'draft', 20, 0]);
    assert.match(calls.at(-1).sql, /p.vendor_id = \$1/);
});

test('price-only updates validate persisted comparison price before writing', async (t) => {
    const calls = database(t);
    await assert.rejects(
        Product.update(7, 3, { price: 30 }),
        /Compare At Price/
    );
    assert.ok(!calls.some((call) => call.sql.startsWith('UPDATE')));
    assert.match(calls[1].sql, /vendor_id = \$2.*FOR UPDATE/);
});

test('updates to another vendor product return not found without writes', async (t) => {
    const calls = database(t, (sql) =>
        sql.startsWith('SELECT * FROM products') ? { rows: [] } : undefined
    );
    assert.equal(await Product.update(7, 99, { stock: 1 }), null);
    assert.ok(!calls.some((call) => call.sql.startsWith('UPDATE')));
});

test('variant updates preserve existing IDs and archive omitted rows', async (t) => {
    const calls = database(t, (sql) =>
        sql.startsWith('SELECT * FROM product_variants')
            ? {
                  rows: [
                      { id: 11, price: 10 },
                      { id: 12, price: 10 },
                  ],
              }
            : undefined
    );
    await Product.update(7, 3, { variants: [{ id: 11, price: 15, stock: 2 }] });
    assert.ok(
        calls.some(
            (call) =>
                call.sql.startsWith('UPDATE product_variants SET price') &&
                call.values.at(-1) === 11
        )
    );
    assert.ok(
        !calls.some((call) =>
            call.sql.startsWith('DELETE FROM product_variants')
        )
    );
    const archive = calls.find((call) =>
        call.sql.includes("status = 'archived'")
    );
    assert.deepEqual(archive.values, [7, 3, [11]]);
});

test('foreign variant IDs are rejected and disabling variants archives them', async (t) => {
    const calls = database(t);
    await assert.rejects(
        Product.update(7, 3, { variants: [{ id: 99, price: 10, stock: 0 }] }),
        /does not belong/
    );
    calls.length = 0;
    await Product.update(7, 3, { has_variants: false });
    assert.deepEqual(
        calls.find((call) => call.sql.includes("status = 'archived'")).values,
        [7, 3, []]
    );
    assert.deepEqual(
        calls.find((call) => call.sql.startsWith('UPDATE products')).values,
        [0, false, 7]
    );
});

test('foreign option values roll back variant creation', async (t) => {
    database(t, (sql) =>
        sql.startsWith('INSERT INTO product_variants')
            ? { rows: [{ id: 11 }] }
            : undefined
    );
    await assert.rejects(
        Product.create(3, {
            ...input,
            has_variants: true,
            variants: [{ price: 10, stock: 1, option_values: [99] }],
        }),
        /must belong to this product/
    );
});

test('failed product creation cleans up uploaded S3 object keys', async (t) => {
    database(t, (sql) => {
        if (sql.startsWith('INSERT INTO products'))
            throw new Error('insert failed');
    });
    const deleted = [];
    t.mock.method(Product.storage, 'upload', async (_, key) => ({
        error: false,
        url: `https://bucket.s3.region.amazonaws.com/${key}`,
    }));
    t.mock.method(Product.storage, 'delete', async (key) => {
        deleted.push(key);
        return { error: false };
    });
    await assert.rejects(
        Product.create(3, { ...input, thumbnail: 'image' }),
        /insert failed/
    );
    assert.equal(deleted.length, 1);
    assert.match(deleted[0], /^products\/thumbnails\//);
});

test('soft deletion scopes by vendor and retains variant and order rows', async (t) => {
    const calls = database(t, (sql) =>
        sql.startsWith('UPDATE products') ? { rows: [{ id: 7 }] } : undefined
    );
    assert.deepEqual(await Product.delete(7, 3), { id: 7 });
    assert.deepEqual(calls[0].values, [7, 3]);
    assert.match(calls[0].sql, /deleted_at = NOW\(\)/);
    assert.ok(!calls.some((call) => call.sql.startsWith('DELETE')));
});

test('S3 cleanup converts trusted URLs to keys and rejects other buckets', () => {
    assert.equal(
        productObjectKey(
            'https://bucket.s3.region.amazonaws.com/products/images/file',
            'bucket',
            'region'
        ),
        'products/images/file'
    );
    assert.throws(() =>
        productObjectKey(
            'https://other.s3.region.amazonaws.com/products/images/file',
            'bucket',
            'region'
        )
    );
});

test('variant products reject independent stock edits', async (t) => {
    const calls = database(t);
    await assert.rejects(
        Product.update(7, 3, { stock: 200 }),
        /Manage stock through variants/
    );
    assert.ok(!calls.some(({ sql }) => sql.startsWith('UPDATE')));
});
test('variant writes ignore legacy totals and disabling variants accepts explicit stock', async (t) => {
    const calls = database(t, (sql) =>
        sql.startsWith('SELECT * FROM product_variants')
            ? { rows: [{ id: 11, price: 10 }] }
            : undefined
    );
    await Product.update(7, 3, {
        stock: 200,
        variants: [{ id: 11, price: 10, stock: 10 }],
    });
    assert.ok(
        !calls
            .find(({ sql }) => sql.startsWith('UPDATE products'))
            .sql.includes('stock =')
    );
    calls.length = 0;
    await Product.update(7, 3, { has_variants: false, stock: 12 });
    assert.deepEqual(
        calls.find(({ sql }) => sql.startsWith('UPDATE products')).values,
        [12, false, 7]
    );
});
