import pool from '#services/pg_pool.js';
import { sendShipmentStatusEmail } from '#models/mail.model.js';

export async function emailShipmentUpdate(orderId, shipment, description = null) {
    try {
        const { rows } = await pool.query(
            `SELECT o.order_number, COALESCE(o.contact_email, u.email) AS email,
                    sa.firstname
             FROM orders o
             JOIN users u ON u.id = o.user_id
             LEFT JOIN shipping_addresses sa ON sa.order_id = o.id
             WHERE o.id = $1
             LIMIT 1`,
            [orderId]
        );
        const recipient = rows[0];
        if (!recipient?.email) return false;

        return await sendShipmentStatusEmail(
            { email: recipient.email, firstname: recipient.firstname },
            recipient.order_number,
            shipment,
            description
        );
    } catch (error) {
        console.error('Could not prepare shipment status email:', error.message);
        return false;
    }
}
