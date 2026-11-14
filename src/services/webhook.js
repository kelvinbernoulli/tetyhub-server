import crypto from 'node:crypto';
import Payment from '#models/payment.model.js';
import Shipment from '#models/shipment.model.js';
import SubscriptionService from '#services/subscription.service.js';
import pool from '#services/pg_pool.js';
import { transaction } from '#utils/checkout.js';
import { stripeClient } from '#utils/payment.js';
import { notifyReturn } from '#services/notifications.js';

const PAYSTACK_EVENTS = new Set([
    'charge.success',
    'invoice.create',
    'invoice.payment_failed',
    'invoice.update',
    'subscription.create',
    'subscription.disable',
    'subscription.not_renew',
    'refund.pending',
    'refund.processing',
    'refund.needs-attention',
    'refund.failed',
    'refund.processed',
]);

export async function paystackWebhook(req, res) {
    const signature = req.headers['x-paystack-signature'];
    if (
        !process.env.PAYSTACK_SECRET_KEY ||
        !Buffer.isBuffer(req.body) ||
        typeof signature !== 'string' ||
        !/^[a-f0-9]{128}$/i.test(signature)
    )
        return res.sendStatus(401);
    const expected = crypto
        .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
        .update(req.body)
        .digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex')))
        return res.sendStatus(401);
    try {
        const event = JSON.parse(req.body.toString('utf8'));
        const { event: eventType, data } = event;
        if (!PAYSTACK_EVENTS.has(eventType)) return res.sendStatus(200);
        if (!data || typeof data !== 'object' || Array.isArray(data))
            return res.sendStatus(400);

        const transactionId =
            eventType === 'charge.success' && data.id !== undefined
                ? String(data.id)
                : null;
        const reference =
            typeof data.reference === 'string' ? data.reference : null;
        const refundReference =
            typeof data.refund_reference === 'string' ? data.refund_reference : null;
        const subscriptionCode =
            data.subscription?.subscription_code ??
            data.subscription_code ??
            null;
        const customerCode =
            data.customer?.customer_code ?? data.customer_code ?? null;
        const identifier =
            transactionId ??
            (typeof data.invoice_code === 'string' ? data.invoice_code : null) ??
            (typeof data.id === 'string' || typeof data.id === 'number'
                ? String(data.id)
                : subscriptionCode);
        if (!identifier) return res.sendStatus(400);

        await pool.query(
            `INSERT INTO paystack_webhook_events
                (event_key, event_type, reference, refund_reference, transaction_id,
                 subscription_code, customer_code, event_status)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT (event_key) DO NOTHING`,
            [
                `${eventType}:${identifier}`,
                eventType,
                reference,
                refundReference,
                transactionId,
                subscriptionCode,
                customerCode,
                typeof data.status === 'string' ? data.status : null,
            ]
        );
        return res.sendStatus(200);
    } catch (error) {
        console.error('Paystack webhook enqueue failed:', error.message);
        return res.sendStatus(500);
    }
}

