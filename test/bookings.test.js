import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import pool from '../src/services/pg_pool.js';
import Booking from '../src/models/booking.model.js';
import BookingPayment from '../src/models/booking-payment.model.js';
import Payment from '../src/models/payment.model.js';
import * as Controller from '../src/controllers/booking.controller.js';
import {
    createBookingSchema,
    bookingListSchema,
} from '../src/schemas/booking.schema.js';
import {
    bookingTimes,
    remainingCapacity,
    cancellationRefund,
} from '../src/utils/booking.js';

const start = new Date(Date.now() + 86400000);
const end = new Date(+start + 3600000);
const input = {
    service_id: 3,
    scheduled_for: start.toISOString(),
    gateway: 'paystack',
    expected_currency: 'NGN',
    expected_total: 20.5,
    idempotency_key: randomUUID(),
};
const service = {
    id: 3,
    vendor_id: 2,
    currency_id: 1,
    currency: 'NGN',
    currency_active: true,
    vendor_status: 'active',
    status: 'active',
    name: 'Consultation',
    duration_mins: 60,
    base_price: '20.50',
    buffer_mins: 15,
    max_bookings_per_slot: 1,
    location_type: 'remote',
    cancellation_window_hours: 48,
    cancellation_fee_percent: 25,
};
const booking = {
    id: 9,
    user_id: 1,
    service_id: 3,
    vendor_id: 2,
    currency_id: 1,
    currency: 'NGN',
    total: '20.50',
    service_name: 'Consultation',
    scheduled_for: start,
    ends_at: end,
    booking_status: 'pending',
    payment_status: 'unpaid',
    payment_method: 'paystack',
    reservation_expires_at: new Date(Date.now() + 60000),
    email: 'buyer@example.com',
    cancellation_window_hours: 48,
    cancellation_fee_percent: 25,
};
const payment = {
    id: 5,
    booking_id: 9,
    user_id: 1,
    currency_id: 1,
    currency: 'NGN',
    gateway: 'paystack',
    gateway_ref: 'booking-test',
    amount: '20.50',
    status: 'pending',
};
const success = {
    reference: 'booking-test',
    status: 'success',
    amount: 2050,
    currency: 'NGN',
};
function mockDb(t, override = () => undefined) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        const result = await override(sql, values);
        if (result !== undefined) return result;
        if (sql.startsWith('SELECT s.*')) return { rows: [{ ...service }] };
        if (
            sql.startsWith('SELECT scheduled_for') ||
            sql.includes('checkout_key =')
        )
            return { rows: [] };
        if (sql.startsWith('SELECT b.id'))
            return { rows: [{ id: 9, service_id: 3 }] };
        if (
            sql.startsWith('SELECT b.*') ||
            sql.startsWith('SELECT * FROM service_bookings')
        )
            return { rows: [{ ...booking }] };
        if (
            sql.startsWith('SELECT p.*') ||
            sql.startsWith('SELECT * FROM payments')
        )
            return { rows: [{ ...payment }] };
        if (sql.startsWith('INSERT INTO service_bookings'))
            return { rows: [{ ...booking }] };
        if (sql.startsWith('INSERT INTO payments'))
            return { rows: [{ ...payment }] };
        if (sql.startsWith('UPDATE service_bookings'))
            return {
                rows: [
                    {
                        ...booking,
                        booking_status: values[0],
                        refund_due: values[2],
                    },
                ],
            };
        return { rows: [], rowCount: 1 };
    };
    t.mock.method(pool, 'query', query);
    t.mock.method(pool, 'connect', async () => ({ query, release() {} }));
    return calls;
}

