import pool from "#services/pg_pool.js";
import Notification from "#models/notification.model.js";

class Order {
    static async placeOrder(userId, { note, shipping_address }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Fetch cart with items
            const { rows: cartRows } = await client.query(
                `SELECT c.id AS cart_id,
                json_agg(jsonb_build_object(
                    'id', ci.id,
                    'product_id', ci.product_id,
                    'variant_id', ci.variant_id,
                    'quantity', ci.quantity,
                    'price', ci.price
                )) AS items
                FROM carts c
                JOIN cart_items ci ON ci.cart_id = c.id
                WHERE c.user_id = $1
                GROUP BY c.id`,
                [userId]
            );

            if (cartRows.length === 0) {
                return { error: 'Cart is empty', code: 400 };
            }

            const cart = cartRows[0];
            const items = cart.items;

            // 2. Validate stock for all items
            for (const item of items) {
                if (item.variant_id) {
                    const { rows: variantRows } = await client.query(
                        `SELECT stock FROM product_variants 
                        WHERE id = $1 AND status = 'active'`,
                        [item.variant_id]
                    );

                    if (variantRows.length === 0 || variantRows[0].stock < item.quantity) {
                        return {
                            error: `Insufficient stock for variant ID ${item.variant_id}`,
                            code: 422
                        };
                    }
                } else {
                    const { rows: productRows } = await client.query(
                        `SELECT name, stock FROM products 
                        WHERE id = $1 AND status = 'active'`,
                        [item.product_id]
                    );

                    if (productRows.length === 0 || productRows[0].stock < item.quantity) {
                        return {
                            error: `Insufficient stock for product: ${productRows[0]?.name}`,
                            code: 422
                        };
                    }
                }
            }

            // 3. Calculate totals
            const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
            const shipping_fee = 0; // handle shipping logic here if needed
            const total = subtotal + shipping_fee;

            // 4. Create order
            const { rows: orderRows } = await client.query(
                `INSERT INTO orders (user_id, subtotal, shipping_fee, total, note)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *`,
                [userId, subtotal, shipping_fee, total, note ?? null]
            );

            const order = orderRows[0];

            // 5. Insert order items and deduct stock
            for (const item of items) {
                // Insert order item
                await client.query(
                    `INSERT INTO order_items (order_id, product_id, variant_id, quantity, price, subtotal)
                    VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        order.id, item.product_id, item.variant_id ?? null,
                        item.quantity, item.price, item.price * item.quantity
                    ]
                );

                // Deduct stock
                if (item.variant_id) {
                    await client.query(
                        `UPDATE product_variants 
                        SET stock = stock - $1, updated_at = NOW()
                        WHERE id = $2`,
                        [item.quantity, item.variant_id]
                    );
                } else {
                    await client.query(
                        `UPDATE products 
                        SET stock = stock - $1, updated_at = NOW()
                        WHERE id = $2`,
                        [item.quantity, item.product_id]
                    );
                }
            }

            // 6. Insert shipping address
            await client.query(
                `INSERT INTO order_addresses 
                (order_id, firstname, lastname, phone, address, city, state, country, zip_code)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    order.id,
                    shipping_address.firstname,
                    shipping_address.lastname,
                    shipping_address.phone,
                    shipping_address.address,
                    shipping_address.city,
                    shipping_address.state,
                    shipping_address.country,
                    shipping_address.zip_code ?? null
                ]
            );

            // 7. Clear cart
            await client.query(`DELETE FROM carts WHERE id = $1`, [cart.cart_id]);

            await client.query('COMMIT');

            // 8. Return full order
            return await OrderModel.getOrderById(order.id, userId);
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error placing order:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async getOrderById(orderId, userId = null) {
        try {
            let paramIndex = 2;
            const whereClauses = [`o.id = $1`];
            const values = [orderId];

            if (userId) {
                whereClauses.push(`o.user_id = $${paramIndex++}`);
                values.push(userId);
            }

            const { rows } = await pool.query(
                `SELECT
                o.*,
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
                    'phone', oa.phone,
                    'address', oa.address,
                    'city', oa.city,
                    'state', oa.state,
                    'country', oa.country,
                    'zip_code', oa.zip_code
                ) AS shipping_address
            FROM orders o
            JOIN order_items oi ON oi.order_id = o.id
            JOIN products p ON p.id = oi.product_id
            JOIN order_addresses oa ON oa.order_id = o.id
            WHERE ${whereClauses.join(' AND ')}
            GROUP BY o.id, oa.id`,
                values
            );

            return rows[0] ?? null;
        } catch (error) {
            console.error("Error fetching order:", error);
            throw error;
        }
    }

    static async fetchVendorOrders(vendorId, { status, payment_status, offset = 0, limit = 40 }) {
        try {
            let paramIndex = 1;
            const whereClauses = [`o.vendor_id = $${paramIndex++}`];
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
                        'phone', oa.phone,
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
                JOIN order_addresses oa ON oa.order_id = o.id
                WHERE ${whereClauses.join(' AND ')}
                GROUP BY o.id, u.id, oa.id
                ORDER BY o.created_at DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            values.push(limit, offset);
            const { rows } = await pool.query(query, values);
            return rows;
        } catch (error) {
            console.error("Error fetching vendor orders:", error);
            throw error;
        }
    }

    // ─── FETCH ALL ORDERS (customer) ──────────────────
    static async fetchCustomerOrders(userId, vendorId, { status, offset = 0, limit = 40 }) {
        try {
            let paramIndex = 1;
            const whereClauses = [
                `o.user_id = $${paramIndex++}`,
                `o.vendor_id = $${paramIndex++}`
            ];
            const values = [userId, vendorId];

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
                        'phone', oa.phone,
                        'address', oa.address,
                        'city', oa.city,
                        'state', oa.state,
                        'country', oa.country,
                        'zip_code', oa.zip_code
                    ) AS shipping_address
                FROM orders o
                JOIN order_items oi ON oi.order_id = o.id
                JOIN products p ON p.id = oi.product_id
                JOIN order_addresses oa ON oa.order_id = o.id
                WHERE ${whereClauses.join(' AND ')}
                GROUP BY o.id, oa.id
                ORDER BY o.created_at DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            values.push(limit, offset);
            const { rows } = await pool.query(query, values);
            return rows;
        } catch (error) {
            console.error("Error fetching customer orders:", error);
            throw error;
        }
    }

