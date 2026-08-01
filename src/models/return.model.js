import pool from "#services/pg_pool.js";
import Payment from "#models/payment.model.js";
import Notification from "#models/notification.model.js";

class Return {
    static async createReturnRequest(orderId, userId, returnData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verify order belongs to user and is eligible for return
            const { rows: orderRows } = await client.query(
                `SELECT * FROM orders WHERE id = $1 AND user_id = $2`,
                [orderId, userId]
            );

            if (orderRows.length === 0) {
                return { error: 'Order not found', code: 404 };
            }

            const order = orderRows[0];
            if (!['delivered', 'shipped'].includes(order.status)) {
                return {
                    error: `Cannot create return request for order with status: ${order.status}`,
                    code: 422
                };
            }

            // 2. Check if return request already exists
            const { rows: existingReturn } = await client.query(
                `SELECT id FROM returns WHERE order_id = $1`,
                [orderId]
            );

            if (existingReturn.length > 0) {
                return { error: 'Return request already exists for this order', code: 409 };
            }

            // 3. Validate return items
            for (const item of returnData.items) {
                const { rows: orderItemRows } = await client.query(
                    `SELECT * FROM order_items WHERE id = $1 AND order_id = $2`,
                    [item.order_item_id, orderId]
                );

                if (orderItemRows.length === 0) {
                    return {
                        error: `Order item ${item.order_item_id} not found in this order`,
                        code: 422
                    };
                }

                if (item.quantity > orderItemRows[0].quantity) {
                    return {
                        error: `Return quantity for item ${item.order_item_id} exceeds ordered quantity`,
                        code: 422
                    };
                }
            }

            // 4. Create return request
            const { rows: returnRows } = await client.query(
                `INSERT INTO returns
                (order_id, user_id, vendor_id, reason, description, return_type, refund_amount, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *`,
                [
                    orderId,
                    userId,
                    order.vendor_id,
                    returnData.reason,
                    returnData.description ?? null,
                    returnData.return_type,
                    returnData.refund_amount ?? 0,
                    'pending'
                ]
            );

            const returnRequest = returnRows[0];

            // 5. Insert return items
            for (const item of returnData.items) {
                await client.query(
                    `INSERT INTO return_items
                    (return_id, order_item_id, quantity, condition)
                    VALUES ($1, $2, $3, $4)`,
                    [
                        returnRequest.id,
                        item.order_item_id,
                        item.quantity,
                        item.condition ?? null
                    ]
                );
            }

            // 6. Update order status to returned
            await client.query(
                `UPDATE orders SET status = 'returned', updated_at = NOW() WHERE id = $1`,
                [orderId]
            );

            await client.query('COMMIT');
            return returnRequest;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error creating return request:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async updateReturnStatus(returnId, vendorId, status, notes = null) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verify return belongs to vendor
            const { rows: returnRows } = await client.query(
                `SELECT r.*, o.vendor_id FROM returns r
                JOIN orders o ON o.id = r.order_id
                WHERE r.id = $1 AND o.vendor_id = $2`,
                [returnId, vendorId]
            );

            if (returnRows.length === 0) {
                return { error: 'Return request not found', code: 404 };
            }

            const returnRequest = returnRows[0];

            // 2. Update return status and timestamps
            const updateFields = ['status = $1', 'updated_at = NOW()'];
            const values = [status, returnId];
            let paramIndex = 3;

            if (notes) {
                updateFields.push(`vendor_notes = $${paramIndex++}`);
                values.splice(1, 0, notes);
            }

            // Set timestamps based on status
            if (status === 'approved') {
                updateFields.push(`approved_at = NOW()`);
            } else if (['completed', 'cancelled'].includes(status)) {
                updateFields.push(`completed_at = NOW()`);
            }

            await client.query(
                `UPDATE returns SET ${updateFields.join(', ')} WHERE id = $2`,
                values
            );

            // 3. If approved and refund requested, process refund
            if (status === 'approved' && returnRequest.return_type === 'refund') {
                // Calculate refund amount based on returned items
                const { rows: returnItems } = await client.query(
                    `SELECT ri.quantity, oi.price
                    FROM return_items ri
                    JOIN order_items oi ON oi.id = ri.order_item_id
                    WHERE ri.return_id = $1`,
                    [returnId]
                );

                const refundAmount = returnItems.reduce((total, item) =>
                    total + (item.quantity * item.price), 0
                );

                // Update refund amount in return record
                await client.query(
                    `UPDATE returns SET refund_amount = $1 WHERE id = $2`,
                    [refundAmount, returnId]
                );

                // Process refund
                const refundResult = await Payment.processRefund(returnRequest.user_id, {
                    order_id: returnRequest.order_id,
                    amount: refundAmount,
                    reason: `Return approved: ${returnRequest.reason}`
                });

                if (refundResult?.error) {
                    // Log error but don't fail the return approval
                    console.error("Refund processing failed:", refundResult.error);
                }
            }

            await client.query('COMMIT');
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error updating return status:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async getReturnById(returnId, userId = null, vendorId = null) {
        try {
            let query = `
                SELECT r.*,
                    json_agg(jsonb_build_object(
                        'id', ri.id,
                        'order_item_id', ri.order_item_id,
                        'quantity', ri.quantity,
                        'condition', ri.condition,
                        'product_name', p.name,
                        'price', oi.price
                    )) AS items
                FROM returns r
                LEFT JOIN return_items ri ON ri.return_id = r.id
                LEFT JOIN order_items oi ON oi.id = ri.order_item_id
                LEFT JOIN products p ON p.id = oi.product_id
                WHERE r.id = $1
            `;
            const values = [returnId];
            let paramIndex = 2;

            if (userId) {
                query += ` AND r.user_id = $${paramIndex++}`;
                values.push(userId);
            }

            if (vendorId) {
                query += ` AND EXISTS (SELECT 1 FROM orders o WHERE o.id = r.order_id AND o.vendor_id = $${paramIndex++})`;
                values.push(vendorId);
            }

            query += ` GROUP BY r.id`;

            const { rows } = await pool.query(query, values);
            return rows[0] ?? null;
        } catch (error) {
            console.error("Error fetching return:", error);
            throw error;
        }
    }

    static async getReturnsByOrderId(orderId, userId = null, vendorId = null) {
        try {
            let query = `SELECT * FROM returns WHERE order_id = $1`;
            const values = [orderId];
            let paramIndex = 2;

            if (userId) {
                query += ` AND user_id = $${paramIndex++}`;
                values.push(userId);
            }

            if (vendorId) {
                query += ` AND EXISTS (SELECT 1 FROM orders o WHERE o.id = $1 AND o.vendor_id = $${paramIndex++})`;
                values.push(orderId, vendorId);
            }

            const { rows } = await pool.query(query, values);
            return rows;
        } catch (error) {
            console.error("Error fetching returns:", error);
            throw error;
        }
    }

    static async getVendorReturns(vendorId, { status, offset = 0, limit = 40 }) {
        try {
            let paramIndex = 1;
            const whereClauses = [`EXISTS (SELECT 1 FROM orders o WHERE o.id = r.order_id AND o.vendor_id = $${paramIndex++})`];
            const values = [vendorId];

            if (status) {
                whereClauses.push(`r.status = $${paramIndex++}`);
                values.push(status);
            }

            const query = `
                SELECT r.*,
                    u.firstname, u.lastname, u.email,
                    o.id as order_id, o.total
                FROM returns r
                JOIN users u ON u.id = r.user_id
                JOIN orders o ON o.id = r.order_id
                WHERE ${whereClauses.join(' AND ')}
                ORDER BY r.created_at DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            values.push(limit, offset);
            const { rows } = await pool.query(query, values);
            return rows;
        } catch (error) {
            console.error("Error fetching vendor returns:", error);
            throw error;
        }
    }

    static async adminUpdateReturn(returnId, adminId, updateData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verify return exists
            const { rows: returnRows } = await client.query(
                `SELECT * FROM returns WHERE id = $1`,
                [returnId]
            );

            if (returnRows.length === 0) {
                return { error: 'Return request not found', code: 404 };
            }

            const returnRequest = returnRows[0];

            // 2. Update return with admin data
            const updateFields = ['updated_at = NOW()'];
            const values = [returnId];
            let paramIndex = 2;

            if (updateData.status !== undefined) {
                updateFields.push(`status = $${paramIndex++}`);
                values.splice(1, 0, updateData.status);

                // Set timestamps based on status
                if (updateData.status === 'approved') {
                    updateFields.push(`approved_at = NOW()`);
                } else if (['completed', 'cancelled'].includes(updateData.status)) {
                    updateFields.push(`completed_at = NOW()`);
                }
            }

            if (updateData.admin_notes !== undefined) {
                updateFields.push(`admin_notes = $${paramIndex++}`);
                values.push(updateData.admin_notes);
            }

            if (updateData.evidence !== undefined) {
                updateFields.push(`evidence = $${paramIndex++}`);
                values.push(JSON.stringify(updateData.evidence));
            }

            await client.query(
                `UPDATE returns SET ${updateFields.join(', ')} WHERE id = $1`,
                values
            );

            await client.query('COMMIT');
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error updating return by admin:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async getAllReturns({ status, vendor_id, offset = 0, limit = 40 }) {
        try {
            let paramIndex = 1;
            const whereClauses = [];
            const values = [];

            if (status) {
                whereClauses.push(`r.status = $${paramIndex++}`);
                values.push(status);
            }

            if (vendor_id) {
                whereClauses.push(`EXISTS (SELECT 1 FROM orders o WHERE o.id = r.order_id AND o.vendor_id = $${paramIndex++})`);
                values.push(vendor_id);
            }

            const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

            const query = `
                SELECT r.*,
                    u.firstname, u.lastname, u.email,
                    v.shop_name as vendor_name,
                    o.id as order_id, o.total, o.status as order_status
                FROM returns r
                JOIN users u ON u.id = r.user_id
                LEFT JOIN orders o ON o.id = r.order_id
                LEFT JOIN vendors v ON v.id = r.vendor_id
                ${whereClause}
                ORDER BY r.created_at DESC
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            values.push(limit, offset);
            const { rows } = await pool.query(query, values);
            return rows;
        } catch (error) {
            console.error("Error fetching all returns:", error);
            throw error;
        }
    }
}

export default Return;