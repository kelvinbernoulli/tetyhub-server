import pool from "#services/pg_pool.js";
import Notification from "#models/notification.model.js";

class Shipment {
    static async createShipment(orderId, vendorId, shipmentData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verify order belongs to vendor and is in correct status
            const { rows: orderRows } = await client.query(
                `SELECT * FROM orders WHERE id = $1 AND vendor_id = $2`,
                [orderId, vendorId]
            );

            if (orderRows.length === 0) {
                return { error: 'Order not found', code: 404 };
            }

            const order = orderRows[0];
            if (!['processing', 'awaiting_shipment', 'packed'].includes(order.status)) {
                return {
                    error: `Cannot create shipment for order with status: ${order.status}`,
                    code: 422
                };
            }

            // 2. Check if shipment already exists
            const { rows: existingShipment } = await client.query(
                `SELECT id FROM shipments WHERE order_id = $1`,
                [orderId]
            );

            if (existingShipment.length > 0) {
                return { error: 'Shipment already exists for this order', code: 409 };
            }

            // 3. Create shipment
            const { rows: shipmentRows } = await client.query(
                `INSERT INTO shipments
                (order_id, tracking_number, carrier, shipping_method, estimated_delivery, shipping_cost, status, notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *`,
                [
                    orderId,
                    shipmentData.tracking_number,
                    shipmentData.carrier,
                    shipmentData.shipping_method ?? null,
                    shipmentData.estimated_delivery ?? null,
                    shipmentData.shipping_cost ?? 0,
                    'pending',
                    shipmentData.notes ?? null
                ]
            );

            const shipment = shipmentRows[0];

            // 4. Insert initial tracking history
            await client.query(
                `INSERT INTO shipment_tracking_history
                (shipment_id, status, location, description)
                VALUES ($1, $2, $3, $4)`,
                [
                    shipment.id,
                    'pending',
                    shipmentData.location ?? null,
                    'Shipment created and pending processing'
                ]
            );

            // 5. Update order status to awaiting_shipment if not already packed
            if (order.status === 'processing') {
                await client.query(
                    `UPDATE orders SET status = 'awaiting_shipment', updated_at = NOW() WHERE id = $1`,
                    [orderId]
                );

                // Send notification for status change
                try {
                    await Notification.notifyOrderStatusChange(orderId, order.user_id, order.status, 'awaiting_shipment');
                } catch (notificationError) {
                    console.error("Error sending shipment notification:", notificationError);
                }
            }

            await client.query('COMMIT');

            // Send shipment notification
            try {
                await Notification.notifyShipmentUpdate(orderId, order.user_id, shipment);
            } catch (notificationError) {
                console.error("Error sending shipment notification:", notificationError);
            }

            return shipment;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error creating shipment:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async updateShipment(shipmentId, vendorId, updateData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verify shipment belongs to vendor
            const { rows: shipmentRows } = await client.query(
                `SELECT s.*, o.vendor_id FROM shipments s
                JOIN orders o ON o.id = s.order_id
                WHERE s.id = $1 AND o.vendor_id = $2`,
                [shipmentId, vendorId]
            );

            if (shipmentRows.length === 0) {
                return { error: 'Shipment not found', code: 404 };
            }

            const shipment = shipmentRows[0];

            // 2. Update shipment
            const updateFields = [];
            const values = [];
            let paramIndex = 1;

            if (updateData.tracking_number !== undefined) {
                updateFields.push(`tracking_number = $${paramIndex++}`);
                values.push(updateData.tracking_number);
            }
            if (updateData.carrier !== undefined) {
                updateFields.push(`carrier = $${paramIndex++}`);
                values.push(updateData.carrier);
            }
            if (updateData.shipping_method !== undefined) {
                updateFields.push(`shipping_method = $${paramIndex++}`);
                values.push(updateData.shipping_method);
            }
            if (updateData.estimated_delivery !== undefined) {
                updateFields.push(`estimated_delivery = $${paramIndex++}`);
                values.push(updateData.estimated_delivery);
            }
            if (updateData.shipping_cost !== undefined) {
                updateFields.push(`shipping_cost = $${paramIndex++}`);
                values.push(updateData.shipping_cost);
            }
            if (updateData.status !== undefined) {
                updateFields.push(`status = $${paramIndex++}`);
                values.push(updateData.status);
            }
            if (updateData.notes !== undefined) {
                updateFields.push(`notes = $${paramIndex++}`);
                values.push(updateData.notes);
            }

            if (updateFields.length === 0) {
                return shipment;
            }

            updateFields.push(`updated_at = NOW()`);
            values.push(shipmentId);

            const { rows: updatedRows } = await client.query(
                `UPDATE shipments SET ${updateFields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
                values
            );

            const updatedShipment = updatedRows[0];

            // 4. Insert tracking history if status changed
            if (updateData.status && updateData.status !== shipment.status) {
                await client.query(
                    `INSERT INTO shipment_tracking_history
                    (shipment_id, status, location, description)
                    VALUES ($1, $2, $3, $4)`,
                    [
                        shipmentId,
                        updateData.status,
                        updateData.location ?? null,
                        updateData.tracking_description ?? `Status updated to ${updateData.status}`
                    ]
                );
            }

            // 5. Update order status based on shipment status
            if (updateData.status) {
                let newOrderStatus = null;

                switch (updateData.status) {
                    case 'shipped':
                        newOrderStatus = 'shipped';
                        break;
                    case 'in_transit':
                        newOrderStatus = 'out_for_delivery';
                        break;
                    case 'delivered':
                        newOrderStatus = 'delivered';
                        break;
                }

                if (newOrderStatus) {
                    await client.query(
                        `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
                        [newOrderStatus, shipment.order_id]
                    );

                    // Send notification for order status change
                    try {
                        const { rows: orderRows } = await client.query(
                            `SELECT user_id FROM orders WHERE id = $1`,
                            [shipment.order_id]
                        );
                        if (orderRows.length > 0) {
                            await Notification.notifyOrderStatusChange(
                                shipment.order_id,
                                orderRows[0].user_id,
                                null, // We don't have old status here
                                newOrderStatus
                            );
                        }
                    } catch (notificationError) {
                        console.error("Error sending order status notification:", notificationError);
                    }
                }
            }

