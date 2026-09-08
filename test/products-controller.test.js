import test from 'node:test';
import assert from 'node:assert/strict';
import Product from '../src/models/products.model.js';
import * as controller from '../src/controllers/product.controller.js';

const response = () => ({
    status(code) {
        this.code = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
});
const request = (extra = {}) => ({
    params: {},
    query: {},
    auth: { userId: 100, vendorId: 3 },
    ...extra,
});

test('vendor update passes authenticated vendor ID, validated product ID and body', async (t) => {
    let received;
    t.mock.method(Product, 'update', async (...args) => {
        received = args;
        return { id: 7 };
    });
    const res = response();
    await controller.updateProduct(
        request({ params: { id: '7' }, body: { stock: 0 } }),
        res
    );
    assert.equal(res.code, 200);
    assert.deepEqual(received, [7, 3, { stock: 0 }]);
});

test('public and vendor listing have distinct scopes and preserve query parameters', async (t) => {
    const calls = [];
    t.mock.method(Product, 'list', async (...args) => {
        calls.push(args);
        return { data: [] };
    });
    const req = request({
        query: { offset: '40', limit: '5', category_id: '8' },
    });
    await controller.fetchProducts(req, response());
    await controller.fetchVendorProducts(req, response());
    assert.equal(calls[0][1], undefined);
    assert.equal(calls[1][1], 3);
    assert.deepEqual(calls[0][0], { offset: 40, limit: 5, category_id: 8 });
});

test('public reads reject draft requests and vendor scope cannot be overridden', async (t) => {
    t.mock.method(Product, 'list', () => assert.fail('must not query'));
    for (const [handler, query] of [
        [controller.fetchProducts, { status: 'draft' }],
        [controller.fetchVendorProducts, { vendor_id: '99' }],
    ]) {
        const res = response();
        await handler(request({ query }), res);
        assert.equal(res.code, 400);
    }
});

test('public detail works without a session and different IDs are read independently', async (t) => {
    const ids = [];
    t.mock.method(Product, 'findPublicById', async (id) => {
        ids.push(id);
        return { id };
    });
    for (const productId of ['7', '8']) {
        const res = response();
        await controller.fetchProductById({ params: { productId } }, res);
        assert.equal(res.code, 200);
        assert.equal(res.body.result.id, Number(productId));
    }
    assert.deepEqual(ids, [7, 8]);
});

test('search, related and featured handlers pass correct arguments without authentication', async (t) => {
    t.mock.method(Product, 'search', async (vendor, value) => {
        assert.equal(vendor, null);
        assert.equal(value.q, 'shirt');
        return {};
    });
    t.mock.method(Product, 'getRelatedProducts', async (productId, limit) => {
        assert.equal(productId, 7);
        assert.equal(limit, 8);
        return [];
    });
    t.mock.method(Product, 'getFeaturedProducts', async (limit, vendorId) => {
        assert.equal(limit, 10);
        assert.equal(vendorId, 3);
        return [];
    });
    for (const [handler, req] of [
        [controller.searchProducts, { query: { q: 'shirt' } }],
        [
            controller.getRelatedProducts,
            { params: { productId: '7' }, query: { limit: '8' } },
        ],
        [
            controller.getFeaturedProducts,
            { query: { limit: '10', vendor_id: '3' } },
        ],
    ]) {
        const res = response();
        await handler(req, res);
        assert.equal(res.code, 200);
    }
});

test('invalid IDs are rejected before querying and internal errors are not exposed', async (t) => {
    t.mock.method(Product, 'findPublicById', async () => {
        throw new Error('password=secret SQL internals');
    });
    t.mock.method(console, 'error', () => {});
    const invalid = response();
    await controller.fetchProductById({ params: { productId: '1x' } }, invalid);
    assert.equal(invalid.code, 400);
    const failed = response();
    await controller.fetchProductById({ params: { productId: '7' } }, failed);
    assert.equal(failed.code, 500);
    assert.equal(failed.body.message, 'Internal Server Error');
});

test('delete requires trusted vendor context and returns not found for missing products', async (t) => {
    t.mock.method(Product, 'delete', async (id, vendorId) => {
        assert.equal(id, 7);
        assert.equal(vendorId, 3);
        return null;
    });
    const denied = response();
    await controller.deleteProduct(
        { params: { id: '7' }, session: { user: { vendor_id: 3 } } },
        denied
    );
    assert.equal(denied.code, 403);
    const missing = response();
    await controller.deleteProduct(request({ params: { id: '7' } }), missing);
    assert.equal(missing.code, 404);
});
