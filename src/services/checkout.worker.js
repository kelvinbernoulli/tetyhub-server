import { expireBookings } from '#models/booking.model.js';
import pool from './pg_pool.js';
import { expireReservations } from './checkout.service.js';
import { sendOrderConfirmationEmail } from '#models/mail.model.js';

export async function deliverCheckoutNotification() {
    // Atomic lease: network delivery does not hold a transaction/row lock open.
    const { rows } =
        await pool.query(`UPDATE checkout_notifications SET attempts = attempts + 1,
        available_at = NOW() + INTERVAL '5 minutes' WHERE id = (
            SELECT id FROM checkout_notifications WHERE delivered_at IS NULL AND available_at <= NOW()
            ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`);
    if (!rows.length) return;
    const notification = rows[0];
    const order = (
        await pool.query(
            `SELECT o.*, c.code AS currency FROM orders o LEFT JOIN currencies c ON c.id = o.currency_id WHERE o.id = $1`,
            [notification.order_id]
        )
    ).rows[0];
    if (
        order &&
        !['cancelled', 'payment_review', 'refunded'].includes(order.status) &&
        order.payment_status === 'paid'
    ) {
        order.items = (
            await pool.query(
                'SELECT * FROM order_items WHERE order_id = $1 ORDER BY id',
                [order.id]
            )
        ).rows;
        const user = (
            await pool.query(
                'SELECT firstname, email FROM users WHERE id = $1',
                [order.user_id]
            )
        ).rows[0];
        const sent = await sendOrderConfirmationEmail(
            { ...user, email: order.contact_email || user.email },
            order
        );
        if (!sent) throw new Error('Order email delivery failed');
    }
    await pool.query(
        'UPDATE checkout_notifications SET delivered_at = NOW() WHERE id = $1',
        [notification.id]
    );
}
export function startCheckoutWorker() {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        try {
            await expireReservations();
            await expireBookings();
            await deliverCheckoutNotification();
        } catch (error) {
            console.error('Checkout maintenance failed:', error.message);
        } finally {
            running = false;
        }
    };
    const timer = setInterval(run, 30000);
    timer.unref();
    return () => clearInterval(timer);
}
