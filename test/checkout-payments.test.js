import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import pool from '../src/services/pg_pool.js';
import Payment from '../src/models/payment.model.js';
import { paystackWebhook, stripeWebhook } from '../src/services/webhook.js';

const order = {
    id: 5,
    user_id: 1,
    total: '20.50',
    payment_status: 'unpaid',
    status: 'pending',
    payment_method: 'paystack',
    currency: 'NGN',
    currency_id: 1,
    email: 'buyer@example.com',
    reservation_expires_at: new Date(Date.now() + 60000),
};
const payment = {
    id: 6,
    order_id: 5,
    user_id: 1,
    amount: '20.50',
    currency: 'NGN',
    currency_id: 1,
    gateway: 'paystack',
    gateway_ref: 'checkout-test',
    status: 'pending',
};
const success = {
    id: 7,
    reference: 'checkout-test',
    status: 'success',
    amount: 2050,
    currency: 'NGN',
};
function db(t, overrides = () => undefined) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        const override = await overrides(sql, values);
        if (override !== undefined) return override;
        if (sql.startsWith('SELECT order_id FROM payments'))
            return { rows: [{ order_id: 5 }] };
        if (
            sql.startsWith('SELECT * FROM orders') ||
            sql.startsWith('SELECT o.*')
        )
            return { rows: [{ ...order }] };
        if (
            sql.startsWith('SELECT p.*') ||
            sql.startsWith('SELECT * FROM payments')
        )
            return { rows: [{ ...payment }] };
        if (sql.startsWith('INSERT INTO payments'))
            return { rows: [{ ...payment }] };
        return { rows: [], rowCount: 1 };
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
function gatewayMock(t, value) {
    const prior = Payment.gatewayApi;
    Payment.gatewayApi = value;
    t.after(() => {
        Payment.gatewayApi = prior;
    });
}
function response() {
    return {
        code: null,
        sendStatus(code) {
            this.code = code;
            return this;
        },
    };
}

test('confirmation records event, payment, order and notification in one transaction', async (t) => {
    const calls = db(t);
    const result = await Payment.settle(
        'paystack',
        success,
        'charge.success:7'
    );
    assert.equal(result.status, 'processing');
    assert.equal(calls[0].sql, 'BEGIN');
    assert.equal(calls.at(-2).sql, 'COMMIT');
    assert.ok(
        calls.some((x) =>
            x.sql.startsWith('INSERT INTO checkout_notifications')
        )
    );
});
test('failed order update rolls back event so provider retry can process it', async (t) => {
    const calls = db(t, (sql) => {
        if (sql.startsWith('UPDATE orders'))
            throw new Error('database failure');
    });
    await assert.rejects(
        Payment.settle('paystack', success, 'charge.success:7'),
        /database failure/
    );
    assert.equal(calls.at(-2).sql, 'ROLLBACK');
    assert.ok(!calls.some((x) => x.sql === 'COMMIT'));
});
test('duplicate event is acknowledged without changing payment or order', async (t) => {
    const calls = db(t, (sql) =>
        sql.startsWith('INSERT INTO payment_events')
            ? { rows: [], rowCount: 0 }
            : undefined
    );
    await Payment.settle('paystack', success, 'charge.success:7');
    assert.ok(!calls.some((x) => x.sql.startsWith('UPDATE ')));
});
for (const changed of [{ amount: 2049 }, { currency: 'USD' }])
    test(`reject mismatched payment ${JSON.stringify(changed)}`, async (t) => {
        const calls = db(t);
        await assert.rejects(
            Payment.settle('paystack', { ...success, ...changed }),
            /mismatch/
        );
        assert.ok(!calls.some((x) => x.sql.startsWith('UPDATE ')));
        assert.equal(calls.at(-2).sql, 'ROLLBACK');
    });
