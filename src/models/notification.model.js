import pool from '#services/pg_pool.js';

class Notification {
    // Pass the workflow's client so notifications commit or roll back with it.
    static async createNotification(
        userId,
        type,
        title,
        message,
        metadata = null,
        client = pool
    ) {
        const rows = await this.createMany(
            [userId],
            type,
            title,
            message,
            metadata,
            client
        );
        return rows[0] ?? null;
    }

    static async createMany(
        userIds,
        type,
        title,
        message,
        metadata = null,
        client = pool
    ) {
        const recipients = [...new Set(userIds)].filter(
            (id) => Number.isSafeInteger(id) && id > 0
        );
        if (!recipients.length) return [];
        const { rows } = await client.query(
            `INSERT INTO notifications (user_id, type, title, message, metadata)
             SELECT recipient, $2, $3, $4, $5 FROM unnest($1::integer[]) AS recipient
             RETURNING *`,
            [
                recipients,
                type,
                title,
                message,
                metadata == null ? null : JSON.stringify(metadata),
            ]
        );
        return rows;
    }

    static async getUserNotifications(
        userId,
        { offset = 0, limit = 20, unreadOnly = false, type, before } = {}
    ) {
        const values = [userId];
        const where = ['user_id = $1'];
        if (unreadOnly) where.push('read_at IS NULL');
        if (type) {
            values.push(type);
            where.push(`type = $${values.length}`);
        }
        if (before) {
            values.push(before);
            where.push(`id < $${values.length}`);
        }
        const { rows } = await pool.query(
            `SELECT * FROM notifications WHERE ${where.join(' AND ')}
             ORDER BY id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
            [
                ...values,
                Math.min(Math.max(Number(limit) || 20, 1), 100),
                Math.max(Number(offset) || 0, 0),
            ]
        );
        return rows;
    }

    static async getUserNotification(userId, notificationId) {
        const { rows } = await pool.query(
            'SELECT * FROM notifications WHERE user_id = $1 AND id = $2',
            [userId, notificationId]
        );
        return rows[0] ?? null;
    }

    static async markAsRead(notificationId, userId) {
        const { rows } = await pool.query(
            `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
             WHERE id = $1 AND user_id = $2 RETURNING *`,
            [notificationId, userId]
        );
        return rows[0] ?? null;
    }

    static async markAllAsRead(userId, throughId = null) {
        const { rows } = await pool.query(
            `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL
             AND ($2::integer IS NULL OR id <= $2) RETURNING id`,
            [userId, throughId]
        );
        return rows;
    }

    static async getUnreadCount(userId) {
        const { rows } = await pool.query(
            'SELECT COUNT(*)::integer AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL',
            [userId]
        );
        return Number(rows[0].count);
    }

    static async deleteNotification(notificationId, userId) {
        const { rows } = await pool.query(
            'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id',
            [notificationId, userId]
        );
        return rows[0] ?? null;
    }

    static async notifyOrderStatusChange(
        orderId,
        userId,
        oldStatus,
        newStatus,
        client = pool
    ) {
        if (oldStatus === newStatus) return;
        return this.createNotification(
            userId,
            'order_status',
            'Order updated',
            `Your order is now ${newStatus.replaceAll('_', ' ')}.`,
            { order_id: orderId, old_status: oldStatus, new_status: newStatus },
            client
        );
    }

    static async notifyShipmentUpdate(
        orderId,
        userId,
        shipment,
        client = pool
    ) {
        return this.createNotification(
            userId,
            'shipment_update',
            'Shipment updated',
            `Your shipment is ${shipment.status.replaceAll('_', ' ')}.${shipment.tracking_number ? ` Tracking: ${shipment.tracking_number}` : ''}`,
            {
                order_id: orderId,
                shipment_id: shipment.id,
                status: shipment.status,
                tracking_number: shipment.tracking_number,
                carrier: shipment.carrier,
                estimated_delivery: shipment.estimated_delivery,
            },
            client
        );
    }

    static async notifyReturnStatusUpdate(
        returnId,
        userId,
        status,
        client = pool
    ) {
        return this.createNotification(
            userId,
            'return_status',
            'Return updated',
            `Your return request is ${status.replaceAll('_', ' ')}.`,
            { return_id: returnId, status },
            client
        );
    }

    static async notifyRefundProcessed(orderId, userId, amount, client = pool) {
        return this.createNotification(
            userId,
            'refund',
            'Refund processed',
            'A refund has been processed for your order.',
            { order_id: orderId, amount },
            client
        );
    }
}

export default Notification;
