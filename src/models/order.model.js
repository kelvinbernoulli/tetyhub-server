import { CheckoutError, transaction } from '#utils/checkout.js';
import { releaseReservation } from '#services/checkout.service.js';
import pool from '#services/pg_pool.js';
import Notification from '#models/notification.model.js';
import { aggregateFulfillmentStatus } from '#services/order-fulfillment.js';

const ORDER_SORT_COLUMNS = {
    created_at: 'o.created_at',
    updated_at: 'o.updated_at',
    total: 'o.total',
    order_number: 'o.order_number',
};

const appendOrderFilters = (whereClauses, values, filters = {}, { vendorScope = false, fulfillmentJoin = false } = {}) => {
    let index = values.length + 1;
    const add = (clause, value) => {
        whereClauses.push(clause.replace('?', `$${index++}`));
        values.push(value);
    };

    if (filters.order_status) add('o.status = ?', filters.order_status);
    if (filters.payment_status) add('o.payment_status = ?', filters.payment_status);
    if (filters.fulfillment_status) {
        if (fulfillmentJoin) add('vof.status = ?', filters.fulfillment_status);
        else add('EXISTS (SELECT 1 FROM vendor_order_fulfillments filter_vof WHERE filter_vof.order_id = o.id AND filter_vof.status = ?)', filters.fulfillment_status);
    }
    if (filters.from) add('o.created_at >= ?', filters.from);
    if (filters.to) add('o.created_at <= ?', filters.to);
    if (filters.q) add('o.order_number ILIKE ?', `%${filters.q}%`);
    if (filters.vendor_id && !vendorScope) {
        add('EXISTS (SELECT 1 FROM order_items filter_oi WHERE filter_oi.order_id = o.id AND filter_oi.vendor_id = ?)', filters.vendor_id);
    }

    return index;
};

const listOrderFilters = (filters = {}) => ({
    ...filters,
    order_status: filters.order_status ?? filters.status,
});

async function availableVendorBalance(client, vendorId, currencyId) {
    const { rows: [ledger] } = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::numeric AS balance
         FROM ledger_entries WHERE vendor_id = $1 AND currency_id = $2`,
        [vendorId, currencyId]
    );
    const { rows: [reserved] } = await client.query(
        `SELECT COALESCE(SUM(amount), 0)::numeric AS amount
         FROM vendor_payouts
         WHERE vendor_id = $1 AND currency_id = $2 AND status IN ('pending', 'processing')`,
        [vendorId, currencyId]
    );
    return Math.max(
        0,
        Math.round((Number(ledger.balance) - Number(reserved.amount)) * 100) / 100
    );
}

async function releasePayoutHold(client, fulfillmentId, metadata = {}) {
    await client.query(
        `INSERT INTO vendor_ledger_entries
         (vendor_id, order_id, fulfillment_id, currency_id, entry_type, amount_minor, idempotency_key, metadata)
         SELECT vendor_id, order_id, fulfillment_id, currency_id, 'payout_hold_release', -amount_minor,
                'delivery:' || fulfillment_id || ':payout-hold-release', $2::jsonb
         FROM vendor_ledger_entries
         WHERE fulfillment_id = $1 AND entry_type = 'payout_hold' AND amount_minor < 0
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [fulfillmentId, JSON.stringify(metadata)]
    );
}

