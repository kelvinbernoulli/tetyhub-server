import pool from "#services/pg_pool.js";

class Notification {
    static async createNotification(userId, type, title, message, metadata = null) {
        try {
            const { rows } = await pool.query(
                `INSERT INTO notifications (user_id, type, title, message, metadata)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *`,
                [userId, type, title, message, metadata ? JSON.stringify(metadata) : null]
            );
            return rows[0];
        } catch (error) {
            console.error("Error creating notification:", error);
            throw error;
        }
    }

    static async getUserNotifications(userId, { offset = 0, limit = 20, unreadOnly = false }) {
        try {
            let query = `SELECT * FROM notifications WHERE user_id = $1`;
            const values = [userId];
            let paramIndex = 2;

            if (unreadOnly) {
                query += ` AND read_at IS NULL`;
            }

            query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
            values.push(limit, offset);

            const { rows } = await pool.query(query, values);
            return rows;
        } catch (error) {
            console.error("Error fetching notifications:", error);
            throw error;
        }
    }

    static async getUserNotification(userId, notificationId) {
        try {
            const { rows } = await pool.query(
                `SELECT * FROM notifications WHERE user_id = $1 AND id = $2`,
                [userId, notificationId]
            );
            return rows[0] ?? null;
        } catch (error) {
            console.error("Error fetching notification:", error);
            throw error;
        }
    }

    static async markAsRead(notificationId, userId) {
        try {
            const { rows } = await pool.query(
                `UPDATE notifications SET read_at = NOW()
                WHERE id = $1 AND user_id = $2 AND read_at IS NULL
                RETURNING *`,
                [notificationId, userId]
            );
            return rows[0] ?? null;
        } catch (error) {
            console.error("Error marking notification as read:", error);
            throw error;
        }
    }

    static async markAllAsRead(userId) {
        try {
            const { rows } = await pool.query(
                `UPDATE notifications SET read_at = NOW()
                WHERE user_id = $1 AND read_at IS NULL
                RETURNING *`,
                [userId]
            );
            return rows;
        } catch (error) {
            console.error("Error marking all notifications as read:", error);
            throw error;
        }
    }

    static async getUnreadCount(userId) {
        try {
            const { rows } = await pool.query(
                `SELECT COUNT(*) as count FROM notifications
                WHERE user_id = $1 AND read_at IS NULL`,
                [userId]
            );
            return parseInt(rows[0].count);
        } catch (error) {
            console.error("Error getting unread count:", error);
            throw error;
        }
    }

    // Order-related notifications
    static async notifyOrderStatusChange(orderId, userId, oldStatus, newStatus) {
        const statusMessages = {
            processing: { title: 'Order Processing Started', message: 'Your order is now being processed.' },
            awaiting_shipment: { title: 'Order Ready for Shipment', message: 'Your order is being prepared for shipment.' },
            packed: { title: 'Order Packed', message: 'Your order has been packed and is ready for shipping.' },
            shipped: { title: 'Order Shipped', message: 'Your order has been shipped and is on its way.' },
            out_for_delivery: { title: 'Out for Delivery', message: 'Your order is out for delivery.' },
            delivered: { title: 'Order Delivered', message: 'Your order has been successfully delivered.' },
            cancelled: { title: 'Order Cancelled', message: 'Your order has been cancelled.' },
            returned: { title: 'Return Request Submitted', message: 'Your return request has been submitted.' },
            refunded: { title: 'Refund Processed', message: 'Your refund has been processed successfully.' }
        };

        const notification = statusMessages[newStatus];
        if (notification) {
            return await Notification.createNotification(
                userId,
                'order_status',
                notification.title,
                notification.message,
                { order_id: orderId, old_status: oldStatus, new_status: newStatus }
            );
        }
    }

    static async notifyShipmentUpdate(orderId, userId, shipmentData) {
        return await Notification.createNotification(
            userId,
            'shipment_update',
            'Shipment Update',
            `Your order shipment has been updated. Tracking: ${shipmentData.tracking_number}`,
            { order_id: orderId, shipment: shipmentData }
        );
    }

    static async notifyReturnStatusUpdate(returnId, userId, status) {
        const statusMessages = {
            approved: { title: 'Return Approved', message: 'Your return request has been approved.' },
            rejected: { title: 'Return Rejected', message: 'Your return request has been rejected.' },
            received: { title: 'Return Received', message: 'Your return has been received and is being processed.' }
        };

        const notification = statusMessages[status];
        if (notification) {
            return await this.createNotification(
                userId,
                'return_status',
                notification.title,
                notification.message,
                { return_id: returnId, status }
            );
        }
    }

    static async notifyRefundProcessed(orderId, userId, amount) {
        return await Notification.createNotification(
            userId,
            'refund',
            'Refund Processed',
            `A refund of ₦${amount} has been processed for your order.`,
            { order_id: orderId, amount }
        );
    }
}

export default Notification;