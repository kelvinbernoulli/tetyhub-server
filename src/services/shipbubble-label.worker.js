import pool from '#services/pg_pool.js';
import Shipbubble from '#services/shipbubble.service.js';
import { transaction } from '#utils/checkout.js';
import Notification from '#models/notification.model.js';
import { platformRecipients } from '#services/notifications.js';
import { syncOrderFulfillment } from '#models/shipment.model.js';

const BOOKABLE_ORDER_STATUSES = [
    'processing',
    'awaiting_shipment',
    'packed',
    'shipped',
    'out_for_delivery',
];

function isOrderEligible(order) {
    return order?.payment_status === 'paid' &&
        BOOKABLE_ORDER_STATUSES.includes(order.status);
}

async function notifyCustomerOfLabelIssue(client, orderId, vendorId, status) {
    const { rows } = await client.query(
        'SELECT user_id, status, payment_status FROM orders WHERE id = $1',
        [orderId]
    );
    const order = rows[0];
    if (!isOrderEligible(order)) return;

    const message = status === 'failed'
        ? 'There is a delay preparing your shipment. Tracking will appear once the shipping label is ready.'
        : 'Your shipment is taking longer than expected to prepare. Tracking will appear once the shipping label is ready.';
    await Notification.createNotification(
        order.user_id,
        'shipment_update',
        'Shipping update',
        message,
        { order_id: orderId, vendor_id: vendorId, status: 'label_booking_issue' },
        client
    );
    await Notification.createMany(
        await platformRecipients(client, 'orders'),
        'shipment_update',
        'ShipBubble label needs attention',
        `A paid order has a ShipBubble label booking issue (${status}). Review the label issue queue.`,
        { order_id: orderId, vendor_id: vendorId, status },
        client
    );
}

async function markBookingIssue(quoteId, status, errorMessage) {
    return transaction(pool, async (client) => {
        const { rows } = await client.query(
            `UPDATE shipbubble_rate_quotes
             SET booking_status = $2, processing_until = NULL, booking_error = $3
             WHERE id = $1 AND booking_status = 'processing'
             RETURNING order_id, vendor_id`,
            [quoteId, status, errorMessage]
        );
        if (!rows[0]) return false;
        await notifyCustomerOfLabelIssue(
            client,
            rows[0].order_id,
            rows[0].vendor_id,
            status
        );
        return true;
    });
}

function providerData(response) {
    const data = response?.data ?? response;
    const courier = data?.courier ?? {};
    const providerStatus = typeof data?.status === 'string'
        ? data.status.toLowerCase()
        : 'pending';
    const shipmentStatus = {
        pending: 'pending',
        confirmed: 'shipped',
        picked_up: 'shipped',
        in_transit: 'in_transit',
        completed: 'delivered',
        cancelled: 'cancelled',
    }[providerStatus] ?? 'pending';
    return {
        orderId: data?.order_id ?? data?.id,
        trackingNumber: courier.tracking_code ?? data?.tracking_code ?? null,
        trackingUrl: courier.tracking_url ?? data?.tracking_url ?? null,
        waybillDocument:
            data?.waybill_document ?? data?.waybill_url ?? data?.document_url ?? null,
        carrier: courier.name ?? courier.courier_name ?? null,
        status: shipmentStatus,
    };
}