class Order {
    static async getOrderById(orderId, userId = null, vendorId = null, options = {}) {
        try {
            const include = new Set(options.include ?? ['items', 'shipping_address', 'fulfillments']);
            let paramIndex = 2;
            const whereClauses = [`o.id = $1`];
            const values = [orderId];

            if (userId) {
                whereClauses.push(`o.user_id = $${paramIndex++}`);
                values.push(userId);
            }

            if (vendorId) {
                whereClauses.push(`oi.vendor_id = $${paramIndex++}`);
                values.push(vendorId);
            }
            const vendorStatusSelect = vendorId && include.has('fulfillments')
                ? `vof.status AS vendor_fulfillment_status,
                vof.gross_amount AS vendor_gross_amount,
                vof.commission_rate AS vendor_commission_rate,
                vof.commission_amount AS vendor_commission_amount,
                vof.net_amount AS vendor_net_amount,
                vof.payout_status AS vendor_payout_status,
                (SELECT json_agg(json_build_object(
                    'status', vofh.status,
                    'note', vofh.note,
                    'changed_by', vofh.changed_by,
                    'created_at', vofh.created_at
                ) ORDER BY vofh.created_at, vofh.id)
                FROM vendor_order_fulfillment_history vofh
                WHERE vofh.fulfillment_id = vof.id) AS vendor_fulfillment_history`
                : vendorId
                  ? `NULL AS vendor_fulfillment_status, NULL AS vendor_gross_amount,
                     NULL AS vendor_commission_rate, NULL AS vendor_commission_amount,
                     NULL AS vendor_net_amount, NULL AS vendor_payout_status,
                     NULL::json AS vendor_fulfillment_history`
                  : include.has('fulfillments')
                    ? `(SELECT json_agg(json_build_object(
                    'vendor_id', vof.vendor_id,
                    'status', vof.status,
                    'items', (SELECT json_agg(jsonb_build_object(
                        'id', foi.id,
                        'product_id', foi.product_id,
                        'product_name', fp.name,
                        'thumbnail', fp.thumbnail,
                        'variant_id', foi.variant_id,
                        'quantity', foi.quantity,
                        'price', foi.price,
                        'subtotal', foi.subtotal
                    ) ORDER BY foi.id)
                    FROM order_items foi
                    JOIN products fp ON fp.id = foi.product_id
                    WHERE foi.order_id = vof.order_id AND foi.vendor_id = vof.vendor_id)
                    ,'status_history', (SELECT json_agg(json_build_object(
                        'status', vofh.status,
                        'note', vofh.note,
                        'changed_by', vofh.changed_by,
                        'created_at', vofh.created_at
                    ) ORDER BY vofh.created_at, vofh.id)
                    FROM vendor_order_fulfillment_history vofh
                    WHERE vofh.fulfillment_id = vof.id)
                ) ORDER BY vof.vendor_id)
                FROM vendor_order_fulfillments vof WHERE vof.order_id = o.id)
                AS vendor_fulfillments`
                    : 'NULL::json AS vendor_fulfillments';
            const { rows } = await pool.query(
                `SELECT
                o.*,
                ${vendorStatusSelect},
                ${include.has('items') ? `json_agg(DISTINCT jsonb_build_object(
                    'id', oi.id,
                    'product_id', oi.product_id,
                    'product_name', p.name,
                    'thumbnail', p.thumbnail,
                    'variant_id', oi.variant_id,
                    'quantity', oi.quantity,
                    'price', oi.price,
                    'subtotal', oi.subtotal
                ))` : 'NULL::json'} AS items,
                ${include.has('shipping_address') ? `jsonb_build_object(
                    'firstname', oa.firstname,
                    'lastname', oa.lastname,
                    'phone', oa.phone_one,
                    'address', oa.address,
                    'city', oa.city,
                    'state', oa.state,
                    'country', oa.country,
                    'zip_code', oa.zip_code
                )` : 'NULL::jsonb'} AS shipping_address
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            JOIN products p ON p.id = oi.product_id
            ${vendorId ? 'JOIN vendor_order_fulfillments vof ON vof.order_id = o.id AND vof.vendor_id = oi.vendor_id' : ''}
            LEFT JOIN shipping_addresses oa ON oa.order_id = o.id
            WHERE ${whereClauses.join(' AND ')}
            GROUP BY o.id, oa.id${vendorId ? ', vof.id, vof.status' : ''}`,
                values
            );

            return rows[0] ?? null;
        } catch (error) {
            console.error('Error fetching order:', error);
            throw error;
        }
    }