test('booking input rejects product/order fields, owner overrides, precision loss and missing time zones', () => {
    assert.equal(createBookingSchema.validate(input).error, undefined);
    for (const extra of [
        { product_id: 1 },
        { order_id: 2 },
        { user_id: 9 },
        { vendor_id: 7 },
        { expected_total: 20.501 },
        { expected_total: '20.50' },
        { scheduled_for: '2027-01-01T12:00:00' },
    ])
        assert.ok(createBookingSchema.validate({ ...input, ...extra }).error);
    assert.ok(bookingListSchema.validate({ vendor_id: 9 }).error);
});
test('availability uses peak overlap and buffers, with end-before-start boundary handling', () => {
    const a = new Date('2027-01-01T12:00:00Z');
    const b = new Date('2027-01-01T14:00:00Z');
    const rows = [
        {
            scheduled_for: a,
            ends_at: new Date('2027-01-01T13:00:00Z'),
            buffer_mins: 0,
        },
        {
            scheduled_for: new Date('2027-01-01T13:00:00Z'),
            ends_at: b,
            buffer_mins: 0,
        },
    ];
    assert.equal(remainingCapacity(rows, a, b, 2), 1);
    rows[0].buffer_mins = 15;
    assert.equal(remainingCapacity(rows, a, b, 2), 0);
    assert.equal(remainingCapacity(rows, b, new Date(+b + 60000), 1), 1);
    assert.throws(() => bookingTimes(new Date(Date.now() - 1), 60), /future/);
});
test('creation reserves only a service and snapshots price and duration under its lock', async (t) => {
    const calls = mockDb(t);
    await Booking.create(1, input);
    const insert = calls.find((x) =>
        x.sql.startsWith('INSERT INTO service_bookings')
    );
    assert.equal(insert.values[0], 1);
    assert.equal(insert.values[5], '20.50');
    assert.equal(+insert.values[7] - +insert.values[6], 3600000);
    assert.ok(
        calls.findIndex((x) => x.sql.includes('FOR UPDATE OF s')) <
            calls.findIndex((x) => x.sql.startsWith('SELECT scheduled_for'))
    );
    assert.ok(
        !calls.some((x) => /INSERT INTO (orders|order_items)/.test(x.sql))
    );
});
for (const scenario of ['capacity', 'price', 'location', 'inactive'])
    test(`creation rejects ${scenario} and rolls back`, async (t) => {
        const calls = mockDb(t, (sql) => {
            if (
                scenario === 'capacity' &&
                sql.startsWith('SELECT scheduled_for')
            )
                return {
                    rows: [
                        { scheduled_for: start, ends_at: end, buffer_mins: 0 },
                    ],
                };
            if (sql.startsWith('SELECT s.*'))
                return {
                    rows: [
                        {
                            ...service,
                            ...(scenario === 'price'
                                ? { base_price: '30.00' }
                                : scenario === 'location'
                                  ? { location_type: 'customer_location' }
                                  : scenario === 'inactive'
                                    ? { status: 'paused' }
                                    : {}),
                        },
                    ],
                };
        });
        await assert.rejects(Booking.create(1, input));
        assert.equal(calls.at(-1).sql, 'ROLLBACK');
        assert.ok(
            !calls.some((x) => x.sql.startsWith('INSERT INTO service_bookings'))
        );
    });
test('idempotency retry returns the original booking; changed payload is rejected', async (t) => {
    let saved;
    mockDb(t, (sql, values) => {
        if (sql.includes('checkout_key ='))
            return { rows: saved ? [saved] : [] };
        if (sql.startsWith('INSERT INTO service_bookings')) {
            saved = { ...booking, checkout_hash: values[16] };
            return { rows: [saved] };
        }
    });
    const first = await Booking.create(1, input);
    assert.deepEqual(await Booking.create(1, input), first);
    await assert.rejects(
        Booking.create(1, { ...input, additional_notes: 'different' }),
        /Idempotency/
    );
});
test('cancellation records the policy refund and binds customer ownership', async (t) => {
    const calls = mockDb(t, (sql) =>
        sql.startsWith('SELECT * FROM service_bookings')
            ? {
                  rows: [
                      {
                          ...booking,
                          booking_status: 'confirmed',
                          payment_status: 'paid',
                      },
                  ],
              }
            : undefined
    );
    await Booking.change(9, 1, false, { reason: 'Change of plans' });
    const read = calls.find((x) =>
        x.sql.startsWith('SELECT * FROM service_bookings')
    );
    assert.match(read.sql, /user_id = \$2/);
    assert.deepEqual(read.values, [9, 1]);
    assert.equal(
        calls.find((x) => x.sql.startsWith('UPDATE service_bookings'))
            .values[2],
        '15.37'
    );
    assert.equal(
        cancellationRefund({ ...booking, payment_status: 'paid' }, true),
        '20.50'
    );
});
test('vendor cannot start an unpaid or future booking and customer cannot advance status', async (t) => {
    mockDb(t);
    await assert.rejects(
        Booking.change(9, 2, true, { status: 'active' }),
        /transition/
    );
    await assert.rejects(
        Booking.change(9, 1, false, { status: 'completed' }),
        /transition/
    );
});
test('booking settlement confirms atomically without mutating orders', async (t) => {
    const calls = mockDb(t);
    const result = await Payment.settle('paystack', success, 'event-1');
    assert.equal(result.status, 'confirmed');
    assert.equal(result.booking_id, 9);
    assert.equal(calls.at(-1).sql, 'COMMIT');
    assert.ok(
        calls.some((x) => x.sql.startsWith('INSERT INTO payment_events'))
    );
    assert.ok(calls.some((x) => x.sql.startsWith('INSERT INTO notifications')));
    assert.ok(!calls.some((x) => /\borders\b|\border_items\b/.test(x.sql)));
});
for (const patch of [{ amount: 1 }, { currency: 'USD' }])
    test('booking settlement rejects mismatched money', async (t) => {
        const calls = mockDb(t);
        await assert.rejects(
            BookingPayment.settle('paystack', { ...success, ...patch }),
            /mismatch/
        );
        assert.equal(calls.at(-1).sql, 'ROLLBACK');
    });
