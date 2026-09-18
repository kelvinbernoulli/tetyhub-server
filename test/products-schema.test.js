import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createProductSchema as create,
    updateProductSchema as update,
    productSearchSchema as search,
} from '../src/schemas/products.schema.js';

const product = {
    name: 'Test product',
    price: 10,
    stock: 0,
    category_id: 1,
    currency_id: 1,
};

test('enabling variants requires at least one valid variant on create and update', () => {
    for (const [schema, body] of [
        [create, product],
        [update, {}],
    ]) {
        for (const variants of [undefined, [], null, [{}], ['invalid']]) {
            assert.ok(
                schema.validate(
                    { ...body, has_variants: true, variants },
                    { stripUnknown: true }
                ).error
            );
        }
        const { error, value } = schema.validate(
            {
                ...body,
                has_variants: true,
                variants: [{ price: 10, stock: 0 }],
            },
            { stripUnknown: true }
        );
        assert.equal(error, undefined);
        assert.equal(value.variants.length, 1);
        assert.ok(schema.validate({ ...body, has_variants: 'true' }).error);
    }
});

test('variants remain optional unless explicitly enabled', () => {
    assert.equal(create.validate(product).error, undefined);
    assert.equal(
        create.validate({ ...product, has_variants: false }).error,
        undefined
    );
    assert.deepEqual(update.validate({ name: 'Updated product' }).value, {
        name: 'Updated product',
    });
});

test('variant prices, stock, option IDs and unknown properties are validated', () => {
    for (const variant of [
        { price: -1, stock: 1 },
        { price: 1.234, stock: 1 },
        { price: 10, stock: -1 },
        { price: 10, stock: 1, compare_at_price: 9 },
        { price: 10, stock: 1, option_values: [0] },
        { price: 10, stock: 1, vendor_id: 42 },
    ]) {
        assert.ok(
            create.validate(
                { ...product, has_variants: true, variants: [variant] },
                { stripUnknown: true }
            ).error
        );
    }
    const { value } = create.validate({
        ...product,
        has_variants: true,
        variants: [{ price: 10, stock: 1 }],
    });
    assert.deepEqual(value.variants[0].option_values, []);
});

test('creation retains required currency and allows sold-out products', () => {
    const { error, value } = create.validate(product);
    assert.equal(error, undefined);
    assert.equal(value.currency_id, 1);
    assert.equal(value.status, 'draft');
    assert.ok(create.validate({ ...product, currency_id: undefined }).error);
});

test('unknown fields are rejected even with controller stripping preferences', () => {
    for (const schema of [create, update]) {
        assert.ok(
            schema.validate(
                { ...product, vendor_id: 42 },
                { stripUnknown: true }
            ).error
        );
    }
    assert.ok(update.validate({ vendor_id: 42 }, { stripUnknown: true }).error);
});

test('money is bounded and never silently rounded or coerced', () => {
    for (const price of [-1, 1.234, 100000000, Infinity, NaN, '10']) {
        assert.ok(create.validate({ ...product, price }).error);
        assert.ok(update.validate({ price }).error);
    }
    assert.equal(create.validate({ ...product, price: 0 }).error, undefined);
    assert.equal(update.validate({ price: 99999999.99 }).error, undefined);
});

test('comparison prices are checked and nullable update values can be cleared', () => {
    assert.ok(create.validate({ ...product, compare_at_price: 9 }).error);
    assert.ok(update.validate({ price: 10, compare_at_price: 9 }).error);
    assert.equal(
        update.validate({ price: 10, compare_at_price: null }).error,
        undefined
    );
    assert.equal(update.validate({ compare_at_price: 20 }).error, undefined);
});

test('updates require a body and do not inject creation defaults', () => {
    assert.ok(update.validate(undefined).error);
    assert.ok(update.validate({}).error);
    assert.deepEqual(update.validate({ stock: 0 }).value, { stock: 0 });
    assert.ok(update.validate({ stock: 2147483648 }).error);
});

test('tags are bounded and duplicates after trimming are rejected', () => {
    assert.ok(create.validate({ ...product, tags: ['sale', ' sale '] }).error);
    assert.ok(search.validate({ tags: ['x'.repeat(51)] }).error);
});

test('image data URLs reject unsupported types, malformed base64 and oversized files', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    assert.equal(update.validate({ thumbnail: png }).error, undefined);
    for (const thumbnail of [
        'data:image/pdf;base64,YQ==',
        'data:image/png;base64,A',
        'https://example.com/image.png',
        'data:image/png;base64,' +
            Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'),
    ]) {
        assert.ok(update.validate({ thumbnail }).error);
    }
    assert.equal(
        update.validate({ images: [], thumbnail: null }).error,
        undefined
    );
});

test('search coerces query parameters and rejects inverted ranges', () => {
    const { error, value } = search.validate({
        min_price: '0',
        max_price: '10',
        in_stock: 'false',
        limit: '20',
    });
    assert.equal(error, undefined);
    assert.equal(value.min_price, 0);
    assert.equal(value.in_stock, false);
    assert.equal(value.limit, 20);
    assert.ok(search.validate({ min_price: 20, max_price: 10 }).error);
    assert.ok(search.validate({ limit: 101 }).error);
});

test('false variant flag rejects nonempty variants and duplicate update IDs are rejected', () => {
    assert.ok(
        create.validate({
            ...product,
            has_variants: false,
            variants: [{ price: 10, stock: 1 }],
        }).error
    );
    assert.ok(
        update.validate({
            has_variants: false,
            variants: [{ price: 10, stock: 1 }],
        }).error
    );
    assert.ok(
        update.validate({
            variants: [
                { id: 1, price: 10, stock: 1 },
                { id: 1, price: 20, stock: 1 },
            ],
        }).error
    );
    assert.equal(
        update.validate({
            variants: [
                { price: 10, stock: 1 },
                { price: 20, stock: 1 },
            ],
        }).error,
        undefined
    );
});

test('product identifiers and option mappings survive validation', () => {
    const payload = {
        ...product,
        sku: 'PRODUCT-1',
        barcode: '123',
        childcategory_id: 2,
        has_variants: true,
        options: [{ name: 'Size', values: ['M', 'L'] }],
        attributes: [{ name: 'Material', value: 'Cotton' }],
        variants: [{ price: 10, stock: 1, options: { Size: 'M' } }],
    };
    const { error, value } = create.validate(payload);
    assert.equal(error, undefined);
    assert.equal(value.sku, 'PRODUCT-1');
    assert.deepEqual(value.variants[0].options, { Size: 'M' });
    assert.equal(
        update.validate({ sku: null, barcode: '456' }).error,
        undefined
    );
});

test('variant product creation needs only variant stock; simple products require stock', () => {
    assert.ifError(
        create.validate({
            ...product,
            stock: undefined,
            has_variants: true,
            variants: [{ price: 10, stock: 10 }],
        }).error
    );
    assert.ok(create.validate({ ...product, stock: undefined }).error);
});