    static async fetchVendorOrders(
        vendorId,
        { offset = 0, limit = 20, sort_by = 'created_at', sort_order = 'desc', ...rawFilters } = {}
    ) {
        try {
            const filters = {
                ...rawFilters,
                fulfillment_status: rawFilters.fulfillment_status ?? rawFilters.status,
            };
            delete filters.status;
            const whereClauses = ['vof.vendor_id = $1', 'oi.vendor_id = $1'];
            const values = [vendorId];
            const nextIndex = appendOrderFilters(whereClauses, values, filters, { vendorScope: true, fulfillmentJoin: true });
            const countResult = await pool.query(
                `SELECT COUNT(DISTINCT o.id)::int AS total
                 FROM orders o
                 JOIN order_items oi ON oi.order_id = o.id
                 JOIN vendor_order_fulfillments vof ON vof.order_id = o.id AND vof.vendor_id = oi.vendor_id
                 WHERE ${whereClauses.join(' AND ')}`,
                values
            );

            const query = `
                SELECT
                    o.*,
                    vof.status AS vendor_fulfillment_status,
                    vof.gross_amount AS vendor_gross_amount,
                    vof.commission_rate AS vendor_commission_rate,
                    vof.commission_amount AS vendor_commission_amount,
                    vof.net_amount AS vendor_net_amount,
                    vof.payout_status AS vendor_payout_status,
                    (SELECT json_agg(json_build_object(
                        'status', vofh.status,
                        'note', vofh.note,
                        'changed_by', vofh.changed_by,
                        'created_at', vofh.created_at
                    ) ORDER BY vofh.created_at, vofh.id)
                    FROM vendor_order_fulfillment_history vofh
                    WHERE vofh.fulfillment_id = vof.id) AS vendor_fulfillment_history,
                    u.firstname, u.lastname, u.email,
                    COUNT(oi.id) AS item_count,
                    json_agg(DISTINCT jsonb_build_object(
                        'id', oi.id,
                        'product_id', oi.product_id,
                        'product_name', p.name,
                        'thumbnail', p.thumbnail,
                        'variant_id', oi.variant_id,
                        'quantity', oi.quantity,
                        'price', oi.price,
                        'subtotal', oi.subtotal
                    )) AS items,
                    jsonb_build_object(
                        'firstname', oa.firstname,
                        'lastname', oa.lastname,
                        'phone', oa.phone_one,
                        'address', oa.address,
                        'city', oa.city,
                        'state', oa.state,
                        'country', oa.country,
                        'zip_code', oa.zip_code
                    ) AS shipping_address
                FROM orders o
                JOIN users u ON u.id = o.user_id
                JOIN order_items oi ON oi.order_id = o.id
                JOIN vendor_order_fulfillments vof
                    ON vof.order_id = o.id AND vof.vendor_id = oi.vendor_id
                JOIN products p ON p.id = oi.product_id
                LEFT JOIN shipping_addresses oa ON oa.order_id = o.id
                WHERE ${whereClauses.join(' AND ')}
                GROUP BY o.id, u.id, oa.id, vof.id
                ORDER BY ${ORDER_SORT_COLUMNS[sort_by] ?? ORDER_SORT_COLUMNS.created_at} ${String(sort_order).toLowerCase() === 'asc' ? 'ASC' : 'DESC'}, o.id DESC
                LIMIT $${nextIndex} OFFSET $${nextIndex + 1}
            `;

            values.push(limit, offset);
            const { rows } = await pool.query(query, values);
            return { orders: rows, total: countResult.rows[0]?.total ?? 0 };
        } catch (error) {
            console.error('Error fetching vendor orders:', error);
            throw error;
        }
    }