export async function processPaystackEvent(event) {
    if (event.event_type.startsWith('refund.')) {
        if (!event.refund_reference) {
            console.warn('Paystack refund event did not include a refund reference:', event.event_key);
            return;
        }
        const refundStatus = event.event_type === 'refund.processed'
            ? 'processed'
            : event.event_type === 'refund.failed'
              ? 'failed'
              : 'queued';
        await transaction(pool, async (client) => {
            const { rows } = await client.query(
                `UPDATE order_refunds SET status = $2, last_error = NULL,
                    updated_at = NOW(),
                    processed_at = CASE WHEN $2 = 'processed' THEN NOW() ELSE processed_at END
                 WHERE refund_reference = $1 RETURNING return_id`,
                [event.refund_reference, refundStatus]
            );
            if (!rows[0]) return;
            const changed = await client.query(
                `UPDATE returns SET refund_status = $2,
                    refund_processed_at = CASE WHEN $2 = 'processed' THEN NOW() ELSE refund_processed_at END,
                    status = CASE WHEN $2 = 'processed' AND status = 'processing' THEN 'completed' ELSE status END,
                    completed_at = CASE WHEN $2 = 'processed' AND status = 'processing' THEN NOW() ELSE completed_at END,
                    updated_at = NOW()
                 WHERE id = $1 AND refund_status IS DISTINCT FROM $2 RETURNING *`,
                [rows[0].return_id, refundStatus]
            );
            if (changed.rows[0]) await notifyReturn(client, changed.rows[0], changed.rows[0].status);
            if (refundStatus === 'processed') {
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
                                   WHERE rf.return_id = $1 AND rf.status = 'processed')`,
                    [rows[0].return_id]
                );
            }
        });
        return;
    }
    if (event.event_type === 'charge.success') {
        if (!event.reference)
            throw new Error('Paystack charge event has no reference');
        const verified = await Payment.gatewayApi.verifyPaystack(
            event.reference
        );
        const isSubscriptionCharge =
            await SubscriptionService.handleChargeSuccess(
                verified,
                event.event_key
            );
        if (!isSubscriptionCharge)
            await Payment.settle('paystack', verified, event.event_key);
        return;
    }
    if (event.event_type === 'invoice.payment_failed') {
        await SubscriptionService.handleChargeFailed(
            {
                subscription_code: event.subscription_code,
                status: event.event_status,
            },
            event.event_key
        );
        return;
    }
    if (
        event.event_type === 'subscription.create' ||
        event.event_type === 'subscription.disable' ||
        event.event_type === 'subscription.not_renew' ||
        event.event_type === 'invoice.create' ||
        event.event_type === 'invoice.update'
    ) {
        await SubscriptionService.handleSubscriptionEvent({
            eventType: event.event_type,
            eventKey: event.event_key,
            subscriptionCode: event.subscription_code,
            customerCode: event.customer_code,
            eventStatus: event.event_status,
        });
    }
}

export function startPaystackWebhookWorker({ intervalMs = 5000 } = {}) {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const claimed = await transaction(pool, async (client) => {
                const { rows } = await client.query(
                    `WITH ready AS (
                        SELECT id FROM paystack_webhook_events
                        WHERE (status = 'pending' AND available_at <= NOW())
                           OR (status = 'processing'
                               AND processing_until < NOW())
                        ORDER BY id
                        FOR UPDATE SKIP LOCKED
                        LIMIT 20
                     )
                     UPDATE paystack_webhook_events e
                     SET status = 'processing', attempts = attempts + 1,
                         processing_until = NOW() + INTERVAL '2 minutes'
                     FROM ready WHERE e.id = ready.id
                     RETURNING e.*`
                );
                return rows;
            });
            for (const event of claimed) {
                try {
                    await processPaystackEvent(event);
                    await pool.query(
                        `UPDATE paystack_webhook_events
                         SET status = 'processed', processed_at = NOW(),
                             processing_until = NULL, last_error = NULL
                         WHERE id = $1`,
                        [event.id]
                    );
                } catch (error) {
                    const status = event.attempts >= 10 ? 'failed' : 'pending';
                    await pool.query(
                        `UPDATE paystack_webhook_events
                         SET status = $2, processing_until = NULL,
                             available_at = NOW() + make_interval(secs =>
                                 LEAST(300, 5 * POWER(2, LEAST(attempts, 6)))),
                             last_error = $3
                         WHERE id = $1`,
                        [
                            event.id,
                            status,
                            String(error.message).slice(0, 500),
                        ]
                    );
                    console.error(
                        'Paystack event processing failed:',
                        event.event_key,
                        error.message
                    );
                }
            }
        } catch (error) {
            console.error('Paystack event worker failed:', error.message);
        } finally {
            running = false;
        }
    };
    const timer = setInterval(run, intervalMs);
    timer.unref();
    void run();
    return () => clearInterval(timer);
}

export async function stripeWebhook(req, res) {
    let event;
    try {
        event = stripeClient().webhooks.constructEvent(
            req.body,
            req.headers['stripe-signature'],
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch {
        return res.sendStatus(400);
    }
    try {
        if (event.type === 'payment_intent.succeeded')
            await Payment.settle('stripe', event.data.object, event.id);
        if (event.type === 'refund.updated') {
            const refund = event.data.object;
            const reference = refund.metadata?.refund_reference;
            if (reference) {
                const status = refund.status === 'succeeded'
                    ? 'processed'
                    : refund.status === 'failed' || refund.status === 'canceled'
                      ? 'failed'
                      : 'queued';
                await transaction(pool, async (client) => {
                    const { rows } = await client.query(
                        `UPDATE order_refunds SET status = $2, provider_ref = $3,
                            updated_at = NOW(),
                            processed_at = CASE WHEN $2 = 'processed' THEN NOW() ELSE processed_at END
                         WHERE refund_reference = $1 RETURNING return_id`,
                        [reference, status, refund.id]
                    );
                    if (!rows[0]) return;
                    const changed = await client.query(
                        `UPDATE returns SET refund_status = $2,
                            refund_processed_at = CASE WHEN $2 = 'processed' THEN NOW() ELSE refund_processed_at END,
                            status = CASE WHEN $2 = 'processed' AND status = 'processing' THEN 'completed' ELSE status END,
                            completed_at = CASE WHEN $2 = 'processed' AND status = 'processing' THEN NOW() ELSE completed_at END,
                            updated_at = NOW() WHERE id = $1 AND refund_status IS DISTINCT FROM $2 RETURNING *`,
                        [rows[0].return_id, status]
                    );
                    if (changed.rows[0]) await notifyReturn(client, changed.rows[0], changed.rows[0].status);
                });
            }
        }
        return res.sendStatus(200);
    } catch (error) {
        console.error('Stripe webhook processing failed:', error.message);
        return res.sendStatus(500);
    }
}

export async function shipBubbleWebhook(req, res) {
    const keyName = process.env.NODE_ENV === 'production'
        ? 'SHIPBUBBLE_LIVE_KEY'
        : 'SHIPBUBBLE_TEST_KEY';
    const apiKey = process.env[keyName]?.trim();
    if (!apiKey) {
        console.error('ShipBubble webhook verification is not configured:', keyName);
        return res.sendStatus(503);
    }

    const signature = req.headers['x-ship-signature'];
    if (
        !Buffer.isBuffer(req.body) ||
        typeof signature !== 'string' ||
        !/^[a-f0-9]{128}$/i.test(signature)
    )
        return res.sendStatus(401);

    const expectedSignature = crypto
        .createHmac('sha512', apiKey)
        .update(req.body)
        .digest();
    if (!crypto.timingSafeEqual(expectedSignature, Buffer.from(signature, 'hex')))
        return res.sendStatus(401);

    let payload;
    try {
        payload = JSON.parse(req.body.toString('utf8'));
    } catch {
        return res.sendStatus(400);
    }
    console.info('Received ShipBubble webhook:', {
        event: typeof payload?.event === 'string' ? payload.event : null,
        orderId: payload?.order_id === undefined ? null : String(payload.order_id),
        status: typeof payload?.status === 'string' ? payload.status : null,
    });

    const orderId = payload?.order_id === undefined || payload?.order_id === null
        ? null
        : String(payload.order_id);
    const trackingCode = payload?.courier?.tracking_code;
    const providerStatus =
        typeof payload?.status === 'string' ? payload.status.toLowerCase() : null;
    if (
        !payload ||
        typeof payload !== 'object' ||
        Array.isArray(payload) ||
        typeof orderId !== 'string' || !orderId.trim() ||
        !providerStatus
    )
        return res.sendStatus(400);

    const statusMap = {
        pending: 'pending',
        confirmed: 'shipped',
        picked_up: 'shipped',
        in_transit: 'in_transit',
        completed: 'delivered',
        cancelled: 'cancelled',
    };
    const nextStatus = statusMap[providerStatus];
    if (!nextStatus) return res.sendStatus(200);

    try {
        const { rows } = await pool.query(
            `SELECT id, vendor_id, status FROM shipments
             WHERE shipbubble_order_id = $1
             LIMIT 2`,
            [orderId.trim()]
        );
        if (rows.length !== 1 || !rows[0].vendor_id) {
            console.warn(
                'ShipBubble webhook did not resolve to one vendor shipment:',
                orderId
            );
            return res.sendStatus(404);
        }

        const shipment = rows[0];
        const trackingUrl = payload.courier?.tracking_url ?? payload.tracking_url;
        const waybillDocument = payload.waybill_document ?? payload.waybill_url;
        const courierName = payload.courier?.name ?? payload.courier?.courier_name;
        const events = Array.isArray(payload.events) ? payload.events : [];
        const lastEvent = events.at(-1);
        const trackingDescription =
            (typeof lastEvent?.message === 'string' && lastEvent.message) ||
            (typeof payload.courier?.tracking_message === 'string' &&
                payload.courier.tracking_message) ||
            `ShipBubble status: ${providerStatus}`;
        const update = {
            status: nextStatus,
            tracking_number: trackingCode ?? undefined,
            tracking_url: trackingUrl ?? undefined,
            waybill_document: waybillDocument ?? undefined,
            carrier: courierName ?? undefined,
            location:
                typeof lastEvent?.location === 'string'
                    ? lastEvent.location.slice(0, 200)
                    : null,
            tracking_description: String(trackingDescription).slice(0, 500),
        };
        const statusRank = {
            pending: 0,
            processing: 1,
            shipped: 2,
            in_transit: 3,
            out_for_delivery: 4,
            delivered: 5,
        };
        const staleStatus =
            (statusRank[nextStatus] !== undefined &&
                statusRank[shipment.status] !== undefined &&
                statusRank[nextStatus] < statusRank[shipment.status]) ||
            (nextStatus === 'cancelled' &&
                !['pending', 'processing', 'failed'].includes(shipment.status));
        if (shipment.status === nextStatus || staleStatus) {
            const trackingOnlyUpdate = { ...update };
            delete trackingOnlyUpdate.status;
            await Shipment.updateShipment(
                shipment.id,
                shipment.vendor_id,
                trackingOnlyUpdate,
                null,
                true,
                true
            );
            return res.sendStatus(200);
        }

        // The internal state machine requires an initial shipped state before
        // moving directly from pending/processing to an in-transit or delivered
        // event, which ShipBubble may send without intermediate callbacks.
        if (
            ['in_transit', 'delivered'].includes(nextStatus) &&
            ['pending', 'processing'].includes(shipment.status)
        ) {
            await Shipment.updateShipment(
                shipment.id,
                shipment.vendor_id,
                {
                    status: 'shipped',
                    tracking_description: 'Shipment accepted by ShipBubble',
                },
                null,
                true,
                true
            );
        }
        await Shipment.updateShipment(
            shipment.id,
            shipment.vendor_id,
            update,
            null,
            true,
            true
        );
        return res.sendStatus(200);
    } catch (error) {
        console.error('ShipBubble webhook processing failed:', error.message);
        return res.sendStatus(
            error.status >= 400 && error.status < 500 ? error.status : 500
        );
    }
}
