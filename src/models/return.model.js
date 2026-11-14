import { randomUUID } from 'node:crypto';
import pool from '#services/pg_pool.js';
import Payment from '#models/payment.model.js';
import { notifyReturn } from '#services/notifications.js';

const CHANGE_OF_MIND_WINDOW_DAYS = 7;
const REFUNDABLE_CLAIMS = new Set([
    'defective_or_unsafe',
    'wrong_item',
    'misdescribed',
    'unsuitable_for_stated_purpose',
]);
const TERMINAL_STATUSES = new Set(['rejected', 'cancelled', 'completed']);
const TRANSITIONS = {
    pending: new Set(['approved', 'rejected', 'cancelled']),
    approved: new Set(['awaiting_pickup', 'cancelled']),
    awaiting_pickup: new Set(['item_received', 'cancelled']),
    item_received: new Set(['processing', 'cancelled']),
    processing: new Set(['completed']),
    rejected: new Set(),
    completed: new Set(),
    cancelled: new Set(),
};

const returnSelect = `
    SELECT r.*,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', ri.id, 'order_item_id', ri.order_item_id,
            'quantity', ri.quantity, 'condition', ri.condition,
            'product_name', oi.product_name, 'unit_price', oi.price
        ) ORDER BY ri.id)
        FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
        WHERE ri.return_id = r.id), '[]'::jsonb) AS items
    FROM returns r`;

const terminalFilter = `r.status NOT IN ('rejected', 'cancelled')`;

