import pool from '#services/pg_pool.js';
import Notification from '#models/notification.model.js';
import { CheckoutError, transaction } from '#utils/checkout.js';
import { fulfillmentStatus, validateShipmentTransition } from '#services/shipment.js';
import {
    advanceFulfillmentStatus,
    aggregateFulfillmentStatus,
    shipmentFulfillmentStatus,
} from '#services/order-fulfillment.js';

const editableFields = ['tracking_number', 'carrier', 'shipping_method', 'estimated_delivery', 'shipping_cost', 'status', 'notes'];
const publicFields = ['tracking_number', 'carrier', 'shipping_method', 'estimated_delivery', 'status'];

async function syncOrder(client, order, changedBy) {
    if (['cancelled', 'returned', 'refunded', 'payment_review'].includes(order.status)) return;
    const { rows: shipments } = await client.query('SELECT vendor_id, status FROM shipments WHERE order_id = $1', [order.id]);
    const { rows } = await client.query('SELECT COUNT(DISTINCT vendor_id)::int AS count FROM order_items WHERE order_id = $1 AND product_id IS NOT NULL', [order.id]);
    const { rows: groups } = await client.query(
        'SELECT vendor_id, status FROM vendor_order_fulfillments WHERE order_id = $1 FOR UPDATE',
        [order.id]
    );
    if (groups.length) {
        for (const group of groups) {
            const shipment = shipments.find((item) => item.vendor_id === group.vendor_id);
            if (!shipment) continue;
            const nextStatus = advanceFulfillmentStatus(
                group.status,
                shipmentFulfillmentStatus(shipment.status)
            );
            if (nextStatus !== group.status) {
                await client.query(
                    `UPDATE vendor_order_fulfillments SET status = $1, updated_at = NOW()
                     WHERE order_id = $2 AND vendor_id = $3`,
                    [nextStatus, order.id, group.vendor_id]
                );
                await client.query(
                    `INSERT INTO vendor_order_fulfillment_history
                     (fulfillment_id, status, note, changed_by)
                     SELECT id, $1, 'Shipment progress updated', $2
                     FROM vendor_order_fulfillments
                     WHERE order_id = $3 AND vendor_id = $4`,
                    [nextStatus, changedBy, order.id, group.vendor_id]
                );
                group.status = nextStatus;
            }
        }
    }
    const status = groups.length
        ? aggregateFulfillmentStatus(groups.map((group) => group.status), order.status)
        : fulfillmentStatus(shipments, rows[0].count);
    // Packing is a manual step; creating a pending shipment should not undo it.
    if (!status || status === order.status || (status === 'awaiting_shipment' && order.status === 'packed')) return;
    await client.query('UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2', [status, order.id]);
    await client.query(
        'INSERT INTO order_status_history (order_id, status, note, changed_by) VALUES ($1, $2, $3, $4)',
        [order.id, status, 'Shipment progress updated', changedBy]
    );
}

