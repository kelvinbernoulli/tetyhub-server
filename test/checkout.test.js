import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, createHash } from 'node:crypto';
import pool from '../src/services/pg_pool.js';
import { checkoutSchema } from '../src/schemas/cart.schema.js';
import {
    minorUnits,
    shippingMinor,
    assertGatewayCurrency,
    transaction,
} from '../src/utils/checkout.js';
import {
    quote,
    processCheckout,
    expireReservations,
    releaseReservation,
} from '../src/services/checkout.service.js';
import Payment from '../src/models/payment.model.js';
import Order from '../src/models/order.model.js';
import { Cart } from '../src/models/cart.model.js';

const input = () => ({
    firstname: 'Test',
    lastname: 'Buyer',
    email: 'buyer@example.com',
    phone_one: '+2348012345678',
    address: 'Test Road',
    city: 'Lagos',
    state: 'Lagos',
    country: 'Nigeria',
    expected_currency: 'NGN',
    expected_total: 20.5,
    gateway: 'paystack',
    idempotency_key: randomUUID(),
});
const product = {
    id: 1,
    product_id: 2,
    variant_id: null,
    quantity: 2,
    vendor_id: 3,
    product_name: 'Product',
    currency: 'NGN',
    currency_id: 1,
    currency_active: true,
    price: '10.25',
    stock: 3,
    status: 'active',
    deleted_at: null,
    has_variants: false,
    track_inventory: true,
    free_shipping: true,
};

test('cart quantity updates require a variant for variant products', async (t) => {
    const calls = database(t, (sql) => {
        if (sql.includes('FROM products'))
            return { rows: [{ id: 2, status: 'active', has_variants: true }] };
    });
    assert.deepEqual(await Cart.updateCart(1, { product_id: 2, quantity: 1 }),
        { error: 'Choose a product variant', code: 422 });
    assert.ok(!calls.some(({ sql }) => sql.startsWith('UPDATE')));
});
function database(t, handler) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        const result = await handler(sql, values);
        return result ?? { rows: [], rowCount: 0 };
    };
    t.mock.method(pool, 'connect', async () => ({
        query,
        release() {
            calls.push({ sql: 'RELEASE' });
        },
    }));
    t.mock.method(pool, 'query', query);
    return calls;
}
function quoteData(sql, items = [product]) {
    if (sql.startsWith('SELECT id FROM carts')) return { rows: [{ id: 4 }] };
    if (sql.startsWith('SELECT ci.id'))
        return { rows: items.map((item) => ({ ...item })) };
}

test('tracked stock accepts sufficient quantity and rejects sold-out variants', async (t) => {
    const item = {
        ...product,
        has_variants: true,
        variant_id: 8,
        variant_status: 'active',
        variant_product_id: product.product_id,
    };
    database(t, (sql) => quoteData(sql, [item]));
    assert.equal((await quote(pool, 1)).total, '20.50');
    item.stock = 0;
    await assert.rejects(quote(pool, 1), /Insufficient stock/);
    item.track_inventory = false;
    assert.equal((await quote(pool, 1)).total, '20.50');
});

test('variant checkout reserves and releases only the selected SKU', async (t) => {
    const item = {
        ...product,
        has_variants: true,
        variant_id: 8,
        variant_status: 'active',
        variant_product_id: product.product_id,
    };
    const calls = database(t, (sql) => {
        if (sql.startsWith('SELECT price, stock'))
            return { rows: [{ ...item, product_id: product.product_id }] };
        if (sql.startsWith('INSERT INTO orders'))
            return {
                rows: [
                    {
                        id: 5,
                        total: '20.50',
                        payment_status: 'unpaid',
                        payment_method: 'paystack',
                    },
                ],
            };
        if (sql.startsWith('UPDATE product_variants SET stock'))
            return { rows: [{ id: 8 }], rowCount: 1 };
        if (sql.startsWith('SELECT * FROM order_items'))
            return { rows: [item] };
        return quoteData(sql, [item]);
    });
    t.mock.method(Payment, 'initiatePayment', async () => ({}));
    await processCheckout({ id: 1 }, input());
    await releaseReservation(pool, { id: 5 }, 'Expired');
    const writes = calls.filter(({ sql }) =>
        sql.startsWith('UPDATE product_variants SET stock')
    );
    assert.equal(writes.length, 2);
    assert.match(writes[0].sql, /stock = stock - \$1/);
    assert.match(writes[1].sql, /stock = stock \+ \$1/);
    assert.deepEqual(
        writes.map(({ values }) => values),
        [
            [2, 8],
            [2, 8],
        ]
    );
    assert.ok(
        !calls.some(({ sql }) => sql.startsWith('UPDATE products SET stock'))
    );
});