    // ─── FETCH ALL ORDERS (customer) ──────────────────
    static async fetchCustomerOrders(
        userId,
        vendorIdOrFilters,
        maybeFilters
    ) {
        try {
            // Keep the former (userId, vendorId, filters) call shape for the
            // vendor-side customer-orders endpoint; vendorId is never used to
            // determine customer access.
            const rawFilters = maybeFilters ?? vendorIdOrFilters ?? {};
            const { offset = 0, limit = 20, sort_by = 'created_at', sort_order = 'desc' } = rawFilters;
            const filters = listOrderFilters(rawFilters);
            const whereClauses = ['o.user_id = $1'];
            const values = [userId];
            const nextIndex = appendOrderFilters(whereClauses, values, filters);
            const countResult = await pool.query(
                `SELECT COUNT(*)::int AS total FROM orders o WHERE ${whereClauses.join(' AND ')}`,
                values
            );

            const query = `
                SELECT
                    o.*,
                    (SELECT json_agg(json_build_object(
                        'vendor_id', vof.vendor_id,
                        'status', vof.status,
                        'items', (SELECT json_agg(jsonb_build_object(
                            'id', foi.id,
                            'product_id', foi.product_id,
                            'product_name', fp.name,
                            'thumbnail', fp.thumbnail,
                            'variant_id', foi.variant_id,
                            'quantity', foi.quantity,
                            'price', foi.price,
                            'subtotal', foi.subtotal
                        ) ORDER BY foi.id)
                        FROM order_items foi
                        JOIN products fp ON fp.id = foi.product_id
                        WHERE foi.order_id = vof.order_id AND foi.vendor_id = vof.vendor_id)
                        ,'status_history', (SELECT json_agg(json_build_object(
                            'status', vofh.status,
                            'note', vofh.note,
                            'changed_by', vofh.changed_by,
                            'created_at', vofh.created_at
                        ) ORDER BY vofh.created_at, vofh.id)
                        FROM vendor_order_fulfillment_history vofh
                        WHERE vofh.fulfillment_id = vof.id)
                    ) ORDER BY vof.vendor_id)
                    FROM vendor_order_fulfillments vof WHERE vof.order_id = o.id)
                    AS vendor_fulfillments,
                    json_agg(DISTINCT jsonb_build_object(
                        'id', oi.id,
                        'product_id', oi.product_id,
                        'product_name', p.name,
                        'thumbnail', p.thumbnail,
                        'variant_id', oi.variant_id,
                        'quantity', oi.quantity,
                        'price', oi.price,
                        'subtotal', oi.subtotal
                    )) AS items,
                    jsonb_build_object(
                        'firstname', oa.firstname,
                        'lastname', oa.lastname,
                        'phone', oa.phone_one,
                        'address', oa.address,
                        'city', oa.city,
                        'state', oa.state,
                        'country', oa.country,
                        'zip_code', oa.zip_code
                    ) AS shipping_address
                FROM orders o
                JOIN order_items oi ON oi.order_id = o.id
                JOIN products p ON p.id = oi.product_id
                LEFT JOIN shipping_addresses oa ON oa.order_id = o.id
                WHERE ${whereClauses.join(' AND ')}
                GROUP BY o.id, oa.id
                ORDER BY ${ORDER_SORT_COLUMNS[sort_by] ?? ORDER_SORT_COLUMNS.created_at} ${String(sort_order).toLowerCase() === 'asc' ? 'ASC' : 'DESC'}, o.id DESC
                LIMIT $${nextIndex} OFFSET $${nextIndex + 1}
            `;

            values.push(limit, offset);
            const { rows } = await pool.query(query, values);
            return { orders: rows, total: countResult.rows[0]?.total ?? 0 };
        } catch (error) {
            console.error('Error fetching customer orders:', error);
            throw error;
        }
    }

    static async fetchAllOrders({ offset = 0, limit = 20, sort_by = 'created_at', sort_order = 'desc', ...rawFilters } = {}) {
        try {
            const filters = listOrderFilters(rawFilters);
            const whereClauses = ['TRUE'];
            const values = [];
            const nextIndex = appendOrderFilters(whereClauses, values, filters);
            const countResult = await pool.query(
                `SELECT COUNT(DISTINCT o.id)::int AS total FROM orders o WHERE ${whereClauses.join(' AND ')}`,
                values
            );
            const { rows } = await pool.query(
                `SELECT o.*,
                    u.firstname AS customer_firstname,
                    u.lastname AS customer_lastname,
                    u.email AS customer_email,
                    (SELECT json_agg(jsonb_build_object(
                        'id', oi.id, 'vendor_id', oi.vendor_id, 'product_id', oi.product_id,
                        'product_name', p.name, 'thumbnail', p.thumbnail,
                        'variant_id', oi.variant_id, 'quantity', oi.quantity,
                        'price', oi.price, 'subtotal', oi.subtotal
                    ) ORDER BY oi.id)
                     FROM order_items oi JOIN products p ON p.id = oi.product_id
                     WHERE oi.order_id = o.id) AS items,
                    (SELECT json_agg(jsonb_build_object(
                        'vendor_id', vof.vendor_id, 'status', vof.status,
                        'gross_amount', vof.gross_amount, 'commission_amount', vof.commission_amount,
                        'net_amount', vof.net_amount, 'payout_status', vof.payout_status
                    ) ORDER BY vof.vendor_id)
                     FROM vendor_order_fulfillments vof WHERE vof.order_id = o.id) AS vendor_fulfillments,
                    jsonb_build_object(
                        'firstname', oa.firstname, 'lastname', oa.lastname,
                        'phone', oa.phone_one, 'address', oa.address, 'city', oa.city,
                        'state', oa.state, 'country', oa.country, 'zip_code', oa.zip_code
                    ) AS shipping_address
                 FROM orders o
                 JOIN users u ON u.id = o.user_id
                 LEFT JOIN shipping_addresses oa ON oa.order_id = o.id
                 WHERE ${whereClauses.join(' AND ')}
                 ORDER BY ${ORDER_SORT_COLUMNS[sort_by] ?? ORDER_SORT_COLUMNS.created_at} ${String(sort_order).toLowerCase() === 'asc' ? 'ASC' : 'DESC'}, o.id DESC
                 LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`,
                [...values, limit, offset]
            );
            return { orders: rows, total: countResult.rows[0]?.total ?? 0 };
        } catch (error) {
            console.error('Error fetching all orders:', error);
            throw error;
        }
    }