            await client.query('COMMIT');

            // Send shipment update notification
            try {
                const { rows: orderRows } = await client.query(
                    `SELECT user_id FROM orders WHERE id = $1`,
                    [shipment.order_id]
                );
                if (orderRows.length > 0) {
                    await Notification.notifyShipmentUpdate(shipment.order_id, orderRows[0].user_id, updatedShipment);
                }
            } catch (notificationError) {
                console.error("Error sending shipment update notification:", notificationError);
            }

            return updatedShipment;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error updating shipment:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async getShipmentByOrderId(orderId, vendorId = null) {
        try {
            let query = `SELECT * FROM shipments WHERE order_id = $1`;
            const values = [orderId];

            if (vendorId) {
                query += ` AND EXISTS (SELECT 1 FROM orders o WHERE o.id = $2 AND o.vendor_id = $3)`;
                values.push(orderId, vendorId);
            }

            const { rows } = await pool.query(query, values);
            return rows[0] ?? null;
        } catch (error) {
            console.error("Error fetching shipment:", error);
            throw error;
        }
    }

    static async getShipmentById(shipmentId, vendorId = null) {
        try {
            let query = `SELECT s.* FROM shipments s`;
            const values = [shipmentId];
            let paramIndex = 2;

            if (vendorId) {
                query += ` JOIN orders o ON o.id = s.order_id WHERE s.id = $1 AND o.vendor_id = $${paramIndex++}`;
                values.push(vendorId);
            } else {
                query += ` WHERE s.id = $1`;
            }

            const { rows } = await pool.query(query, values);
            return rows[0] ?? null;
        } catch (error) {
            console.error("Error fetching shipment:", error);
            throw error;
        }
    }

    static async getTrackingHistory(shipmentId, vendorId = null) {
        try {
            let query = `
                SELECT sth.*
                FROM shipment_tracking_history sth
                JOIN shipments s ON s.id = sth.shipment_id
            `;
            const values = [shipmentId];
            let paramIndex = 2;

            if (vendorId) {
                query += ` JOIN orders o ON o.id = s.order_id WHERE sth.shipment_id = $1 AND o.vendor_id = $${paramIndex++}`;
                values.push(vendorId);
            } else {
                query += ` WHERE sth.shipment_id = $1`;
            }

            query += ` ORDER BY sth.created_at DESC`;

            const { rows } = await pool.query(query, values);
            return rows;
        } catch (error) {
            console.error("Error fetching tracking history:", error);
            throw error;
        }
    }

    static async addTrackingUpdate(shipmentId, vendorId, trackingData) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verify shipment belongs to vendor
            const { rows: shipmentRows } = await client.query(
                `SELECT s.id FROM shipments s
                JOIN orders o ON o.id = s.order_id
                WHERE s.id = $1 AND o.vendor_id = $2`,
                [shipmentId, vendorId]
            );

            if (shipmentRows.length === 0) {
                return { error: 'Shipment not found', code: 404 };
            }

            // Insert tracking history
            const { rows: historyRows } = await client.query(
                `INSERT INTO shipment_tracking_history
                (shipment_id, status, location, description)
                VALUES ($1, $2, $3, $4)
                RETURNING *`,
                [
                    shipmentId,
                    trackingData.status,
                    trackingData.location ?? null,
                    trackingData.description ?? null
                ]
            );

            // Update shipment status if provided
            if (trackingData.status) {
                await client.query(
                    `UPDATE shipments SET status = $1, updated_at = NOW() WHERE id = $2`,
                    [trackingData.status, shipmentId]
                );
            }

            await client.query('COMMIT');
            return historyRows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error adding tracking update:", error);
            throw error;
        } finally {
            client.release();
        }
    }
}

export default Shipment;