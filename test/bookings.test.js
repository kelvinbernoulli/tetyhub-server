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
    bookingDecisionSchema,
    bookingRescheduleProposalSchema,
    bookingRescheduleResponseSchema,
} from '../src/schemas/booking.schema.js';
import {
    bookingTimes,
    remainingCapacity,
    cancellationRefund,
    bookingPayable,
} from '../src/utils/booking.js';
import { PLAN_DEFINITIONS } from '../src/config/plans.js';

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
function mockDb(t, override = () => undefined, subscriptionPlan = null) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        const result = await override(sql, values);
        if (result !== undefined) return result;
        if (sql.includes('FROM subscriptions s')) {
            if (!subscriptionPlan) return { rows: [] };
            const plan = PLAN_DEFINITIONS[subscriptionPlan];
            return {
                rows: [{
                    plan: subscriptionPlan,
                    status: 'ACTIVE',
                    planVersion: 1,
                    currentPeriodEnd: new Date(Date.now() + 86400000),
                    graceEndsAt: null,
                    versionPlan: subscriptionPlan,
                    priceNaira: plan.priceNaira,
                    commissionPercent: plan.commissionPercent,
                    activeServices: plan.activeServices,
                    packagesPerService: plan.packagesPerService,
                    portfolioImages: plan.portfolioImages,
                    promotedSlotsPerMonth: plan.promotedSlotsPerMonth,
                    analytics: plan.analytics,
                    support: plan.support,
                }],
            };
        }
        if (sql.includes('FROM plan_versions'))
            return {
                rows: Object.values(PLAN_DEFINITIONS).map((plan) => ({
                    plan: plan.code,
                    priceNaira: plan.priceNaira,
                    commissionPercent: plan.commissionPercent,
                    activeServices: plan.activeServices,
                    packagesPerService: plan.packagesPerService,
                    portfolioImages: plan.portfolioImages,
                    promotedSlotsPerMonth: plan.promotedSlotsPerMonth,
                    analytics: plan.analytics,
                    support: plan.support,
                })),
            };
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
    assert.equal(
        bookingDecisionSchema.validate({
            decision: 'decline',
            reason: 'Unavailable',
        }).error,
        undefined
    );
    assert.ok(
        bookingDecisionSchema.validate({ decision: 'decline' }).error
    );
    assert.ok(
        bookingRescheduleProposalSchema.validate({
            scheduled_for: '2027-01-01T12:00:00',
        }).error
    );
    assert.equal(
        bookingRescheduleResponseSchema.validate({ accept: true }).error,
        undefined
    );
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
    assert.equal(+insert.values[10] - +insert.values[9], 3600000);
    assert.ok(
        new Date(insert.values[17]).getTime() - Date.now() > 23 * 60 * 60000
    );
    assert.equal(String(insert.values[6]), '15');
    assert.equal(insert.values[7], '3.08');
    assert.equal(insert.values[8], '17.42');
    assert.ok(insert.sql.includes('commission_rate,commission_amount,vendor_amount'));
    assert.ok(
        calls.findIndex((x) => x.sql.includes('FOR UPDATE OF s')) <
            calls.findIndex((x) => x.sql.startsWith('SELECT scheduled_for'))
    );
    assert.ok(
        !calls.some((x) => /INSERT INTO (orders|order_items)/.test(x.sql))
    );
});
test('booking snapshots the provider commission from the active plan', async (t) => {
    const calls = mockDb(t, undefined, 'PRO');
    await Booking.create(1, input);
    const insert = calls.find((x) =>
        x.sql.startsWith('INSERT INTO service_bookings')
    );
    assert.equal(insert.values[6], 10);
    assert.equal(insert.values[7], '2.05');
    assert.equal(insert.values[8], '18.45');
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
            saved = { ...booking, checkout_hash: values[19] };
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
test('vendor must accept a request before customer payment is allowed', async (t) => {
    const calls = mockDb(t);
    assert.equal(bookingPayable(booking), false);
    const accepted = {
        ...booking,
        booking_status: 'accepted',
        reservation_expires_at: new Date(Date.now() + 60000),
    };
    assert.equal(bookingPayable(accepted), true);
    await Booking.decide(9, 2, { decision: 'accept' });
    const update = calls.find((x) =>
        x.sql.startsWith('UPDATE service_bookings')
    );
    assert.equal(update.values[0], 'accepted');
    assert.ok(new Date(update.values[2]).getTime() - Date.now() <= 15 * 60000);
});
test('vendor can decline only an unpaid pending request and buyer receives reason', async (t) => {
    const calls = mockDb(t);
    await Booking.decide(9, 2, {
        decision: 'decline',
        reason: 'I am unavailable at that time',
    });
    const update = calls.find((x) =>
        x.sql.startsWith('UPDATE service_bookings')
    );
    assert.equal(update.values[0], 'declined');
    assert.equal(update.values[1], 'I am unavailable at that time');
    assert.equal(update.values[2], null);
    const paidCalls = mockDb(t, (sql) =>
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
    await assert.rejects(
        Booking.decide(9, 2, { decision: 'decline', reason: 'No longer free' }),
        /awaiting a vendor decision/
    );
    assert.ok(
        !paidCalls.some((x) => x.sql.startsWith('UPDATE service_bookings'))
    );
});
test('vendor reschedule proposal stays pending until buyer approval', async (t) => {
    const proposed = new Date(Date.now() + 3 * 86400000).toISOString();
    const calls = mockDb(t, (sql) => {
        if (sql.startsWith('SELECT service_id FROM service_bookings'))
            return { rows: [{ service_id: 3 }] };
        if (sql.startsWith('SELECT max_bookings_per_slot'))
            return { rows: [{ max_bookings_per_slot: 1 }] };
        if (sql.startsWith('SELECT * FROM service_bookings'))
            return {
                rows: [
                    {
                        ...booking,
                        booking_status: 'confirmed',
                        payment_status: 'paid',
                    },
                ],
            };
    });
    await Booking.proposeReschedule(9, 2, proposed);
    const update = calls.find((x) =>
        x.sql.startsWith('UPDATE service_bookings')
    );
    assert.match(update.sql, /proposed_scheduled_for = \$1/);
    assert.equal(new Date(update.values[0]).toISOString(), proposed);
    assert.equal(update.values[2], 9);
});
test('buyer response to reschedule is scoped to buyer and applies only approved time', async (t) => {
    const proposedStart = new Date(Date.now() + 3 * 86400000);
    const proposedEnd = new Date(+proposedStart + 3600000);
    const calls = mockDb(t, (sql) => {
        if (sql.startsWith('SELECT service_id FROM service_bookings'))
            return { rows: [{ service_id: 3 }] };
        if (sql.startsWith('SELECT max_bookings_per_slot'))
            return { rows: [{ max_bookings_per_slot: 1 }] };
        if (sql.startsWith('SELECT * FROM service_bookings'))
            return {
                rows: [
                    {
                        ...booking,
                        booking_status: 'confirmed',
                        payment_status: 'paid',
                        proposed_scheduled_for: proposedStart,
                        proposed_ends_at: proposedEnd,
                    },
                ],
            };
    });
    await Booking.respondToReschedule(9, 1, true);
    const update = calls.find((x) =>
        x.sql.startsWith('UPDATE service_bookings')
    );
    assert.equal(+update.values[0], +proposedStart);
    assert.equal(+update.values[1], +proposedEnd);
    assert.match(update.sql, /proposed_scheduled_for = NULL/);
    assert.deepEqual(
        calls.find((x) => x.sql.startsWith('SELECT * FROM service_bookings'))
            .values,
        [9, 1]
    );
});
test('booking settlement confirms atomically without mutating orders', async (t) => {
    const calls = mockDb(t, (sql) =>
        sql.startsWith('SELECT * FROM service_bookings')
            ? {
                  rows: [
                      {
                          ...booking,
                          booking_status: 'accepted',
                          reservation_expires_at: new Date(Date.now() + 60000),
                      },
                  ],
              }
            : undefined
    );
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
            : sql.startsWith('SELECT b.*')
              ? {
                    rows: [
                        {
                            ...booking,
                            booking_status: 'accepted',
                        },
                    ],
                }
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