async function history(client, shipment, data, changedBy) {
    const { rows } = await client.query(
        `INSERT INTO shipment_tracking_history (shipment_id, status, location, description, changed_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [shipment.id, shipment.status, data.location ?? null,
            data.description ?? data.tracking_description ?? `Shipment ${shipment.status.replaceAll('_', ' ')}`, changedBy]
    );
    return rows[0];
}

class Shipment {
    static async createShipment(orderId, vendorId, data, changedBy = null) {
        if (!vendorId) throw new CheckoutError('Forbidden', 403);
        return transaction(pool, async client => {
            const { rows } = await client.query(
                `SELECT * FROM orders WHERE id = $1 AND EXISTS
                 (SELECT 1 FROM order_items oi WHERE oi.order_id = orders.id AND oi.vendor_id = $2 AND oi.product_id IS NOT NULL) FOR UPDATE`,
                [orderId, vendorId]
            );
            const order = rows[0];
            if (!order) throw new CheckoutError('Order not found', 404);
            if (order.payment_status !== 'paid' || !['processing', 'awaiting_shipment', 'packed', 'shipped', 'out_for_delivery'].includes(order.status)) {
                throw new CheckoutError('Only paid orders awaiting fulfillment can be shipped', 422);
            }
            const existing = await client.query(
                'SELECT id FROM shipments WHERE order_id = $1 AND (vendor_id = $2 OR vendor_id IS NULL)', [orderId, vendorId]
            );
            if (existing.rows.length) throw new CheckoutError('Shipment already exists or requires legacy reconciliation', 409);
            const { rows: created } = await client.query(
                `INSERT INTO shipments (order_id, vendor_id, tracking_number, carrier, shipping_method, estimated_delivery, shipping_cost, status, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8) RETURNING *`,
                [orderId, vendorId, data.tracking_number, data.carrier, data.shipping_method ?? null,
                    data.estimated_delivery ?? null, data.shipping_cost ?? 0, data.notes ?? null]
            );
            const shipment = created[0];
            await history(client, shipment, { ...data, description: 'Shipment created' }, changedBy);
            await syncOrder(client, order, changedBy);
            await Notification.notifyShipmentUpdate(order.id, order.user_id, shipment, client);
            return shipment;
        });
    }

    static async updateShipment(shipmentId, vendorId, data, changedBy = null, tracking = false) {
        if (!vendorId) throw new CheckoutError('Forbidden', 403);
        return transaction(pool, async client => {
            // Lock the order first on every write, serializing fulfillment across its vendors.
            const { rows: orders } = await client.query(
                `SELECT o.* FROM orders o JOIN shipments s ON s.order_id = o.id
                 WHERE s.id = $1 AND s.vendor_id = $2 FOR UPDATE OF o`, [shipmentId, vendorId]
            );
            const order = orders[0];
            if (!order) throw new CheckoutError('Shipment not found', 404);
            if (order.payment_status !== 'paid' || ['cancelled', 'refunded', 'payment_review'].includes(order.status)) {
                throw new CheckoutError('This order cannot receive shipment updates', 409);
            }
            const { rows } = await client.query('SELECT * FROM shipments WHERE id = $1 AND vendor_id = $2 FOR UPDATE', [shipmentId, vendorId]);
            const shipment = rows[0];
            if (!shipment) throw new CheckoutError('Shipment not found', 404);
            if (data.status !== undefined) validateShipmentTransition(shipment.status, data.status);
            const fields = editableFields.filter(field => data[field] !== undefined);
            const values = fields.map(field => data[field]);
            const updates = fields.map((field, index) => `${field} = $${index + 1}`);
            if (data.status === 'delivered' && shipment.status !== 'delivered') updates.push('actual_delivery = NOW()');
            let updated = shipment;
            if (updates.length) {
                values.push(shipmentId);
                const result = await client.query(
                    `UPDATE shipments SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values
                );
                updated = result.rows[0];
            }
            const changed = data.status !== undefined && data.status !== shipment.status;
            const hasEvent = tracking || changed || data.location !== undefined || data.tracking_description !== undefined;
            const event = hasEvent ? await history(client, updated, data, changedBy) : null;
            if (changed) await syncOrder(client, order, changedBy);
            if (hasEvent || publicFields.some(field => data[field] !== undefined && String(data[field]) !== String(shipment[field]))) {
                await Notification.notifyShipmentUpdate(order.id, order.user_id, updated, client);
            }
            return tracking ? event : updated;
        });
    }

    static async addTrackingUpdate(shipmentId, vendorId, data, changedBy = null) {
        return this.updateShipment(shipmentId, vendorId, data, changedBy, true);
    }

    static async getShipmentsByOrderId(orderId, vendorId = null, userId = null) {
        if (!vendorId && !userId) return [];
        const { rows } = await pool.query(
            `SELECT s.*,
                COALESCE((SELECT json_agg(json_build_object('order_item_id', oi.id, 'product_id', oi.product_id,
                    'product_name', p.name, 'quantity', oi.quantity, 'variant_id', oi.variant_id) ORDER BY oi.id)
                 FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
                 WHERE oi.order_id = s.order_id AND oi.product_id IS NOT NULL
                   AND oi.vendor_id = s.vendor_id), '[]'::json) AS items,
                COALESCE((SELECT json_agg(json_build_object('id', h.id, 'status', h.status, 'location', h.location,
                    'description', h.description, 'created_at', h.created_at) ORDER BY h.created_at, h.id)
                 FROM shipment_tracking_history h WHERE h.shipment_id = s.id), '[]'::json) AS tracking_history
             FROM shipments s JOIN orders o ON o.id = s.order_id
             WHERE s.order_id = $1 AND ${vendorId ? 's.vendor_id = $2' : 'o.user_id = $2'} ORDER BY s.id`,
            [orderId, vendorId || userId]
        );
        return userId ? rows.map(({ notes, ...shipment }) => shipment) : rows;
    }

    static async getShipmentByOrderId(orderId, vendorId = null, userId = null) {
        const shipments = await this.getShipmentsByOrderId(orderId, vendorId, userId);
        // Preserve the old single-shipment response without silently hiding split shipments.
        if (shipments.length > 1) throw new CheckoutError('This order has multiple shipments; use the order shipments endpoint', 409);
        return shipments[0] ?? null;
    }

    static async getShipmentById(shipmentId, vendorId = null, userId = null) {
        if (!vendorId && !userId) return null;
        const { rows } = await pool.query(
            `SELECT s.* FROM shipments s JOIN orders o ON o.id = s.order_id
             WHERE s.id = $1 AND ${vendorId ? 's.vendor_id = $2' : 'o.user_id = $2'}`, [shipmentId, vendorId || userId]
        );
        if (!rows[0]) return null;
        if (userId) delete rows[0].notes;
        return rows[0];
    }

    static async getTrackingHistory(shipmentId, vendorId = null, userId = null) {
        if (!vendorId && !userId) return [];
        const { rows } = await pool.query(
            `SELECT h.id, h.shipment_id, h.status, h.location, h.description, h.created_at
             FROM shipment_tracking_history h JOIN shipments s ON s.id = h.shipment_id JOIN orders o ON o.id = s.order_id
             WHERE s.id = $1 AND ${vendorId ? 's.vendor_id = $2' : 'o.user_id = $2'} ORDER BY h.created_at ASC, h.id ASC`,
            [shipmentId, vendorId || userId]
        );
        return rows;
    }
}

export default Shipment;