class Return {
    static async createReturnRequest(orderId, userId, returnData) {
        console.log('returnData', returnData);
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const orderResult = await client.query(
                'SELECT * FROM orders WHERE id = $1 AND user_id = $2 FOR UPDATE',
                [orderId, userId]
            );
            const order = orderResult.rows[0];
            if (!order) {
                await client.query('ROLLBACK');
                return { error: 'Order not found', code: 404 };
            }
            if (order.payment_status !== 'paid') {
                await client.query('ROLLBACK');
                return { error: 'Only paid orders can be returned', code: 422 };
            }

            const itemIds = returnData.items.map(({ order_item_id }) => Number(order_item_id));
            if (new Set(itemIds).size !== itemIds.length) {
                await client.query('ROLLBACK');
                return { error: 'Each order item may appear only once per return request', code: 422 };
            }

            const orderItemsResult = await client.query(
                `SELECT oi.*, s.actual_delivery, s.status AS shipment_status
                 FROM order_items oi
                 LEFT JOIN LATERAL (
                    SELECT actual_delivery, status FROM shipments
                    WHERE order_id = oi.order_id AND vendor_id = oi.vendor_id
                    ORDER BY (status = 'delivered') DESC, actual_delivery DESC NULLS LAST, id DESC
                    LIMIT 1
                 ) s ON TRUE
                 WHERE oi.order_id = $1 AND oi.id = ANY($2::int[])
                   AND oi.product_id IS NOT NULL
                 ORDER BY oi.id FOR UPDATE OF oi`,
                [orderId, itemIds]
            );
            if (orderItemsResult.rows.length !== itemIds.length) {
                await client.query('ROLLBACK');
                return { error: 'One or more items are not returnable products in this order', code: 422 };
            }

            const vendorIds = new Set(orderItemsResult.rows.map((item) => item.vendor_id));
            if (vendorIds.size !== 1) {
                await client.query('ROLLBACK');
                return { error: 'Submit separate return requests for items from different vendors', code: 422 };
            }
            const vendorId = orderItemsResult.rows[0].vendor_id;
            const deliveredAt = orderItemsResult.rows.reduce((latest, item) => {
                if (item.shipment_status !== 'delivered' || !item.actual_delivery) return latest;
                const date = new Date(item.actual_delivery);
                return !latest || date > latest ? date : latest;
            }, null);
            if (!deliveredAt) {
                await client.query('ROLLBACK');
                return { error: 'Return requests are available after delivery is confirmed', code: 422 };
            }

            const claimType = returnData.reason_type;
            const deadline = new Date(deliveredAt);
            if (REFUNDABLE_CLAIMS.has(claimType)) {
                // Use calendar months for the statutory window; months are not always 30 days.
                deadline.setMonth(deadline.getMonth() + 3);
            } else {
                deadline.setDate(deadline.getDate() + CHANGE_OF_MIND_WINDOW_DAYS);
            }
            if (new Date() > deadline) {
                await client.query('ROLLBACK');
                return {
                    error: REFUNDABLE_CLAIMS.has(claimType)
                        ? 'The return claim window has passed; contact support if you believe statutory rights apply'
                        : 'Change-of-mind returns must be requested within 7 days of delivery',
                    code: 422,
                };
            }

            const requestedItems = [];
            for (const requested of returnData.items) {
                const item = orderItemsResult.rows.find((candidate) => candidate.id === Number(requested.order_item_id));
                const priorResult = await client.query(
                    `SELECT COALESCE(SUM(ri.quantity), 0)::int AS quantity
                     FROM return_items ri JOIN returns r ON r.id = ri.return_id
                     WHERE ri.order_item_id = $1 AND ${terminalFilter}`,
                    [item.id]
                );
                const remaining = item.quantity - priorResult.rows[0].quantity;
                if (requested.quantity > remaining) {
                    await client.query('ROLLBACK');
                    return {
                        error: `Return quantity for order item ${item.id} exceeds the remaining eligible quantity (${Math.max(0, remaining)})`,
                        code: 422,
                    };
                }
                requestedItems.push({ item, requested });
            }

            // Allocate order-level discount to physical products, then tax to the discounted value.
            const allItemResult = await client.query(
                `SELECT COALESCE(SUM(subtotal), 0)::numeric AS subtotal
                 FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL`,
                [orderId]
            );
            const itemsSubtotal = Number(allItemResult.rows[0].subtotal);
            const orderSubtotal = Number(order.subtotal);
            const productDiscount = orderSubtotal > 0
                ? Math.min(itemsSubtotal, Number(order.discount || 0) * itemsSubtotal / orderSubtotal)
                : 0;
            const productNetRatio = itemsSubtotal > 0
                ? Math.max(0, (itemsSubtotal - productDiscount) / itemsSubtotal)
                : 0;
            const taxRatio = orderSubtotal > 0 ? Number(order.tax || 0) / orderSubtotal : 0;
            const refundAmount = requestedItems.reduce((sum, { item, requested }) => {
                const gross = (Number(item.subtotal) / Number(item.quantity)) * Number(requested.quantity);
                const discountedValue = gross * productNetRatio;
                return sum + Math.max(0, discountedValue + discountedValue * taxRatio);
            }, 0);
            const roundedRefund = Math.round((refundAmount + Number.EPSILON) * 100) / 100;
            if (!Number.isFinite(roundedRefund) || roundedRefund <= 0 || itemsSubtotal <= 0) {
                await client.query('ROLLBACK');
                return { error: 'Unable to calculate an eligible refund amount', code: 422 };
            }

            const { rows: [returnRequest] } = await client.query(
                `INSERT INTO returns
                 (order_id, user_id, vendor_id, reason, description, reason_type,
                  return_type, refund_amount, refund_status, delivered_at,
                  return_window_expires_at, policy_version, status)
                 VALUES ($1,$2,$3,$4,$5,$6,'refund',$7,'not_requested',$8,$9,'2026-11-12','pending')
                 RETURNING *`,
                [orderId, userId, vendorId, returnData.reason, returnData.description ?? null,
                    claimType, roundedRefund, deliveredAt, deadline]
            );

            for (const { item, requested } of requestedItems) {
                await client.query(
                    `INSERT INTO return_items (return_id, order_item_id, quantity, condition)
                     VALUES ($1,$2,$3,$4)`,
                    [returnRequest.id, item.id, requested.quantity, requested.condition ?? null]
                );
            }
            await client.query(
                `UPDATE vendor_order_fulfillments SET payout_status = 'disputed', updated_at = NOW()
                 WHERE order_id = $1 AND vendor_id = $2 AND payout_status IN ('held','eligible')`,
                [orderId, vendorId]
            );
            await notifyReturn(client, returnRequest, 'pending', { vendors: true });
            await client.query('COMMIT');
            return { ...returnRequest, items: requestedItems.map(({ item, requested }) => ({
                order_item_id: item.id,
                product_name: item.product_name,
                quantity: requested.quantity,
                condition: requested.condition ?? null,
            })) };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error creating return request:', error.message);
            throw error;
        } finally {
            client.release();
        }
    }

    static async updateReturnStatus(returnId, vendorId, status, notes = null) {
        return this.#changeStatus(returnId, status, { vendorId, notes });
    }

    static async adminUpdateReturn(returnId, adminId, updateData) {
        return this.#changeStatus(returnId, updateData.status, {
            adminId,
            notes: updateData.admin_notes,
            evidence: updateData.evidence,
        });
    }

    static async #changeStatus(returnId, status, { vendorId = null, adminId = null, notes = null, evidence } = {}) {
        const client = await pool.connect();
        let shouldIssueRefund = false;
        let returnRequest;
        try {
            await client.query('BEGIN');
            const values = [returnId];
            let scope = '';
            if (vendorId !== null) {
                values.push(vendorId);
                scope = ' AND vendor_id = $2';
            }
            const rows = await client.query(
                `SELECT * FROM returns WHERE id = $1${scope} FOR UPDATE`, values
            );
            returnRequest = rows.rows[0];
            if (!returnRequest) {
                await client.query('ROLLBACK');
                return { error: 'Return request not found', code: 404 };
            }
            const nextStatus = status ?? returnRequest.status;
            const retryingRefund = nextStatus === 'processing' && returnRequest.status === 'processing';
            if (nextStatus !== returnRequest.status && !TRANSITIONS[returnRequest.status]?.has(nextStatus)) {
                await client.query('ROLLBACK');
                return { error: `Cannot move return from ${returnRequest.status} to ${nextStatus}`, code: 409 };
            }
            if ((nextStatus === 'processing' || retryingRefund) && returnRequest.return_type === 'refund') {
                shouldIssueRefund = true;
            }
            if (nextStatus === 'completed' && returnRequest.return_type === 'refund' && returnRequest.refund_status !== 'processed') {
                await client.query('ROLLBACK');
                return { error: 'A return cannot be completed until its refund is confirmed', code: 409 };
            }
            const updated = await client.query(
                `UPDATE returns SET status = $2,
                    vendor_notes = CASE WHEN $3::text IS NOT NULL AND $4::boolean THEN $3 ELSE vendor_notes END,
                    admin_notes = CASE WHEN $3::text IS NOT NULL AND NOT $4::boolean THEN $3 ELSE admin_notes END,
                    evidence = COALESCE($5::jsonb, evidence),
                    approved_at = CASE WHEN $2 = 'approved' THEN NOW() ELSE approved_at END,
                    completed_at = CASE WHEN $2 IN ('completed','cancelled','rejected') THEN NOW() ELSE completed_at END,
                    refund_status = CASE WHEN $2 = 'processing' AND return_type = 'refund' THEN 'queued' ELSE refund_status END,
                    updated_at = NOW()
                 WHERE id = $1 RETURNING *`,
                [returnId, nextStatus, notes, vendorId !== null, evidence === undefined ? null : JSON.stringify(evidence)]
            );
            returnRequest = updated.rows[0];
            if (nextStatus !== rows.rows[0].status || notes || evidence !== undefined) {
                await notifyReturn(client, returnRequest, nextStatus, { vendors: adminId !== null });
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error changing return status:', error.message);
            throw error;
        } finally {
            client.release();
        }

        if (shouldIssueRefund) {
            try {
                const refund = await Payment.processReturnRefund(returnRequest.id);
                return { success: true, return: returnRequest, refund };
            } catch (error) {
                console.error('Return refund initiation failed:', error.message);
                return { success: true, return: returnRequest, refund_error: 'Refund initiation needs review' };
            }
        }
        return { success: true, return: returnRequest };
    }

    static async getReturnById(returnId, userId = null, vendorId = null) {
        const conditions = ['r.id = $1'];
        const values = [returnId];
        if (userId !== null) { values.push(userId); conditions.push(`r.user_id = $${values.length}`); }
        if (vendorId !== null) { values.push(vendorId); conditions.push(`r.vendor_id = $${values.length}`); }
        const { rows } = await pool.query(`${returnSelect} WHERE ${conditions.join(' AND ')}`, values);
        return rows[0] ?? null;
    }

    static async getReturnsByOrderId(orderId, userId = null, vendorId = null) {
        const conditions = ['r.order_id = $1'];
        const values = [orderId];
        if (userId !== null) { values.push(userId); conditions.push(`r.user_id = $${values.length}`); }
        if (vendorId !== null) { values.push(vendorId); conditions.push(`r.vendor_id = $${values.length}`); }
        const { rows } = await pool.query(`${returnSelect} WHERE ${conditions.join(' AND ')} ORDER BY r.created_at DESC`, values);
        return rows;
    }

    static async getCustomerReturns(userId, { status, offset = 0, limit = 40 } = {}) {
        const values = [userId];
        let where = 'r.user_id = $1';
        if (status) { values.push(status); where += ` AND r.status = $${values.length}`; }
        values.push(limit, offset);
        const { rows } = await pool.query(
            `${returnSelect} WHERE ${where} ORDER BY r.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
            values
        );
        return rows;
    }

    static async getVendorReturns(vendorId, { status, offset = 0, limit = 40 } = {}) {
        const values = [vendorId];
        let where = 'r.vendor_id = $1';
        if (status) { values.push(status); where += ` AND r.status = $${values.length}`; }
        values.push(limit, offset);
        const { rows } = await pool.query(
            `SELECT r.*, u.firstname, u.lastname, u.email, o.total AS order_total,
             COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', ri.id, 'order_item_id', ri.order_item_id, 'quantity', ri.quantity,
                'condition', ri.condition, 'product_name', oi.product_name, 'unit_price', oi.price
             ) ORDER BY ri.id) FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
             WHERE ri.return_id = r.id), '[]'::jsonb) AS items
             FROM returns r JOIN users u ON u.id = r.user_id JOIN orders o ON o.id = r.order_id
             WHERE ${where} ORDER BY r.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
            values
        );
        return rows;
    }

    static async getAllReturns({ status, vendor_id, offset = 0, limit = 40 } = {}) {
        const values = [];
        const conditions = [];
        if (status) { values.push(status); conditions.push(`r.status = $${values.length}`); }
        if (vendor_id) { values.push(vendor_id); conditions.push(`r.vendor_id = $${values.length}`); }
        values.push(limit, offset);
        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
        const { rows } = await pool.query(
            `SELECT r.*, u.firstname, u.lastname, u.email, v.shop_name AS vendor_name,
             o.total AS order_total, o.status AS order_status,
             COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'id', ri.id, 'order_item_id', ri.order_item_id, 'quantity', ri.quantity,
                'condition', ri.condition, 'product_name', oi.product_name, 'unit_price', oi.price
             ) ORDER BY ri.id) FROM return_items ri JOIN order_items oi ON oi.id = ri.order_item_id
             WHERE ri.return_id = r.id), '[]'::jsonb) AS items
             FROM returns r JOIN users u ON u.id = r.user_id
             JOIN orders o ON o.id = r.order_id LEFT JOIN vendors v ON v.id = r.vendor_id
             ${where} ORDER BY r.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
            values
        );
        return rows;
    }
}

export default Return;