test('checkout preserves gateway and requires a valid retry key', () => {
    const valid = checkoutSchema.validate(input());
    assert.ifError(valid.error);
    assert.equal(valid.value.gateway, 'paystack');
    assert.ok(checkoutSchema.validate({ ...input(), gateway: 'cash' }).error);
    assert.ok(
        checkoutSchema.validate({ ...input(), idempotency_key: undefined })
            .error
    );
});
test('money is exact and unsupported currencies fail closed', () => {
    assert.equal(minorUnits('0.29'), 29);
    for (const value of ['-1', '1.001', 'Infinity', '1e3'])
        assert.throws(() => minorUnits(value));
    assert.throws(() => assertGatewayCurrency('stripe', 'NGN'));
    assert.throws(() => assertGatewayCurrency('stripe', 'JPY'));
});
test('shipping requires configured destination and charges each vendor once', () => {
    const items = [
        { vendor_id: 1, free_shipping: false },
        { vendor_id: 1, free_shipping: false },
        { vendor_id: 2, free_shipping: false },
    ];
    assert.equal(
        shippingMinor(items, 'NGN', 'Nigeria', '{"NGN":{"Nigeria":"1500"}}'),
        300000
    );
    assert.throws(() => shippingMinor(items, 'NGN', 'Ghana', '{}'));
    assert.equal(
        shippingMinor([{ free_shipping: true }], 'NGN', null, '{}'),
        0
    );
});
test('quote uses current product prices and allows untracked inventory', async (t) => {
    database(t, (sql) =>
        quoteData(sql, [{ ...product, track_inventory: false, stock: 0 }])
    );
    const result = await quote(pool, 1);
    assert.equal(result.total, '20.50');
});
for (const item of [
    { ...product, status: 'draft' },
    { ...product, currency_active: false },
    { ...product, stock: 1 },
    { ...product, has_variants: true },
    {
        ...product,
        variant_id: 8,
        variant_status: 'inactive',
        variant_product_id: 2,
    },
]) {
    test(`unavailable cart item is rejected: ${JSON.stringify(item)}`, async (t) => {
        database(t, (sql) => quoteData(sql, [item]));
        await assert.rejects(quote(pool, 1));
    });
}
test('mixed currencies are rejected', async (t) => {
    database(t, (sql) =>
        quoteData(sql, [product, { ...product, currency: 'USD' }])
    );
    await assert.rejects(quote(pool, 1), /different currencies/);
});
test('coupon discounts only the owning vendor and caps fixed discount', async (t) => {
    database(t, (sql) => {
        if (sql.startsWith('SELECT * FROM coupons'))
            return {
                rows: [
                    {
                        id: 1,
                        vendor_id: 3,
                        service_id: null,
                        product_id: null,
                        min_order: '0',
                        usage_limit: null,
                        max_discount: null,
                        type: 'fixed',
                        value: '100',
                    },
                ],
            };
        return quoteData(sql, [product, { ...product, vendor_id: 4 }]);
    });
    const result = await quote(pool, 1, { coupon_code: 'TEST' });
    assert.equal(result.discount, '20.50');
    assert.equal(result.total, '20.50');
});
test('transaction rolls back and releases on validation errors', async (t) => {
    const calls = database(t, () => {});
    await assert.rejects(
        transaction(pool, () => {
            throw new Error('invalid');
        })
    );
    assert.deepEqual(
        calls.map((x) => x.sql),
        ['BEGIN', 'ROLLBACK', 'RELEASE']
    );
});
test('stock race rolls back the order and does not initialize payment', async (t) => {
    const calls = database(t, (sql) => {
        if (sql.startsWith('INSERT INTO orders'))
            return { rows: [{ id: 5, total: '20.50' }] };
        return quoteData(sql);
    });
    const init = t.mock.method(Payment, 'initiatePayment', async () =>
        assert.fail('must not call provider')
    );
    await assert.rejects(
        processCheckout({ id: 1 }, input()),
        /Insufficient stock/
    );
    assert.equal(init.mock.callCount(), 0);
    assert.equal(calls.at(-2).sql, 'ROLLBACK');
});
test('payment outage preserves committed order and supports same-key retry', async (t) => {
    const data = input();
    let saved;
    let inserts = 0;
    const calls = database(t, (sql, values) => {
        if (sql.startsWith('SELECT * FROM orders WHERE user_id'))
            return { rows: saved ? [saved] : [] };
        if (sql.startsWith('INSERT INTO orders')) {
            inserts++;
            saved = {
                id: 5,
                total: '20.50',
                status: 'pending',
                payment_status: 'unpaid',
                payment_method: 'paystack',
                checkout_hash: values[10],
                reservation_expires_at: new Date(Date.now() + 60000),
            };
            return { rows: [saved] };
        }
        if (sql.startsWith('UPDATE products SET stock'))
            return { rows: [{ id: 2 }], rowCount: 1 };
        return quoteData(sql);
    });
    t.mock.method(Payment, 'initiatePayment', async () => {
        assert.equal(calls.at(-1).sql, 'RELEASE');
        throw new Error('network');
    });
    const result = await processCheckout({ id: 1 }, data);
    assert.equal(result.order_id, 5);
    assert.equal(result.payment, null);
    assert.equal(result.retryable, true);
    assert.equal((await processCheckout({ id: 1 }, data)).order_id, 5);
    assert.equal(inserts, 1);
    await assert.rejects(
        processCheckout({ id: 1 }, { ...data, address: 'Changed' }),
        /different checkout/
    );
});
test('cancellation is idempotent and restores only reserved stock', async (t) => {
    let cancelled = false;
    const calls = database(t, (sql) => {
        if (sql.startsWith('SELECT * FROM orders'))
            return {
                rows: [
                    {
                        id: 5,
                        status: cancelled ? 'cancelled' : 'pending',
                        payment_status: 'unpaid',
                    },
                ],
            };
        if (sql.startsWith('SELECT * FROM order_items'))
            return { rows: [{ product_id: 2, quantity: 2 }] };
        if (sql.startsWith("UPDATE orders SET status = 'cancelled'"))
            cancelled = true;
    });
    await Order.cancelOrder(5, 1, { reason: 'Changed mind' });
    await Order.cancelOrder(5, 1, { reason: 'Changed mind' });
    assert.equal(
        calls.filter((x) => x.sql.startsWith('UPDATE products SET stock'))
            .length,
        1
    );
});
test('customer orders are bound to the authenticated user', async (t) => {
    const calls = database(t, () => {});
    await Order.fetchCustomerOrders(23, null, {});
    assert.match(calls[0].sql, /o.user_id = \$1/);
    assert.equal(calls[0].values[0], 23);
    assert.ok(!calls[0].sql.includes('o.vendor_id'));
});

