import BookingPayment from '#models/booking-payment.model.js';
import { randomUUID } from 'node:crypto';
import pool from '#services/pg_pool.js';
import * as gatewayApi from '#utils/payment.js';
import {
    CheckoutError,
    assertGatewayCurrency,
    minorUnits,
    transaction,
} from '#utils/checkout.js';

export class Payment {
    static gatewayApi = gatewayApi;
    static async initiatePayment(userId, orderId, gateway) {
        const attempt = await transaction(pool, async (client) => {
            const { rows } = await client.query(
                `SELECT o.*, c.code AS currency, COALESCE(o.contact_email,u.email) AS email
                FROM orders o JOIN users u ON u.id = o.user_id JOIN currencies c ON c.id = o.currency_id
                WHERE o.id = $1 AND o.user_id = $2 FOR UPDATE OF o`,
                [orderId, userId]
            );
            const order = rows[0];
            if (!order) throw new CheckoutError('Order not found', 404);
            if (order.payment_status === 'paid')
                return {
                    payment_status: 'paid',
                    order_id: order.id,
                    status: order.status,
                };
            if (
                order.status !== 'pending' ||
                order.payment_status !== 'unpaid' ||
                !order.reservation_expires_at ||
                new Date(order.reservation_expires_at) <= new Date()
            )
                throw new CheckoutError('Order is no longer payable', 409);
            if (gateway !== order.payment_method)
                throw new CheckoutError(
                    'Use the payment gateway selected at checkout',
                    409
                );
            assertGatewayCurrency(gateway, order.currency);
            const existing = await client.query(
                'SELECT * FROM payments WHERE order_id = $1 ORDER BY id LIMIT 1 FOR UPDATE',
                [order.id]
            );
            let payment = existing.rows[0];
            if (payment?.checkout_data)
                return JSON.parse(payment.checkout_data);
            if (
                payment?.initializing_until &&
                new Date(payment.initializing_until) > new Date()
            )
                throw new CheckoutError(
                    'Payment initialization is in progress; retry shortly',
                    409
                );
            if (!payment) {
                payment = (
                    await client.query(
                        `INSERT INTO payments (order_id,user_id,gateway,gateway_ref,amount,currency_id)
                    VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
                        [
                            order.id,
                            userId,
                            gateway,
                            `checkout-${randomUUID()}`,
                            order.total,
                            order.currency_id,
                        ]
                    )
                ).rows[0];
            }
            await client.query(
                "UPDATE payments SET initializing_until = NOW() + INTERVAL '60 seconds' WHERE id = $1",
                [payment.id]
            );
            return { payment, order };
        });
        if (!attempt.payment) return attempt;
        const { payment, order } = attempt;
        try {
            const args = {
                email: order.email,
                amount: order.total,
                currency: order.currency,
                reference: payment.gateway_ref,
                metadata: {
                    order_id: String(order.id),
                    payment_reference: payment.gateway_ref,
                },
            };
            const response =
                gateway === 'paystack'
                    ? await Payment.gatewayApi.initializePaystack(args)
                    : await Payment.gatewayApi.initializeStripe(args);
            const result = {
                gateway,
                reference: payment.gateway_ref,
                ...(gateway === 'paystack'
                    ? { authorization_url: response.authorization_url }
                    : { client_secret: response.client_secret }),
            };
            await pool.query(
                `UPDATE payments SET provider_ref = $1, checkout_data = $2, initializing_until = NULL, updated_at = NOW() WHERE id = $3`,
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
            if (gateway === 'paystack') {
                // A timeout may mean the provider accepted the stable reference. Never mint a second charge.
                try {
                    const verified = await Payment.gatewayApi.verifyPaystack(
                        payment.gateway_ref
                    );
                    const settled = await Payment.settle('paystack', verified);
                    return {
                        gateway,
                        reference: payment.gateway_ref,
                        ...settled,
                        verification_required:
                            settled.payment_status !== 'paid',
                    };
                } catch {
                    /* Keep the original initialization failure; the retry route uses the same reference. */
                }
            }
            throw error;
        }
    }

    static async verifyPayment(gateway, reference, userId) {
        if (!['paystack', 'stripe'].includes(gateway) || !reference || !userId)
            throw new CheckoutError(
                'Invalid payment verification request',
                400
            );
        const { rows } = await pool.query(
            'SELECT * FROM payments WHERE gateway = $1 AND gateway_ref = $2 AND user_id = $3',
            [gateway, reference, userId]
        );
        const payment = rows[0];
        if (!payment) throw new CheckoutError('Payment not found', 404);
        const providerRef =
            payment.provider_ref || (gateway === 'paystack' ? reference : null);
        if (!providerRef)
            throw new CheckoutError('Payment is still initializing', 409);
        const data =
            gateway === 'paystack'
                ? await Payment.gatewayApi.verifyPaystack(providerRef)
                : await Payment.gatewayApi.verifyStripe(providerRef);
        return Payment.settle(gateway, data);
    }

    static async settle(gateway, data, eventId = null) {
        const reference =
            gateway === 'paystack'
                ? data.reference
                : data.metadata?.payment_reference;
        if (!reference)
            throw new CheckoutError('Missing payment reference', 400);
        if (typeof reference === 'string' && reference.startsWith('booking-'))
            return BookingPayment.settle(gateway, data, eventId);
        return transaction(pool, async (client) => {
            // All order mutations lock the order first, including expiry and cancellation.
            const lookup = await client.query(
                'SELECT order_id FROM payments WHERE gateway = $1 AND gateway_ref = $2',
                [gateway, reference]
            );
            if (!lookup.rows.length)
                throw new CheckoutError('Payment not found', 404);
            const order = (
                await client.query(
                    'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
                    [lookup.rows[0].order_id]
                )
            ).rows[0];
            const payment = (
                await client.query(
                    `SELECT p.*, c.code AS currency FROM payments p JOIN currencies c ON c.id = p.currency_id
                WHERE p.gateway = $1 AND p.gateway_ref = $2 FOR UPDATE OF p`,
                    [gateway, reference]
                )
            ).rows[0];
            if (
                gateway === 'stripe' &&
                ((payment.provider_ref && payment.provider_ref !== data.id) ||
                    String(data.metadata?.order_id) !== String(order.id))
            )
                throw new CheckoutError('Payment identity mismatch', 409);
            const success =
                gateway === 'paystack'
                    ? data.status === 'success'
                    : data.status === 'succeeded';
            const amount =
                gateway === 'stripe' && success
                    ? data.amount_received
                    : data.amount;
            if (
                Number(amount) !== minorUnits(payment.amount) ||
                String(data.currency).toUpperCase() !== payment.currency ||
                minorUnits(order.total) !== minorUnits(payment.amount)
            )
                throw new CheckoutError(
                    'Payment amount or currency mismatch',
                    409
                );
            if (eventId) {
                const inserted = await client.query(
                    `INSERT INTO payment_events (payment_id,gateway,gateway_event_id,event_type)
                    VALUES ($1,$2,$3,$4) ON CONFLICT (gateway,gateway_event_id) DO NOTHING RETURNING id`,
                    [payment.id, gateway, eventId, data.status]
                );
                if (!inserted.rowCount)
                    return {
                        order_id: order.id,
                        payment_status: order.payment_status,
                        status: order.status,
                    };
            }
            if (payment.status === 'success' || order.payment_status === 'paid')
                return {
                    order_id: order.id,
                    payment_status: order.payment_status,
                    status: order.status,
                };
            if (!success) {
                // Pending and failed attempts never downgrade a paid order or close a reusable intent.
                await client.query(
                    'UPDATE payments SET meta = $1, updated_at = NOW() WHERE id = $2',
                    [JSON.stringify({ status: data.status }), payment.id]
                );
                return {
                    order_id: order.id,
                    payment_status: order.payment_status,
                    status: order.status,
                };
            }
            await client.query(
                `UPDATE payments SET status = 'success', provider_ref = $1, paid_at = NOW(), initializing_until = NULL, updated_at = NOW() WHERE id = $2`,
                [gateway === 'stripe' ? data.id : reference, payment.id]
            );
            // A cancelled reservation must never be resurrected into fulfillment.
            const status =
                order.status === 'pending' ? 'processing' : 'payment_review';
            await client.query(
                "UPDATE orders SET payment_status = 'paid', status = $1, reservation_expires_at = NULL, updated_at = NOW() WHERE id = $2",
                [status, order.id]
            );
            await client.query(
                'INSERT INTO order_status_history (order_id,status,note) VALUES ($1,$2,$3)',
                [
                    order.id,
                    status,
                    status === 'processing'
                        ? 'Payment confirmed'
                        : 'Payment arrived after cancellation; refund review required',
                ]
            );
            if (status === 'processing')
                await client.query(
                    'INSERT INTO checkout_notifications (order_id) VALUES ($1) ON CONFLICT (order_id) DO NOTHING',
                    [order.id]
                );
            return { order_id: order.id, payment_status: 'paid', status };
        });
    }

    // The legacy refund implementation could mark unissued store credit as refunded and
    // restock a full order for a partial refund. Fail closed until a reconciled refund workflow exists.
    static async processRefund() {
        throw new CheckoutError(
            'Automated refunds are unavailable; process and reconcile through the payment provider',
            503
        );
    }
}
export default Payment;