test('failed or pending verification cannot downgrade a paid order', async (t) => {
    const calls = db(t, (sql) =>
        sql.startsWith('SELECT * FROM orders')
            ? {
                  rows: [
                      {
                          ...order,
                          payment_status: 'paid',
                          status: 'processing',
                      },
                  ],
              }
            : undefined
    );
    assert.equal(
        (await Payment.settle('paystack', { ...success, status: 'pending' }))
            .payment_status,
        'paid'
    );
    assert.ok(!calls.some((x) => x.sql.startsWith('UPDATE ')));
});
test('late payment is held for review without restoring fulfillment or sending confirmation', async (t) => {
    const calls = db(t, (sql) =>
        sql.startsWith('SELECT * FROM orders')
            ? { rows: [{ ...order, status: 'cancelled' }] }
            : undefined
    );
    assert.equal(
        (await Payment.settle('paystack', success)).status,
        'payment_review'
    );
    assert.ok(
        !calls.some((x) =>
            x.sql.startsWith('INSERT INTO checkout_notifications')
        )
    );
});
test('payment owner is checked before contacting provider', async (t) => {
    db(t, (sql) =>
        sql.startsWith('SELECT * FROM payments') ? { rows: [] } : undefined
    );
    gatewayMock(t, {
        verifyPaystack: async () => assert.fail('provider must not be called'),
    });
    await assert.rejects(
        Payment.verifyPayment('paystack', 'checkout-test', 999),
        /not found/
    );
});
test('initialization reuses saved checkout details without calling provider', async (t) => {
    const saved = {
        reference: 'checkout-test',
        authorization_url: 'https://example.com/pay',
    };
    db(t, (sql) =>
        sql.startsWith('SELECT * FROM payments')
            ? { rows: [{ ...payment, checkout_data: JSON.stringify(saved) }] }
            : undefined
    );
    gatewayMock(t, {
        initializePaystack: async () => assert.fail('duplicate initialization'),
    });
    assert.deepEqual(await Payment.initiatePayment(1, 5, 'paystack'), saved);
});
test('initialization lease prevents concurrent provider calls', async (t) => {
    const calls = db(t, (sql) =>
        sql.startsWith('SELECT * FROM payments')
            ? {
                  rows: [
                      {
                          ...payment,
                          initializing_until: new Date(Date.now() + 60000),
                      },
                  ],
              }
            : undefined
    );
    await assert.rejects(
        Payment.initiatePayment(1, 5, 'paystack'),
        /in progress/
    );
    assert.equal(calls.at(-2).sql, 'ROLLBACK');
});
test('initialization commits and releases before provider request, retaining stable reference on outage', async (t) => {
    const calls = db(t);
    gatewayMock(t, {
        initializePaystack: async (args) => {
            assert.equal(calls.at(-1).sql, 'RELEASE');
            assert.equal(args.reference, 'checkout-test');
            throw new Error('timeout');
        },
    });
    await assert.rejects(Payment.initiatePayment(1, 5, 'paystack'), /timeout/);
    assert.ok(calls.some((x) => x.sql === 'COMMIT'));
    assert.ok(!calls.some((x) => x.sql.startsWith('DELETE')));
});
test('paystack signature is checked on raw bytes and duplicate delivery receives HTTP 200', async (t) => {
    const prior = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = 'test-secret';
    t.after(() => {
        if (prior === undefined) delete process.env.PAYSTACK_SECRET_KEY;
        else process.env.PAYSTACK_SECRET_KEY = prior;
    });
    const body = Buffer.from(
        JSON.stringify({ event: 'charge.success', data: success })
    );
    const signature = crypto
        .createHmac('sha512', 'test-secret')
        .update(body)
        .digest('hex');
    const settle = t.mock.method(Payment, 'settle', async () => ({
        payment_status: 'paid',
    }));
    for (let i = 0; i < 2; i++) {
        const res = response();
        await paystackWebhook(
            { body, headers: { 'x-paystack-signature': signature } },
            res
        );
        assert.equal(res.code, 200);
    }
    const res = response();
    await paystackWebhook(
        {
            body: Buffer.from('{}'),
            headers: { 'x-paystack-signature': signature },
        },
        res
    );
    assert.equal(res.code, 401);
    assert.equal(settle.mock.callCount(), 2);
});
test('stripe webhook rejects unsigned requests', async () => {
    const res = response();
    await stripeWebhook({ body: Buffer.from('{}'), headers: {} }, res);
    assert.equal(res.code, 400);
});

test('stripe confirmation verifies intent identity and received amount', async (t) => {
    const calls = db(t, (sql) =>
        sql.startsWith('SELECT p.*')
            ? {
                  rows: [
                      {
                          ...payment,
                          gateway: 'stripe',
                          currency: 'USD',
                          provider_ref: 'pi_test',
                      },
                  ],
              }
            : undefined
    );
    const data = {
        id: 'pi_test',
        status: 'succeeded',
        currency: 'usd',
        amount_received: 2050,
        metadata: { payment_reference: 'checkout-test', order_id: '5' },
    };
    assert.equal(
        (await Payment.settle('stripe', data, 'evt_success')).status,
        'processing'
    );
    await assert.rejects(
        Payment.settle('stripe', { ...data, id: 'pi_other' }, 'evt_other'),
        /identity mismatch/
    );
    await assert.rejects(
        Payment.settle(
            'stripe',
            { ...data, amount_received: 1000 },
            'evt_short'
        ),
        /amount or currency mismatch/
    );
});
