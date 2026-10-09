import { CheckoutError, transaction } from '#utils/checkout.js';
import { releaseReservation } from '#services/checkout.service.js';
import pool from '#services/pg_pool.js';
import Notification from '#models/notification.model.js';
import { aggregateFulfillmentStatus } from '#services/order-fulfillment.js';

class Order {
    static async getOrderById(orderId, userId = null, vendorId = null) {
        try {
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
            const vendorStatusSelect = vendorId
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
                : `(SELECT json_agg(json_build_object(
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
                AS vendor_fulfillments`;
            const { rows } = await pool.query(
                `SELECT
                o.*,
                ${vendorStatusSelect},
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
        { status, payment_status, offset = 0, limit = 40 }
    ) {
        try {
            let paramIndex = 1;
            const whereClauses = [
                `oi.vendor_id = $${paramIndex}`,
                `vof.vendor_id = $${paramIndex++}`,
            ];
            const values = [vendorId];

            if (status) {
                whereClauses.push(`vof.status = $${paramIndex++}`);
                values.push(status);
            }

            if (payment_status) {
                whereClauses.push(`o.payment_status = $${paramIndex++}`);
                values.push(payment_status);
            }

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
                ORDER BY o.created_at DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            values.push(limit, offset);
            const { rows } = await pool.query(query, values);
            return rows;
        } catch (error) {
            console.error('Error fetching vendor orders:', error);
            throw error;
        }
    }

    // ─── FETCH ALL ORDERS (customer) ──────────────────
    static async fetchCustomerOrders(
        userId,
        vendorId,
        { status, offset = 0, limit = 40 }
    ) {
        try {
            let paramIndex = 1;
            const whereClauses = [`o.user_id = $${paramIndex++}`];
            const values = [userId];

            if (status && status.trim() !== '') {
                whereClauses.push(`o.status = $${paramIndex++}`);
                values.push(status);
            }

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
                ORDER BY o.created_at DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            values.push(limit, offset);
            const { rows } = await pool.query(query, values);
            return rows;
        } catch (error) {
            console.error('Error fetching customer orders:', error);
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
            const activeReturn = (
                await client.query(
                    `SELECT 1 FROM returns r
                     WHERE r.order_id = $1 AND r.vendor_id = $2
                     AND r.status NOT IN ('rejected', 'cancelled', 'completed')
                     LIMIT 1`,
                    [orderId, vendorId]
                )
            ).rows[0];
            if (activeReturn)
                throw new CheckoutError(
                    'Delivery cannot be confirmed while a return is in progress',
                    409
                );
            await client.query(
                `UPDATE vendor_order_fulfillments
                 SET payout_status = 'eligible', updated_at = NOW()
                 WHERE id = $1`,
                [fulfillment.id]
            );
            await client.query(
                `INSERT INTO marketplace_ledger_entries
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
            return {
                order_id: orderId,
                vendor_id: vendorId,
                payout_status: 'eligible',
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