async function claimQuotes() {
    return transaction(pool, async (client) => {
        // An expired lease may have reached ShipBubble before the process died.
        // Do not automatically repeat a label purchase whose result is unknown.
        const expiredLeases = await client.query(
            `UPDATE shipbubble_rate_quotes
             SET booking_status = 'needs_review', processing_until = NULL,
                 booking_error = COALESCE(booking_error, 'Worker stopped during label booking; reconcile with ShipBubble')
             WHERE booking_status = 'processing' AND processing_until < NOW()
             RETURNING order_id, vendor_id`
        );
        for (const quote of expiredLeases.rows)
            await notifyCustomerOfLabelIssue(
                client,
                quote.order_id,
                quote.vendor_id,
                'needs_review'
            );
        const ineligibleQuotes = await client.query(
            `UPDATE shipbubble_rate_quotes q
             SET booking_status = 'failed', processing_until = NULL,
                 booking_error = COALESCE(booking_error, 'Order is no longer eligible for ShipBubble label booking')
             FROM orders o
             WHERE o.id = q.order_id
               AND q.booking_status = 'pending'
               AND (o.status IN ('cancelled', 'refunded') OR
                    (o.payment_status = 'paid' AND NOT (o.status = ANY($1::text[]))))
             RETURNING q.order_id, q.vendor_id`,
            [BOOKABLE_ORDER_STATUSES]
        );
        for (const quote of ineligibleQuotes.rows)
            await notifyCustomerOfLabelIssue(
                client,
                quote.order_id,
                quote.vendor_id,
                'failed'
            );
        const { rows } = await client.query(
            `WITH ready AS (
                SELECT q.id
                FROM shipbubble_rate_quotes q
                JOIN orders o ON o.id = q.order_id
                WHERE q.booking_status = 'pending'
                  AND (q.processing_until IS NULL OR q.processing_until <= NOW())
                  AND o.payment_status = 'paid'
                  AND o.status = ANY($1::text[])
                ORDER BY q.created_at, q.id
                FOR UPDATE OF q SKIP LOCKED
                LIMIT 10
             )
             UPDATE shipbubble_rate_quotes q
             SET booking_status = 'processing', booking_attempts = booking_attempts + 1,
                 processing_until = NOW() + INTERVAL '2 minutes', booking_error = NULL
             FROM ready WHERE q.id = ready.id
            RETURNING q.*`,
            [BOOKABLE_ORDER_STATUSES]
        );
        return rows;
    });
}

async function persistLabel(quote, details) {
    if (typeof details.orderId !== 'string' && typeof details.orderId !== 'number')
        throw new Error('ShipBubble label response did not include an order ID');

    await transaction(pool, async (client) => {
        const { rows: orderRows } = await client.query(
            'SELECT * FROM orders WHERE id = $1 FOR UPDATE',
            [quote.order_id]
        );
        const order = orderRows[0];
        if (!isOrderEligible(order)) {
            const bookingError =
                `ShipBubble created label ${details.orderId}, but the order became ineligible before it could be saved`;
            const { rows: changedQuotes } = await client.query(
                `UPDATE shipbubble_rate_quotes
                 SET booking_status = 'needs_review', processing_until = NULL,
                     booking_error = $2
                 WHERE id = $1 AND booking_status = 'processing'
                 RETURNING order_id, vendor_id`,
                [quote.id, bookingError]
            );
            if (changedQuotes[0])
                await notifyCustomerOfLabelIssue(
                    client,
                    changedQuotes[0].order_id,
                    changedQuotes[0].vendor_id,
                    'needs_review'
                );
            return;
        }

        const existing = await client.query(
            `SELECT id FROM shipments
             WHERE order_id = $1 AND vendor_id = $2
               AND shipping_group_key IS NOT DISTINCT FROM $3
             FOR UPDATE`,
            [quote.order_id, quote.vendor_id, quote.package_group_key]
        );
        let shipment;
        if (existing.rows[0]) {
            const { rows } = await client.query(
                `UPDATE shipments SET shipbubble_order_id = $1, tracking_number = $2,
                    tracking_url = $3, waybill_document = $4, carrier = $5,
                    shipping_method = $6, shipping_cost = $7, status = $8,
                    shipbubble_category_id = $9, updated_at = NOW() WHERE id = $10 RETURNING *`,
                [
                    String(details.orderId), details.trackingNumber, details.trackingUrl,
                    details.waybillDocument, details.carrier ?? quote.courier_name,
                    quote.service_code, quote.amount, details.status,
                    quote.quote_data?.category_id ?? null, existing.rows[0].id,
                ]
            );
            shipment = rows[0];
        } else {
            const { rows: shipmentRows } = await client.query(
                `INSERT INTO shipments
                    (order_id, vendor_id, shipping_group_key, shipbubble_category_id,
                     shipbubble_order_id, tracking_number,
                     tracking_url, waybill_document, carrier, shipping_method,
                     shipping_cost, status)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                 RETURNING *`,
                [
                    quote.order_id, quote.vendor_id, quote.package_group_key,
                    quote.quote_data?.category_id ?? null, String(details.orderId),
                    details.trackingNumber, details.trackingUrl, details.waybillDocument,
                    details.carrier ?? quote.courier_name, quote.service_code, quote.amount,
                    details.status,
                ]
            );
            await client.query(
                `INSERT INTO shipment_tracking_history
                    (shipment_id, status, description)
                 VALUES ($1, $2, 'Label booked with ShipBubble')`,
                [shipmentRows[0].id, details.status]
            );
            shipment = shipmentRows[0];
        }
        await syncOrderFulfillment(client, order);
        await client.query(
            `UPDATE shipbubble_rate_quotes
             SET booking_status = 'completed', booked_at = NOW(),
                 processing_until = NULL, booking_error = NULL
             WHERE id = $1`,
            [quote.id]
        );
        await Notification.notifyShipmentLabelBooked(
            order.id,
            order.user_id,
            shipment,
            client
        );
    });
}