    // ─── UPDATE ORDER STATUS (vendor) ─────────────────
    static async updateOrderStatus(orderId, vendorId, changedBy, { status, note }) {
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
                refunded: []
            };

            if (!validTransitions[order.status].includes(status)) {
                return {
                    error: `Cannot transition order from ${order.status} to ${status}`,
                    code: 422
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
                await Notification.notifyOrderStatusChange(orderId, order.user_id, order.status, status);
            } catch (notificationError) {
                console.error("Error sending order status notification:", notificationError);
                // Don't fail the order update if notification fails
            }

            await client.query('COMMIT');
            return updatedRows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error updating order status:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    // ─── CANCEL ORDER (customer) ───────────────────────
    static async cancelOrder(orderId, userId, { reason }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Fetch order
            const { rows: orderRows } = await client.query(
                `SELECT * FROM orders WHERE id = $1 AND user_id = $2`,
                [orderId, userId]
            );

            if (orderRows.length === 0) {
                return { error: 'Order not found', code: 404 };
            }

            const order = orderRows[0];

            // 2. Only pending orders can be cancelled by customer
            if (order.status !== 'pending') {
                return {
                    error: `Order cannot be cancelled at ${order.status} stage`,
                    code: 422
                };
            }

            // 3. Cancel order
            await client.query(
                `UPDATE orders SET
                    status = 'cancelled',
                    updated_at = NOW()
                WHERE id = $1`,
                [orderId]
            );

            // 4. Insert status history
            await client.query(
                `INSERT INTO order_status_history (order_id, status, note, changed_by)
                VALUES ($1, $2, $3, $4)`,
                [orderId, 'cancelled', reason, userId]
            );

            // 5. Restore stock
            const { rows: orderItems } = await client.query(
                `SELECT * FROM order_items WHERE order_id = $1`,
                [orderId]
            );

            for (const item of orderItems) {
                if (item.variant_id) {
                    await client.query(
                        `UPDATE product_variants
                        SET stock = stock + $1, updated_at = NOW()
                        WHERE id = $2`,
                        [item.quantity, item.variant_id]
                    );
                } else {
                    await client.query(
                        `UPDATE products
                        SET stock = stock + $1, updated_at = NOW()
                        WHERE id = $2`,
                        [item.quantity, item.product_id]
                    );
                }
            }

            // 6. If paid — trigger automatic refund
            if (order.payment_status === 'paid') {
                await RefundModel.processRefund(userId, {
                    order_id: orderId,
                    reason: `Order cancelled: ${reason}`
                });
            }

            await client.query('COMMIT');

            return await OrderModel.getOrderById(orderId, userId);
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error cancelling order:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    // ─── FETCH ORDER STATUS HISTORY ───────────────────
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
            console.error("Error fetching order history:", error);
            throw error;
        }
    }
}

export default Order;