test('changed price or currency requires another customer preview before any order is created', async (t) => {
    const calls = database(t, (sql) => quoteData(sql));
    await assert.rejects(
        processCheckout({ id: 1 }, { ...input(), expected_total: 19 }),
        /total changed/
    );
    await assert.rejects(
        processCheckout({ id: 1 }, { ...input(), expected_currency: 'USD' }),
        /total changed/
    );
    assert.ok(!calls.some((x) => x.sql.startsWith('INSERT INTO orders')));
});
test('zero-total checkout confirms without contacting a gateway', async (t) => {
    const calls = database(t, (sql) => {
        if (sql.startsWith('INSERT INTO orders'))
            return { rows: [{ id: 5, total: '0.00' }] };
        if (sql.startsWith('UPDATE products SET stock'))
            return { rowCount: 1, rows: [{ id: 2 }] };
        return quoteData(sql, [{ ...product, price: '0.00' }]);
    });
    t.mock.method(Payment, 'initiatePayment', async () =>
        assert.fail('free checkout must not initialize a provider')
    );
    const result = await processCheckout(
        { id: 1 },
        { ...input(), expected_total: 0 }
    );
    assert.equal(result.payment_status, 'paid');
    assert.ok(
        calls.some((x) =>
            x.sql.startsWith('INSERT INTO checkout_notifications')
        )
    );
});
test('vendor order reads constrain the aggregated items to the authorized vendor', async (t) => {
    const calls = database(t, () => {});
    await Order.getOrderById(5, null, 7);
    assert.match(calls[0].sql, /oi.vendor_id = \$2/);
    assert.deepEqual(calls[0].values, [5, 7]);
    await Order.fetchVendorOrders(7, {});
    assert.match(calls[1].sql, /oi.vendor_id = \$1/);
});
