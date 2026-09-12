import { CheckoutError, transaction } from '#utils/checkout.js';
import { releaseReservation } from '#services/checkout.service.js';
import pool from '#services/pg_pool.js';
import Notification from '#models/notification.model.js';

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
            const { rows } = await pool.query(
                `SELECT
                o.*,
                json_agg(DISTINCT jsonb_build_object(
                    'id', oi.id,
                    'product_id', oi.product_id,
                    'product_name', COALESCE(oi.product_name, p.name),
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
            GROUP BY o.id, oa.id`,
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
            const whereClauses = [`oi.vendor_id = $${paramIndex++}`];
            const values = [vendorId];

            if (status) {
                whereClauses.push(`o.status = $${paramIndex++}`);
                values.push(status);
            }

            if (payment_status) {
                whereClauses.push(`o.payment_status = $${paramIndex++}`);
                values.push(payment_status);
            }

            const query = `
                SELECT
                    o.*,
                    u.firstname, u.lastname, u.email,
                    COUNT(oi.id) AS item_count,
                    json_agg(DISTINCT jsonb_build_object(
                        'id', oi.id,
                        'product_id', oi.product_id,
                        'product_name', COALESCE(oi.product_name, p.name),
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
                JOIN products p ON p.id = oi.product_id
                LEFT JOIN shipping_addresses oa ON oa.order_id = o.id
                WHERE ${whereClauses.join(' AND ')}
                GROUP BY o.id, u.id, oa.id
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
                    json_agg(DISTINCT jsonb_build_object(
                        'id', oi.id,
                        'product_id', oi.product_id,
                        'product_name', COALESCE(oi.product_name, p.name),
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
                `SELECT * FROM orders WHERE id = $1 AND vendor_id = $2`,
                [orderId, vendorId]
            );

            if (orderRows.length === 0) {
                return { error: 'Order not found', code: 404 };
            }

            const order = orderRows[0];

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

            if (!validTransitions[order.status].includes(status)) {
                return {
                    error: `Cannot transition order from ${order.status} to ${status}`,
                    code: 422,
                };
            }

            // 3. Update order status
            const { rows: updatedRows } = await client.query(
                `UPDATE orders SET
                    status = $1,
                    updated_at = NOW()
                WHERE id = $2
                RETURNING *`,
                [status, orderId]
            );

            // 4. Insert status history
            await client.query(
                `INSERT INTO order_status_history (order_id, status, note, changed_by)
                VALUES ($1, $2, $3, $4)`,
                [orderId, status, note ?? null, changedBy]
            );

            // 5. Send notification to customer
            try {
                await Notification.notifyOrderStatusChange(
                    orderId,
                    order.user_id,
                    order.status,
                    status
                );
            } catch (notificationError) {
                console.error(
                    'Error sending order status notification:',
                    notificationError
                );
                // Don't fail the order update if notification fails
            }

            await client.query('COMMIT');
            return updatedRows[0];
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

    static async fetchOrderHistory(orderId, userId = null) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    osh.*,
                    u.firstname, u.lastname
                FROM order_status_history osh
                LEFT JOIN users u ON u.id = osh.changed_by
                WHERE osh.order_id = $1
                ${userId ? 'AND EXISTS (SELECT 1 FROM orders o WHERE o.id = $2 AND o.user_id = $3)' : ''}
                ORDER BY osh.created_at ASC`,
                userId ? [orderId, orderId, userId] : [orderId]
            );
            return rows;
        } catch (error) {
            console.error('Error fetching order history:', error);
            throw error;
        }
    }
}

export default Order;