    // ─── UPDATE ORDER STATUS (vendor) ─────────────────
    static async updateOrderStatus(
        orderId,
        vendorId,
        changedBy,
        { status, note }
    ) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Fetch order
            const { rows: orderRows } = await client.query(
                `SELECT o.*, vof.status AS vendor_fulfillment_status
                 FROM orders o
                 JOIN vendor_order_fulfillments vof ON vof.order_id = o.id AND vof.vendor_id = $2
                 WHERE o.id = $1
                 AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = o.id AND oi.vendor_id = $2)
                 FOR UPDATE OF o, vof`,
                [orderId, vendorId]
            );

            if (orderRows.length === 0) {
                await client.query('ROLLBACK');
                return { error: 'Order not found', code: 404 };
            }

            const order = orderRows[0];
            if (
                order.payment_status !== 'paid' ||
                ['cancelled', 'refunded', 'payment_review'].includes(order.status)
            ) {
                await client.query('ROLLBACK');
                return {
                    error: 'This order cannot be fulfilled',
                    code: 409,
                };
            }

            // 2. Validate status transition
            const validTransitions = {
                pending: ['processing', 'cancelled'],
                processing: ['awaiting_shipment', 'cancelled'],
                awaiting_shipment: ['packed', 'cancelled'],
                packed: ['shipped', 'cancelled'],
                shipped: ['out_for_delivery', 'delivered', 'returned'],
                out_for_delivery: ['delivered', 'returned'],
                delivered: ['returned'],
                cancelled: [],
                returned: ['refunded'],
                refunded: [],
            };

            const previousFulfillmentStatus = order.vendor_fulfillment_status;
            if (!validTransitions[previousFulfillmentStatus]?.includes(status)) {
                await client.query('ROLLBACK');
                return {
                    error: `Cannot transition order from ${previousFulfillmentStatus} to ${status}`,
                    code: 422,
                };
            }

            await client.query(
                `UPDATE vendor_order_fulfillments
                 SET status = $1, updated_at = NOW()
                 WHERE order_id = $2 AND vendor_id = $3`,
                [status, orderId, vendorId]
            );
            await client.query(
                `INSERT INTO vendor_order_fulfillment_history
                 (fulfillment_id, status, note, changed_by)
                 SELECT id, $1, $2, $3 FROM vendor_order_fulfillments
                 WHERE order_id = $4 AND vendor_id = $5`,
                [status, note ?? null, changedBy, orderId, vendorId]
            );
            const { rows: fulfillmentRows } = await client.query(
                'SELECT status FROM vendor_order_fulfillments WHERE order_id = $1 ORDER BY vendor_id',
                [orderId]
            );
            const aggregateStatus = aggregateFulfillmentStatus(
                fulfillmentRows.map((row) => row.status),
                order.status
            );
            const parentStatusChanged = aggregateStatus !== order.status;
            let updatedOrder = order;
            if (parentStatusChanged) {
                const { rows } = await client.query(
                    'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
                    [aggregateStatus, orderId]
                );
                updatedOrder = rows[0];

                await client.query(
                    `INSERT INTO order_status_history (order_id, status, note, changed_by)
                    VALUES ($1, $2, $3, $4)`,
                    [orderId, aggregateStatus, note ?? null, changedBy]
                );
                await Notification.notifyOrderStatusChange(
                    orderId,
                    order.user_id,
                    order.status,
                    aggregateStatus,
                    client
                );
            }