export function startShipbubbleLabelWorker({ intervalMs = 5000 } = {}) {
    let running = false;
    let lastQuoteCleanupAt = 0;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            const now = Date.now();
            if (now - lastQuoteCleanupAt >= 60 * 60 * 1000) {
                try {
                    const cleanup = await pool.query(
                        `DELETE FROM shipbubble_rate_quotes
                         WHERE order_id IS NULL AND expires_at <= NOW()`
                    );
                    lastQuoteCleanupAt = now;
                    if (cleanup.rowCount)
                        console.info(
                            'Expired ShipBubble rate quotes removed:',
                            cleanup.rowCount
                        );
                } catch (error) {
                    console.error(
                        'Expired ShipBubble rate quote cleanup failed:',
                        error.message
                    );
                }
            }

            const keyName = process.env.NODE_ENV === 'production'
                ? 'SHIPBUBBLE_LIVE_KEY'
                : 'SHIPBUBBLE_TEST_KEY';
            if (!process.env[keyName]?.trim()) return;

            const quotes = await claimQuotes();
            for (const quote of quotes) {
                try {
                    const { rows: orderRows } = await pool.query(
                        'SELECT status, payment_status FROM orders WHERE id = $1',
                        [quote.order_id]
                    );
                    if (!isOrderEligible(orderRows[0])) {
                        await markBookingIssue(
                            quote.id,
                            'failed',
                            'Order is no longer eligible for ShipBubble label booking'
                        );
                        continue;
                    }
                    const result = await Shipbubble.createLabel({
                        request_token: quote.request_token,
                        service_code: quote.service_code,
                        courier_id: quote.courier_id,
                    });
                    await persistLabel(quote, providerData(result));
                } catch (error) {
                    const review = error.status === 502 || /did not include an order ID/i.test(error.message);
                    // Shipbubble documents 429 as a rate-limit response. Retry
                    // those rejected requests with a short backoff; do not retry
                    // ambiguous network/server outcomes that may have booked.
                    const retry = error.status === 429 && quote.booking_attempts < 5;
                    const state = review ? 'needs_review' : retry ? 'pending' : 'failed';
                    if (retry) {
                        await pool.query(
                            `UPDATE shipbubble_rate_quotes
                             SET booking_status = 'pending',
                                 processing_until = NOW() + INTERVAL '30 seconds',
                                 booking_error = $2
                             WHERE id = $1 AND booking_status = 'processing'`,
                            [quote.id, String(error.message).slice(0, 500)]
                        );
                    } else {
                        await markBookingIssue(
                            quote.id,
                            state,
                            String(error.message).slice(0, 500)
                        );
                    }
                    console.error(
                        'ShipBubble label booking failed:', quote.id, state, error.message
                    );
                }
            }
        } catch (error) {
            console.error('ShipBubble label worker failed:', error.message);
        } finally {
            running = false;
        }
    };
    const timer = setInterval(run, intervalMs);
    timer.unref();
    void run();
    return () => clearInterval(timer);
}
