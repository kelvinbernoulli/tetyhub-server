import { notifyOrder, notifyPaymentFailure, notifyReturn } from '#services/notifications.js';
import { recordProductSale } from '#services/marketplace-ledger.js';
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
    static async initiatePayment(userId, orderId, gateway = 'paystack') {
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
                    : gateway === 'paystack' &&
                        success &&
                        data.requested_amount !== undefined &&
                        data.requested_amount !== null
                      ? data.requested_amount
                      : data.amount;
            const receivedAmount = Number(data.amount);
            const expectedAmount = Number(amount);
            const amountIsInsufficient =
                gateway === 'paystack' &&
                success &&
                (!Number.isSafeInteger(receivedAmount) ||
                    receivedAmount < expectedAmount);
            if (
                Number(amount) !== minorUnits(payment.amount) ||
                amountIsInsufficient ||
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
                await notifyPaymentFailure(client, payment, data.status, { order_id: order.id, payment_id: payment.id });
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
            if (status === 'processing') {
                await client.query(
                    "UPDATE vendor_order_fulfillments SET status = 'processing', updated_at = NOW() WHERE order_id = $1",
                    [order.id]
                );
                await client.query(
                    `INSERT INTO vendor_order_fulfillment_history
                     (fulfillment_id, status, note)
                     SELECT id, status, 'Payment confirmed'
                     FROM vendor_order_fulfillments WHERE order_id = $1`,
                    [order.id]
                );
                await recordProductSale(client, order.id);
                await client.query(
                    `UPDATE shipbubble_rate_quotes
                     SET booking_status = 'pending'
                     WHERE order_id = $1 AND booking_status = 'unpaid'`,
                    [order.id]
                );
            }
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
            await notifyOrder(client, order, status);
            return { order_id: order.id, payment_status: 'paid', status };
        });
    }

    static async processReturnRefund(returnId) {
        const refund = await transaction(pool, async (client) => {
            const result = await client.query(
                `SELECT r.*, o.payment_status, o.currency_id,
                        p.id AS payment_id, p.gateway, p.gateway_ref, p.provider_ref,
                        p.status AS payment_status_record, p.amount AS payment_amount
                 FROM returns r
                 JOIN orders o ON o.id = r.order_id
                 JOIN payments p ON p.order_id = o.id AND p.status = 'success'
                 WHERE r.id = $1
                 ORDER BY p.id DESC LIMIT 1
                 FOR UPDATE OF r, p`,
                [returnId]
            );
            const record = result.rows[0];
            if (!record) throw new CheckoutError('Successful payment for this return was not found', 409);
            if (record.payment_status !== 'paid' || record.return_type !== 'refund')
                throw new CheckoutError('This return is not eligible for a payment refund', 409);
            if (!['processing', 'completed'].includes(record.status))
                throw new CheckoutError('Returned item must be received before refund processing', 409);

            let existing = (await client.query(
                'SELECT * FROM order_refunds WHERE return_id = $1 FOR UPDATE',
                [returnId]
            )).rows[0];
            if (existing?.status === 'processed') return { ...existing, alreadyProcessed: true };

            const prior = await client.query(
                `SELECT COALESCE(SUM(amount), 0)::numeric AS total
                 FROM order_refunds WHERE payment_id = $1 AND status <> 'failed' AND return_id <> $2`,
                [record.payment_id, returnId]
            );
            const amount = Number(record.refund_amount);
            if (!Number.isFinite(amount) || amount <= 0 ||
                Number(prior.rows[0].total) + amount > Number(record.payment_amount) + 0.005) {
                throw new CheckoutError('Refund amount exceeds the remaining paid balance', 409);
            }

            if (!existing) {
                const refundReference = `ret-${returnId}-${randomUUID()}`;
                existing = (await client.query(
                    `INSERT INTO order_refunds
                     (return_id, payment_id, gateway, transaction_reference,
                      refund_reference, amount, currency_id, status)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,'queued') RETURNING *`,
                    [returnId, record.payment_id, record.gateway,
                        record.provider_ref || record.gateway_ref, refundReference,
                        amount, record.currency_id]
                )).rows[0];
            }
            await client.query(
                `UPDATE returns SET refund_status = 'queued', refund_reference = $2,
                    refund_amount = $3, updated_at = NOW() WHERE id = $1`,
                [returnId, existing.refund_reference, existing.amount]
            );
            return existing;
        });

        if (refund.alreadyProcessed) return refund;

        try {
            let providerData;
            if (refund.gateway === 'paystack') {
                if (refund.status === 'queued' && refund.provider_ref) {
                    const response = await Payment.gatewayApi.getPaystackRefundByReference(refund.refund_reference);
                    const candidates = Array.isArray(response?.data) ? response.data : [response?.data];
                    providerData = candidates.find((entry) =>
                        entry && (entry.reference === refund.refund_reference || String(entry.id) === refund.provider_ref)
                    );
                    if (!providerData) return refund;
                } else try {
                    const response = await Payment.gatewayApi.refundPaystack({
                        reference: refund.transaction_reference,
                        amount: refund.amount,
                        merchant_note: `Approved product return ${returnId}`,
                        refundReference: refund.refund_reference,
                    });
                    providerData = response?.data ?? response;
                } catch (error) {
                    if (error.response?.status !== 409) throw error;
                    const response = await Payment.gatewayApi.getPaystackRefundByReference(refund.refund_reference);
                    const existing = Array.isArray(response?.data)
                        ? response.data.find((entry) => entry.reference === refund.refund_reference)
                        : response?.data;
                    if (!existing) throw error;
                    providerData = existing;
                }
            } else if (refund.gateway === 'stripe') {
                providerData = refund.status === 'queued' && refund.provider_ref
                    ? await Payment.gatewayApi.stripeClient().refunds.retrieve(refund.provider_ref)
                    : await Payment.gatewayApi.refundStripe({
                        paymentIntentId: refund.transaction_reference,
                        amount: refund.amount,
                        refundReference: refund.refund_reference,
                        reason: 'requested_by_customer',
                    });
            } else {
                throw new CheckoutError('Unsupported payment gateway for refunds', 422);
            }
            const status = providerData?.status === 'processed' || providerData?.status === 'succeeded'
                ? 'processed'
                : providerData?.status === 'failed' || providerData?.status === 'canceled'
                  ? 'failed'
                  : 'queued';
            const providerRef = String(providerData?.id ?? providerData?.reference ?? refund.refund_reference);
            await transaction(pool, async (client) => {
                await client.query(
                    `UPDATE order_refunds SET provider_ref = $2, status = $3,
                        last_error = NULL, updated_at = NOW(),
                        processed_at = CASE WHEN $3 = 'processed' THEN NOW() ELSE processed_at END
                     WHERE id = $1`,
                    [refund.id, providerRef, status]
                );
                await client.query(
                    `UPDATE returns SET refund_status = $2,
                        refund_processed_at = CASE WHEN $2 = 'processed' THEN NOW() ELSE refund_processed_at END,
                        updated_at = NOW() WHERE id = $1`,
                    [returnId, status]
                );
                if (status === 'processed') {
                    const completed = await client.query(
                        `UPDATE returns SET status = 'completed', completed_at = NOW(), updated_at = NOW()
                         WHERE id = $1 AND status = 'processing' RETURNING *`, [returnId]
                    );
                    if (completed.rows[0]) await notifyReturn(client, completed.rows[0], 'completed');
                    await client.query(
                        `UPDATE orders o SET
                             status = CASE WHEN
                                 (SELECT COALESCE(SUM(rf.amount), 0) FROM order_refunds rf
                                  JOIN payments p ON p.id = rf.payment_id
                                  WHERE p.order_id = o.id AND rf.status = 'processed') >=
                                 (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
                                  WHERE p.order_id = o.id AND p.status = 'success')
                                 THEN 'refunded' ELSE o.status END,
                             payment_status = CASE WHEN
                                 (SELECT COALESCE(SUM(rf.amount), 0) FROM order_refunds rf
                                  JOIN payments p ON p.id = rf.payment_id
                                  WHERE p.order_id = o.id AND rf.status = 'processed') >=
                                 (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
                                  WHERE p.order_id = o.id AND p.status = 'success')
                                 THEN 'refunded' ELSE 'partially_refunded' END,
                             updated_at = NOW()
                         WHERE o.id = (SELECT order_id FROM returns WHERE id = $1)
                           AND EXISTS (SELECT 1 FROM order_refunds rf
                                       WHERE rf.return_id = $1 AND rf.status = 'processed')`, [returnId]
                    );
                }
            });
            return { ...refund, status, provider_ref: providerRef };
        } catch (error) {
            // Keep the provider reference stable: retrying the same refund is idempotent.
            await pool.query(
                `UPDATE order_refunds SET last_error = $2, updated_at = NOW()
                 WHERE id = $1`,
                [refund.id, String(error.message ?? 'Refund request failed').slice(0, 500)]
            );
            throw error;
        }
    }

    static async reconcileReturnRefunds(limit = 25) {
        const { rows } = await pool.query(
            `SELECT return_id FROM order_refunds
             WHERE status = 'queued' AND updated_at < NOW() - INTERVAL '30 seconds'
             ORDER BY updated_at ASC LIMIT $1`,
            [limit]
        );
        for (const { return_id: returnId } of rows) {
            try {
                await Payment.processReturnRefund(returnId);
            } catch (error) {
                console.error(`Return refund reconciliation failed for return ${returnId}:`, error.message);
            }
        }
        return rows.length;
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