for (const state of ['expired', 'cancelled', 'pending'])
    test(`late payment for ${state} goes to refund review`, async (t) => {
        const calls = mockDb(t, (sql) =>
            sql.startsWith('SELECT * FROM service_bookings')
                ? {
                      rows: [
                          {
                              ...booking,
                              booking_status: state,
                              reservation_expires_at: new Date(
                                  Date.now() - 1000
                              ),
                          },
                      ],
                  }
                : undefined
        );
        assert.equal(
            (await BookingPayment.settle('paystack', success)).status,
            'payment_review'
        );
        assert.equal(
            calls.find((x) => x.sql.startsWith('UPDATE service_bookings'))
                .values[1],
            '20.50'
        );
    });
test('duplicate payment events do not send a second notification or update payment', async (t) => {
    const calls = mockDb(t, (sql) =>
        sql.startsWith('INSERT INTO payment_events')
            ? { rowCount: 0, rows: [] }
            : undefined
    );
    await BookingPayment.settle('paystack', success, 'event-1');
    assert.ok(
        !calls.some(
            (x) =>
                x.sql.startsWith('UPDATE payments') ||
                x.sql.startsWith('INSERT INTO notifications')
        )
    );
});
test('Stripe settlement checks booking metadata and provider intent identity', async (t) => {
    mockDb(t, (sql) =>
        sql.startsWith('SELECT p.*')
            ? { rows: [{ ...payment, provider_ref: 'pi_expected' }] }
            : undefined
    );
    await assert.rejects(
        BookingPayment.settle('stripe', {
            id: 'pi_other',
            metadata: { payment_reference: 'booking-test', booking_id: '9' },
            status: 'succeeded',
            amount_received: 2050,
            currency: 'ngn',
        }),
        /identity/
    );
});
test('saved payment initialization is reused without another gateway call', async (t) => {
    const saved = {
        reference: 'booking-test',
        authorization_url: 'https://checkout.example',
    };
    mockDb(t, (sql) =>
        sql.startsWith('SELECT * FROM payments')
            ? { rows: [{ ...payment, checkout_data: JSON.stringify(saved) }] }
            : undefined
    );
    assert.deepEqual(await BookingPayment.initiate(1, 9), saved);
});
test('payment initialization rejects another customer before contacting the provider', async (t) => {
    mockDb(t, (sql) =>
        sql.startsWith('SELECT b.*') ? { rows: [] } : undefined
    );
    await assert.rejects(BookingPayment.initiate(99, 9), /not found/);
});
test('controller uses trusted vendor scope and rejects owner injection', async (t) => {
    let called;
    t.mock.method(Booking, 'list', async (...args) => {
        called = args;
        return [];
    });
    const res = {
        status(code) {
            this.code = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
    await Controller.vendorList(
        { auth: { vendorId: 2 }, query: { limit: '5' } },
        res
    );
    assert.equal(res.code, 200);
    assert.deepEqual(called, [2, true, { limit: 5, offset: 0 }]);
    await Controller.vendorList(
        { auth: { vendorId: 2 }, query: { vendor_id: 9 } },
        res
    );
    assert.equal(res.code, 400);
});
