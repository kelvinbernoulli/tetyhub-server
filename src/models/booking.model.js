import { notifyBooking } from '#services/notifications.js';
import { createHash } from 'node:crypto';
import pool from '#services/pg_pool.js';
import {
    CheckoutError,
    transaction,
    minorUnits,
    assertGatewayCurrency,
} from '#utils/checkout.js';
import {
    bookingTimes,
    remainingCapacity,
    cancellationRefund,
} from '#utils/booking.js';
import { commissionAmount } from '#utils/commission.js';
import {
    getProviderPlan,
    lockProviderEntitlements,
} from '#services/entitlements.js';

export async function expireBookings(client = pool) {
    if (client === pool) return transaction(pool, (connection) => expireBookings(connection));
    const result = await client.query(`UPDATE service_bookings SET booking_status = 'expired', updated_at = NOW()
        WHERE booking_status IN ('pending', 'accepted') AND payment_status = 'unpaid'
        AND reservation_expires_at <= NOW() RETURNING *`);
    for (const booking of result.rows) await notifyBooking(client, booking, 'expired');
    return result;
}

export async function availableService(client, id, lock = false) {
    const { rows } = await client.query(
        `SELECT s.*, c.code AS currency, c.status AS currency_active,
        v.status AS vendor_status FROM services s JOIN currencies c ON c.id = s.currency_id
        JOIN vendors v ON v.id = s.vendor_id WHERE s.id = $1${lock ? ' FOR UPDATE OF s' : ''}`,
        [id]
    );
    const service = rows[0];
    if (
        !service ||
        service.status !== 'active' ||
        service.deleted_at ||
        !service.currency_active ||
        service.vendor_status !== 'active'
    )
        throw new CheckoutError('Service not available', 404);
    return service;
}

async function capacity(client, service, start, end, excludeBookingId = null) {
    const bufferedEnd = new Date(+end + service.buffer_mins * 60000);
    const { rows } = await client.query(
        `SELECT scheduled_for, ends_at, buffer_mins FROM service_bookings
        WHERE service_id = $1 AND (booking_status IN ('confirmed', 'active', 'completed') OR
            (booking_status IN ('pending', 'accepted') AND
                (payment_status = 'review' OR reservation_expires_at > NOW())))
        AND scheduled_for < $3 AND ends_at + make_interval(mins => buffer_mins) > $2
        AND ($4::integer IS NULL OR id <> $4)`,
        [service.id, start, bufferedEnd, excludeBookingId]
    );
    return remainingCapacity(
        rows,
        start,
        bufferedEnd,
        service.max_bookings_per_slot
    );
}

export default class Booking {
    static async availability(serviceId, scheduled) {
        const service = await availableService(pool, serviceId);
        const { start, end } = bookingTimes(scheduled, service.duration_mins);
        return {
            service_id: service.id,
            scheduled_for: start,
            ends_at: end,
            remaining_capacity: await capacity(pool, service, start, end),
            total: service.base_price,
            currency: service.currency,
            location_type: service.location_type,
        };
    }