            await Notification.createNotification(
                order.user_id,
                'order_fulfillment',
                'Vendor order updated',
                `A vendor updated their items in order #${order.order_number} to ${status.replaceAll('_', ' ')}.`,
                { order_id: orderId, vendor_id: vendorId, status },
                client
            );

            await client.query('COMMIT');
            return {
                ...updatedOrder,
                vendor_id: vendorId,
                vendor_fulfillment_status: status,
                order_status_changed: parentStatusChanged,
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error updating order status:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // ─── CANCEL ORDER (customer) ───────────────────────
    static async cancelOrder(orderId, userId, { reason }) {
        try {
            return await transaction(pool, async (client) => {
                const order = (
                    await client.query(
                        'SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE',
                        [orderId, userId]
                    )
                ).rows[0];
                if (!order) throw new CheckoutError('Order not found', 404);
                if (order.status === 'cancelled') return order;
                if (
                    order.status !== 'pending' ||
                    order.payment_status !== 'unpaid'
                )
                    throw new CheckoutError(
                        'Only unpaid pending orders can be cancelled',
                        409
                    );
                await releaseReservation(client, order, reason);
                return { ...order, status: 'cancelled' };
            });
        } catch (error) {
            if (error instanceof CheckoutError)
                return { error: error.message, code: error.code };
            throw error;
        }
    }

    static async autoConfirmDeliveredFulfillments({ gracePeriodDays = 7, batchSize = 100 } = {}) {
        return transaction(pool, async (client) => {
            const { rows: fulfillments } = await client.query(
                `SELECT vof.id, vof.order_id, vof.vendor_id, vof.net_amount,
                        o.currency_id, delivery.delivered_at,
                        COALESCE((
                            SELECT SUM(r.vendor_reserve_amount)
                            FROM returns r
                            WHERE r.order_id = vof.order_id
                              AND r.vendor_id = vof.vendor_id
                              AND r.status NOT IN ('rejected', 'cancelled')
                        ), 0)::numeric AS reserved_amount,
                        COALESCE((
                            SELECT SUM(p.amount) FROM vendor_payouts p
                            WHERE p.fulfillment_id = vof.id
                              AND p.status IN ('pending', 'processing', 'paid')
                        ), 0)::numeric AS paid_or_due_amount,
                        (SELECT COUNT(*)::int FROM vendor_payouts p
                         WHERE p.fulfillment_id = vof.id) AS payout_count
                 FROM vendor_order_fulfillments vof
                 JOIN orders o ON o.id = vof.order_id
                 JOIN LATERAL (
                    SELECT MAX(COALESCE(s.actual_delivery, s.updated_at)) AS delivered_at
                    FROM shipments s
                    WHERE s.order_id = vof.order_id
                      AND s.vendor_id = vof.vendor_id
                      AND s.status = 'delivered'
                 ) delivery ON delivery.delivered_at IS NOT NULL
                 WHERE vof.payout_status IN ('held', 'disputed', 'eligible')
                   AND vof.status = 'delivered'
                   AND o.payment_status = 'paid'
                   AND (
                       vof.payout_status = 'eligible' OR
                       delivery.delivered_at <= NOW() - ($1::int * INTERVAL '1 day')
                   )
                   AND vof.net_amount > COALESCE((
                       SELECT SUM(r.vendor_reserve_amount)
                       FROM returns r
                       WHERE r.order_id = vof.order_id
                         AND r.vendor_id = vof.vendor_id
                         AND r.status NOT IN ('rejected', 'cancelled')
                   ), 0)
                 ORDER BY delivery.delivered_at, vof.id
                 LIMIT $2
                 FOR UPDATE OF vof SKIP LOCKED`,
                [gracePeriodDays, batchSize]
            );

            for (const fulfillment of fulfillments) {
                await client.query('SELECT id FROM vendors WHERE id = $1 FOR UPDATE', [fulfillment.vendor_id]);
                const fulfillmentRemaining = Math.max(
                    0,
                    Math.round((Number(fulfillment.net_amount) - Number(fulfillment.reserved_amount) - Number(fulfillment.paid_or_due_amount)) * 100) / 100
                );
                const payableAmount = Math.min(
                    fulfillmentRemaining,
                    await availableVendorBalance(client, fulfillment.vendor_id, fulfillment.currency_id)
                );
                if (payableAmount <= 0) continue;
                const { rows: updated } = await client.query(
                    `UPDATE vendor_order_fulfillments
                     SET payout_status = 'eligible', updated_at = NOW()
                     WHERE id = $1 AND payout_status IN ('held', 'disputed')
                     RETURNING id`,
                    [fulfillment.id]
                );
                if (!updated.length) continue;

                const baseReference = `payout:${fulfillment.order_id}:${fulfillment.vendor_id}:${fulfillment.id}`;
                const reference = Number(fulfillment.payout_count) === 0
                    ? baseReference
                    : `${baseReference}:cycle:${Number(fulfillment.payout_count) + 1}`;
                const metadata = {
                    source: 'automatic_delivery_confirmation',
                    delivered_at: fulfillment.delivered_at,
                    grace_period_days: gracePeriodDays,
                    reserved_amount: Number(fulfillment.reserved_amount),
                };
                await client.query(
                    `INSERT INTO vendor_payouts
                     (vendor_id, order_id, fulfillment_id, currency_id, amount, status, payout_method,
                      reference, metadata)
                     VALUES ($1, $2, $3, $4, $5, 'pending', 'bank_transfer', $6, $7)
                     ON CONFLICT (reference) DO NOTHING`,
                    [
                        fulfillment.vendor_id,
                        fulfillment.order_id,
                        fulfillment.id,
                        fulfillment.currency_id,
                        payableAmount,
                        reference,
                        JSON.stringify(metadata),
                    ]
                );
                await client.query(
                    `INSERT INTO ledger_entries
                     (vendor_id, order_id, fulfillment_id, entry_type, amount, currency_id,
                      idempotency_key, metadata)
                     VALUES ($1, $2, $3, 'payout_eligible', 0, $4, $5, $6)
                     ON CONFLICT (idempotency_key) DO NOTHING`,
                    [
                        fulfillment.vendor_id,
                        fulfillment.order_id,
                        fulfillment.id,
                        fulfillment.currency_id,
                        `product:${fulfillment.order_id}:${fulfillment.vendor_id}:payout-eligible`,
                        JSON.stringify(metadata),
                    ]
                );
                await releasePayoutHold(client, fulfillment.id, { source: 'automatic_delivery_confirmation' });
            }
            return fulfillments.length;
        });
    }

    static async confirmVendorDelivery(orderId, userId, vendorId) {
        return transaction(pool, async (client) => {
            const order = (
                await client.query(
                    'SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE',
                    [orderId, userId]
                )
            ).rows[0];
            if (!order) throw new CheckoutError('Order not found', 404);
            const fulfillment = (
                await client.query(
                    `SELECT * FROM vendor_order_fulfillments
                     WHERE order_id = $1 AND vendor_id = $2 FOR UPDATE`,
                    [orderId, vendorId]
                )
            ).rows[0];
            if (!fulfillment)
                throw new CheckoutError('Vendor fulfillment not found', 404);
            if (fulfillment.payout_status === 'eligible')
                return { order_id: orderId, vendor_id: vendorId, payout_status: 'eligible' };
            if (
                order.payment_status !== 'paid' ||
                fulfillment.status !== 'delivered'
            )
                throw new CheckoutError(
                    'Confirm delivery only after the vendor shipment is delivered',
                    409
                );
            const shipment = (
                await client.query(
                    `SELECT id FROM shipments
                     WHERE order_id = $1 AND vendor_id = $2 AND status = 'delivered'`,
                    [orderId, vendorId]
                )
            ).rows[0];
            if (!shipment)
                throw new CheckoutError(
                    'Vendor shipment is not marked delivered',
                    409
                );
            const reserve = (
                await client.query(
                    `SELECT COALESCE(SUM(vendor_reserve_amount), 0)::numeric AS amount
                     FROM returns WHERE order_id = $1 AND vendor_id = $2
                       AND status NOT IN ('rejected', 'cancelled')`,
                    [orderId, vendorId]
                )
            ).rows[0];
            await client.query('SELECT id FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
            const { rows: [existingPayouts] } = await client.query(
                `SELECT COALESCE(SUM(amount) FILTER (
                            WHERE status IN ('pending', 'processing', 'paid')
                        ), 0)::numeric AS paid_or_due_amount,
                        COUNT(*)::int AS payout_count
                 FROM vendor_payouts WHERE fulfillment_id = $1`,
                [fulfillment.id]
            );
            const fulfillmentRemaining = Math.max(
                0,
                Math.round((Number(fulfillment.net_amount) - Number(reserve.amount) - Number(existingPayouts.paid_or_due_amount)) * 100) / 100
            );
            const payoutAmount = Math.min(
                fulfillmentRemaining,
                await availableVendorBalance(client, vendorId, order.currency_id)
            );
            await client.query(
                `UPDATE vendor_order_fulfillments
                 SET payout_status = $2, updated_at = NOW()
                 WHERE id = $1`,
                [fulfillment.id, payoutAmount > 0 ? 'eligible' : 'held']
            );
            if (payoutAmount > 0) await client.query(
                `INSERT INTO vendor_payouts
                 (vendor_id, order_id, fulfillment_id, currency_id, amount, status, payout_method,
                  reference, metadata)
                 VALUES ($1, $2, $3, $4, $5, 'pending', 'bank_transfer', $6, $7)
                 ON CONFLICT (reference) DO NOTHING`,
                [
                    vendorId,
                    orderId,
                    fulfillment.id,
                    order.currency_id,
                    payoutAmount,
                    Number(existingPayouts.payout_count) === 0
                        ? `payout:${orderId}:${vendorId}:${fulfillment.id}`
                        : `payout:${orderId}:${vendorId}:${fulfillment.id}:cycle:${Number(existingPayouts.payout_count) + 1}`,
                    JSON.stringify({
                        confirmed_by: userId,
                        source: 'delivery_confirmation',
                        reserved_amount: Number(reserve.amount),
                    }),
                ]
            );
            await client.query(
                `INSERT INTO ledger_entries
                 (vendor_id, order_id, fulfillment_id, entry_type, amount, currency_id,
                  idempotency_key, metadata)
                 VALUES ($1, $2, $3, 'payout_eligible', 0, $4, $5, $6)
                 ON CONFLICT (idempotency_key) DO NOTHING`,
                [
                    vendorId,
                    orderId,
                    fulfillment.id,
                    order.currency_id,
                    `product:${orderId}:${vendorId}:payout-eligible`,
                    JSON.stringify({ confirmed_by: userId }),
                ]
            );
            if (payoutAmount > 0) await releasePayoutHold(client, fulfillment.id, { source: 'delivery_confirmation', confirmed_by: userId });
            return {
                order_id: orderId,
                vendor_id: vendorId,
                payout_status: payoutAmount > 0 ? 'eligible' : 'held',
                payout_amount: payoutAmount,
                reserved_amount: Number(reserve.amount),
            };
        });
    }

    static async fetchOrderHistory(orderId, userId = null, vendorId = null) {
        if (!userId && !vendorId) return [];
        try {
            const { rows } = await pool.query(
                `SELECT
                    osh.*,
                    u.firstname, u.lastname
                FROM order_status_history osh
                LEFT JOIN users u ON u.id = osh.changed_by
                WHERE osh.order_id = $1
                ${userId ? 'AND EXISTS (SELECT 1 FROM orders o WHERE o.id = osh.order_id AND o.user_id = $2)' : 'AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = osh.order_id AND oi.vendor_id = $2)'}
                ORDER BY osh.created_at ASC, osh.id ASC`,
                [orderId, userId || vendorId]
            );
            return rows;
        } catch (error) {
            console.error('Error fetching order history:', error);
            throw error;
        }
    }
}

export default Order;
