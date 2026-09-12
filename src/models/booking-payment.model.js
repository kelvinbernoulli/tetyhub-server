import { randomUUID } from 'node:crypto';
import pool from '#services/pg_pool.js';
import * as gatewayApi from '#utils/payment.js';
import {
    CheckoutError,
    transaction,
    minorUnits,
    assertGatewayCurrency,
} from '#utils/checkout.js';
import { bookingPayable } from '#utils/booking.js';

export default class BookingPayment {
    static gatewayApi = gatewayApi;

    static async initiate(userId, bookingId) {
        const attempt = await transaction(pool, async (client) => {
            const booking = (
                await client.query(
                    `SELECT b.*, c.code AS currency, u.email FROM service_bookings b
                JOIN currencies c ON c.id = b.currency_id JOIN users u ON u.id = b.user_id
                WHERE b.id = $1 AND b.user_id = $2 FOR UPDATE OF b`,
                    [bookingId, userId]
                )
            ).rows[0];
            if (!booking) throw new CheckoutError('Booking not found', 404);
            if (booking.payment_status === 'paid')
                return {
                    booking_id: booking.id,
                    payment_status: 'paid',
                    status: booking.booking_status,
                };
            if (!bookingPayable(booking))
                throw new CheckoutError('Booking is no longer payable', 409);
            assertGatewayCurrency(booking.payment_method, booking.currency);
            let payment = (
                await client.query(
                    'SELECT * FROM payments WHERE booking_id = $1 FOR UPDATE',
                    [booking.id]
                )
            ).rows[0];
            if (payment?.checkout_data)
                return JSON.parse(payment.checkout_data);
            if (
                payment?.initializing_until &&
                new Date(payment.initializing_until) > new Date()
            )
                throw new CheckoutError(
                    'Payment initialization in progress; retry shortly',
                    409
                );
            if (!payment)
                payment = (
                    await client.query(
                        `INSERT INTO payments
                (booking_id,user_id,vendor_id,gateway,gateway_ref,amount,currency_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                        [
                            booking.id,
                            userId,
                            booking.vendor_id,
                            booking.payment_method,
                            `booking-${randomUUID()}`,
                            booking.total,
                            booking.currency_id,
                        ]
                    )
                ).rows[0];
            await client.query(
                "UPDATE payments SET initializing_until = NOW() + INTERVAL '60 seconds' WHERE id = $1",
                [payment.id]
            );
            return { payment, booking };
        });
        if (!attempt.payment) return attempt;
        const { payment, booking } = attempt;
        const gateway = payment.gateway;
        try {
            const args = {
                email: booking.email,
                amount: booking.total,
                currency: booking.currency,
                reference: payment.gateway_ref,
                metadata: {
                    booking_id: String(booking.id),
                    payment_reference: payment.gateway_ref,
                },
            };
            const response =
                gateway === 'paystack'
                    ? await this.gatewayApi.initializePaystack(args)
                    : await this.gatewayApi.initializeStripe(args);
            const result = {
                booking_id: booking.id,
                gateway,
                reference: payment.gateway_ref,
                ...(gateway === 'paystack'
                    ? { authorization_url: response.authorization_url }
                    : { client_secret: response.client_secret }),
            };
            await pool.query(
                `UPDATE payments SET provider_ref = $1, checkout_data = $2,
                initializing_until = NULL, updated_at = NOW() WHERE id = $3`,
                [
                    gateway === 'paystack' ? payment.gateway_ref : response.id,
                    JSON.stringify(result),
                    payment.id,
                ]
            );
            return result;
        } catch (error) {
            await pool.query(
                'UPDATE payments SET initializing_until = NULL WHERE id = $1',
                [payment.id]
            );
            // A timed-out Paystack request may already have created a charge. Retain its reference.
            if (gateway === 'paystack') {
                try {
                    const result = await this.settle(
                        gateway,
                        await this.gatewayApi.verifyPaystack(
                            payment.gateway_ref
                        )
                    );
                    return {
                        gateway,
                        reference: payment.gateway_ref,
                        ...result,
                        verification_required: result.payment_status !== 'paid',
                    };
                } catch {
                    /* Retrying uses the same payment reference. */
                }
            }
            throw error;
        }
    }

    static async settle(gateway, data, eventId = null) {
        const reference =
            gateway === 'paystack'
                ? data.reference
                : data.metadata?.payment_reference;
        if (
            !['paystack', 'stripe'].includes(gateway) ||
            typeof reference !== 'string' ||
            !reference.startsWith('booking-')
        )
            throw new CheckoutError('Invalid booking payment reference', 400);
        return transaction(pool, async (client) => {
            const lookup = (
                await client.query(
                    `SELECT b.id, b.service_id FROM payments p
                JOIN service_bookings b ON b.id = p.booking_id WHERE p.gateway = $1 AND p.gateway_ref = $2`,
                    [gateway, reference]
                )
            ).rows[0];
            if (!lookup) throw new CheckoutError('Payment not found', 404);
            // Lock service before booking, matching reservation creation; never reclaim an expired slot.
            await client.query(
                'SELECT id FROM services WHERE id = $1 FOR UPDATE',
                [lookup.service_id]
            );
            const booking = (
                await client.query(
                    'SELECT * FROM service_bookings WHERE id = $1 FOR UPDATE',
                    [lookup.id]
                )
            ).rows[0];
            const payment = (
                await client.query(
                    `SELECT p.*, c.code AS currency FROM payments p
                JOIN currencies c ON c.id = p.currency_id WHERE p.booking_id = $1 AND p.gateway_ref = $2 FOR UPDATE OF p`,
                    [booking.id, reference]
                )
            ).rows[0];
            if (
                !payment ||
                payment.order_id != null ||
                payment.user_id !== booking.user_id ||
                payment.currency_id !== booking.currency_id ||
                (gateway === 'stripe' &&
                    (String(data.metadata?.booking_id) !== String(booking.id) ||
                        (payment.provider_ref &&
                            payment.provider_ref !== data.id)))
            )
                throw new CheckoutError('Payment identity mismatch', 409);
            const success =
                data.status ===
                (gateway === 'paystack' ? 'success' : 'succeeded');
            const amount =
                gateway === 'stripe' && success
                    ? data.amount_received
                    : data.amount;
            if (
                Number(amount) !== minorUnits(payment.amount) ||
                minorUnits(payment.amount) !== minorUnits(booking.total) ||
                String(data.currency).toUpperCase() !== payment.currency
            )
                throw new CheckoutError(
                    'Payment amount or currency mismatch',
                    409
                );
            const current = {
                booking_id: booking.id,
                payment_status: booking.payment_status,
                status: booking.booking_status,
            };
            if (eventId) {
                const inserted = await client.query(
                    `INSERT INTO payment_events (payment_id,gateway,gateway_event_id,event_type)
                    VALUES ($1,$2,$3,$4) ON CONFLICT (gateway,gateway_event_id) DO NOTHING RETURNING id`,
                    [payment.id, gateway, eventId, data.status]
                );
                if (!inserted.rowCount) return current;
            }
            if (
                payment.status === 'success' ||
                booking.payment_status === 'paid' ||
                !success
            )
                return current;
            const status = bookingPayable(booking)
                ? 'confirmed'
                : 'payment_review';
            await client.query(
                `UPDATE payments SET status = 'success', provider_ref = $1, paid_at = NOW(),
                initializing_until = NULL, updated_at = NOW() WHERE id = $2`,
                [gateway === 'stripe' ? data.id : reference, payment.id]
            );
            await client.query(
                `UPDATE service_bookings SET booking_status = $1, payment_status = 'paid',
                refund_due = $2, reservation_expires_at = NULL, updated_at = NOW() WHERE id = $3`,
                [
                    status,
                    status === 'payment_review' ? booking.total : '0.00',
                    booking.id,
                ]
            );
            await client.query(
                `INSERT INTO notifications (user_id,type,title,message,metadata)
                VALUES ($1,'booking',$2,$3,$4)`,
                [
                    booking.user_id,
                    'Booking payment received',
                    status === 'confirmed'
                        ? `Your booking for ${booking.service_name} is confirmed.`
                        : 'Your payment requires refund review because the booking reservation is no longer available.',
                    JSON.stringify({ booking_id: booking.id }),
                ]
            );
            return { booking_id: booking.id, payment_status: 'paid', status };
        });
    }
}