    static async create(userId, data) {
        const idempotencyKey = data.idempotency_key;
        const payload = {
            ...data,
            scheduled_for: new Date(data.scheduled_for).toISOString(),
        };
        const hash = createHash('sha256')
            .update(
                JSON.stringify(
                    Object.fromEntries(
                        Object.entries(payload).sort(([a], [b]) =>
                            a.localeCompare(b)
                        )
                    )
                )
            )
            .digest('hex');
        return transaction(pool, async (client) => {
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
                userId,
            ]);
            const previous = (
                await client.query(
                    'SELECT * FROM service_bookings WHERE user_id = $1 AND checkout_key = $2',
                    [userId, data.idempotency_key]
                )
            ).rows[0];
            if (previous) {
                if (previous.checkout_hash !== hash)
                    throw new CheckoutError(
                        'Idempotency key was used for a different booking',
                        409
                    );
                return previous;
            }
            // Serialize new reservations with concurrent service booking changes.
            const service = await availableService(
                client,
                data.service_id,
                true
            );
            const { start, end } = bookingTimes(
                data.scheduled_for,
                service.duration_mins
            );
            assertGatewayCurrency(data.gateway, service.currency);
            if (
                service.currency !== data.expected_currency ||
                minorUnits(service.base_price) !==
                    minorUnits(data.expected_total)
            )
                throw new CheckoutError(
                    'Service price changed; refresh before booking',
                    409
                );
            await lockProviderEntitlements(client, service.vendor_id);
            const { plan } = await getProviderPlan(client, service.vendor_id);
            const commissionMinor = commissionAmount(
                minorUnits(service.base_price),
                plan.commissionPercent
            );
            const vendorMinor =
                minorUnits(service.base_price) - commissionMinor;
            if (service.location_type === 'customer_location' && !data.location)
                throw new CheckoutError('Customer location is required', 400);
            if ((await capacity(client, service, start, end)) < 1)
                throw new CheckoutError(
                    'This service is fully booked at the requested time',
                    409
                );
            const expiry = new Date(Math.min(Date.now() + 24 * 60 * 60000, +start));
            const { rows } = await client.query(
                `INSERT INTO service_bookings
                (user_id,service_id,vendor_id,currency_id,service_name,total,commission_rate,commission_amount,vendor_amount,scheduled_for,ends_at,buffer_mins,
                location_type,location,cancellation_window_hours,cancellation_fee_percent,payment_method,
                reservation_expires_at,checkout_key,checkout_hash,note)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
                [
                    userId,
                    service.id,
                    service.vendor_id,
                    service.currency_id,
                    service.name,
                    service.base_price,
                    plan.commissionPercent,
                    (commissionMinor / 100).toFixed(2),
                    (vendorMinor / 100).toFixed(2),
                    start,
                    end,
                    service.buffer_mins,
                    service.location_type,
                    data.location ?? null,
                    service.cancellation_window_hours,
                    service.cancellation_fee_percent,
                    data.gateway,
                    expiry,
                    data.idempotency_key,
                    hash,
                    data.note ?? null,
                ]
            );
            await notifyBooking(client, rows[0], 'pending');
            return rows[0];
        });
    }

    static async list(ownerId, byVendor, { status, limit, offset }) {
        // Column names are chosen internally; request values always remain parameters.
        const { rows } = await pool.query(
            `SELECT b.*, c.code AS currency FROM service_bookings b
            JOIN currencies c ON c.id = b.currency_id WHERE b.${byVendor ? 'vendor_id' : 'user_id'} = $1
            AND ($2::text IS NULL OR b.booking_status = $2) ORDER BY b.created_at DESC, b.id DESC LIMIT $3 OFFSET $4`,
            [ownerId, status ?? null, limit, offset]
        );
        return { items: rows, limit, offset };
    }

    static async view(id, ownerId, byVendor = false) {
        return (
            (
                await pool.query(
                    `SELECT b.*, c.code AS currency FROM service_bookings b
            JOIN currencies c ON c.id = b.currency_id WHERE b.id = $1 AND b.${byVendor ? 'vendor_id' : 'user_id'} = $2`,
                    [id, ownerId]
                )
            ).rows[0] ?? null
        );
    }

    static async change(id, ownerId, byVendor, { status, reason }) {
        return transaction(pool, async (client) => {
            const booking = (
                await client.query(
                    `SELECT * FROM service_bookings WHERE id = $1
                AND ${byVendor ? 'vendor_id' : 'user_id'} = $2 FOR UPDATE`,
                    [id, ownerId]
                )
            ).rows[0];
            if (!booking) throw new CheckoutError('Booking not found', 404);
            const target = reason ? 'cancelled' : status;
            if (booking.booking_status === target) return booking;
            let refund = '0.00';
            if (target === 'cancelled') {
                if (
                    !['pending', 'accepted', 'confirmed'].includes(
                        booking.booking_status
                    ) ||
                    (!byVendor &&
                        new Date(booking.scheduled_for) <= new Date()) ||
                    booking.payment_status === 'review'
                )
                    throw new CheckoutError(
                        'Booking cannot be cancelled in its current state',
                        409
                    );
                refund = cancellationRefund(booking, byVendor);
            } else {
                const allowed =
                    byVendor &&
                    booking.payment_status === 'paid' &&
                    ((booking.booking_status === 'confirmed' &&
                        target === 'active' &&
                        new Date(booking.scheduled_for) <= new Date()) ||
                        (booking.booking_status === 'active' &&
                            target === 'completed' &&
                            new Date(booking.ends_at) <= new Date()));
                if (!allowed)
                    throw new CheckoutError(
                        'Invalid booking status transition',
                        409
                    );
            }
            const updated = (
                await client.query(
                    `UPDATE service_bookings SET booking_status = $1,
                cancellation_reason = $2, refund_due = $3, reservation_expires_at = NULL,
                proposed_scheduled_for = NULL, proposed_ends_at = NULL, updated_at = NOW()
                WHERE id = $4 RETURNING *`,
                    [target, reason ?? null, refund, id]
                )
            ).rows[0];
            await notifyBooking(client, booking, target);
            return updated;
        });
    }

    static async decide(id, vendorId, { decision, reason }) {
        return transaction(pool, async (client) => {
            const booking = (
                await client.query(
                    `SELECT * FROM service_bookings WHERE id = $1 AND vendor_id = $2 FOR UPDATE`,
                    [id, vendorId]
                )
            ).rows[0];
            if (!booking) throw new CheckoutError('Booking not found', 404);
            if (
                booking.booking_status !== 'pending' ||
                booking.payment_status !== 'unpaid' ||
                !booking.reservation_expires_at ||
                new Date(booking.reservation_expires_at) <= new Date()
            )
                throw new CheckoutError(
                    'Booking request is no longer awaiting a vendor decision',
                    409
                );

            const accepted = decision === 'accept';
            const status = accepted ? 'accepted' : 'declined';
            const expiry = accepted
                ? new Date(
                      Math.min(
                          Date.now() + 15 * 60000,
                          new Date(booking.scheduled_for).getTime()
                      )
                  )
                : null;
            const updated = (
                await client.query(
                    `UPDATE service_bookings SET booking_status = $1,
                    vendor_response_note = $2, reservation_expires_at = $3,
                    updated_at = NOW() WHERE id = $4 RETURNING *`,
                    [status, accepted ? null : reason, expiry, id]
                )
            ).rows[0];
            await notifyBooking(client, updated, status);
            return updated;
        });
    }

    static async proposeReschedule(id, vendorId, scheduledFor) {
        return transaction(pool, async (client) => {
            const lookup = (
                await client.query(
                    `SELECT service_id FROM service_bookings WHERE id = $1 AND vendor_id = $2`,
                    [id, vendorId]
                )
            ).rows[0];
            if (!lookup) throw new CheckoutError('Booking not found', 404);

            const service = (
                await client.query(
                    `SELECT max_bookings_per_slot FROM services WHERE id = $1 FOR UPDATE`,
                    [lookup.service_id]
                )
            ).rows[0];
            const booking = (
                await client.query(
                    `SELECT * FROM service_bookings WHERE id = $1 AND vendor_id = $2 FOR UPDATE`,
                    [id, vendorId]
                )
            ).rows[0];
            if (
                booking.booking_status !== 'confirmed' ||
                booking.payment_status !== 'paid' ||
                new Date(booking.scheduled_for) <= new Date()
            )
                throw new CheckoutError(
                    'Only future, paid bookings can be rescheduled',
                    409
                );
            if (booking.proposed_scheduled_for)
                throw new CheckoutError(
                    'A reschedule proposal is already awaiting buyer approval',
                    409
                );

            const durationMins = Math.round(
                (+new Date(booking.ends_at) -
                    +new Date(booking.scheduled_for)) /
                    60000
            );
            const { start, end } = bookingTimes(scheduledFor, durationMins);
            if (+start === +new Date(booking.scheduled_for))
                throw new CheckoutError(
                    'Choose a different time for the reschedule proposal',
                    400
                );
            const proposedService = {
                id: booking.service_id,
                buffer_mins: booking.buffer_mins,
                max_bookings_per_slot: service.max_bookings_per_slot,
            };
            if (
                (await capacity(
                    client,
                    proposedService,
                    start,
                    end,
                    booking.id
                )) < 1
            )
                throw new CheckoutError(
                    'The proposed time is fully booked',
                    409
                );

            const updated = (
                await client.query(
                    `UPDATE service_bookings SET proposed_scheduled_for = $1,
                    proposed_ends_at = $2, updated_at = NOW()
                    WHERE id = $3 RETURNING *`,
                    [start, end, id]
                )
            ).rows[0];
            await notifyBooking(client, updated, 'reschedule_proposed');
            return updated;
        });
    }

    static async respondToReschedule(id, userId, accept) {
        return transaction(pool, async (client) => {
            const lookup = (
                await client.query(
                    `SELECT service_id FROM service_bookings WHERE id = $1 AND user_id = $2`,
                    [id, userId]
                )
            ).rows[0];
            if (!lookup) throw new CheckoutError('Booking not found', 404);

            const service = (
                await client.query(
                    `SELECT max_bookings_per_slot FROM services WHERE id = $1 FOR UPDATE`,
                    [lookup.service_id]
                )
            ).rows[0];
            const booking = (
                await client.query(
                    `SELECT * FROM service_bookings WHERE id = $1 AND user_id = $2 FOR UPDATE`,
                    [id, userId]
                )
            ).rows[0];
            if (
                booking.booking_status !== 'confirmed' ||
                booking.payment_status !== 'paid' ||
                !booking.proposed_scheduled_for ||
                !booking.proposed_ends_at ||
                new Date(booking.scheduled_for) <= new Date() ||
                new Date(booking.proposed_scheduled_for) <= new Date()
            )
                throw new CheckoutError(
                    'There is no reschedule proposal awaiting your response',
                    409
                );

            let scheduledFor = booking.scheduled_for;
            let endsAt = booking.ends_at;
            if (accept) {
                const proposedService = {
                    id: booking.service_id,
                    buffer_mins: booking.buffer_mins,
                    max_bookings_per_slot: service.max_bookings_per_slot,
                };
                if (
                    (await capacity(
                        client,
                        proposedService,
                        booking.proposed_scheduled_for,
                        booking.proposed_ends_at,
                        booking.id
                    )) < 1
                )
                    throw new CheckoutError(
                        'The proposed time is no longer available',
                        409
                    );
                scheduledFor = booking.proposed_scheduled_for;
                endsAt = booking.proposed_ends_at;
            }
            const updated = (
                await client.query(
                    `UPDATE service_bookings SET scheduled_for = $1, ends_at = $2,
                    proposed_scheduled_for = NULL, proposed_ends_at = NULL,
                    updated_at = NOW() WHERE id = $3 RETURNING *`,
                    [scheduledFor, endsAt, id]
                )
            ).rows[0];
            await notifyBooking(
                client,
                updated,
                accept ? 'reschedule_approved' : 'reschedule_declined'
            );
            return updated;
        });
    }
}
