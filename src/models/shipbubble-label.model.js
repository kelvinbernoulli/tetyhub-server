import pool from '#services/pg_pool.js';

class ShipbubbleLabel {
    static async getBookingIssues({ offset = 0, limit = 20 } = {}) {
        const where = `q.booking_status IN ('failed', 'needs_review')
            AND q.order_id IS NOT NULL
            AND o.payment_status = 'paid'`;
        const [countResult, result] = await Promise.all([
            pool.query(
                `SELECT COUNT(*)::int AS total
                 FROM shipbubble_rate_quotes q
                 JOIN orders o ON o.id = q.order_id
                 WHERE ${where}`
            ),
            pool.query(
                `SELECT q.id AS quote_id, q.order_id, o.order_number,
                        o.status AS order_status, o.payment_status,
                        q.vendor_id, q.package_group_key,
                        q.quote_data->>'category_id' AS shipbubble_category_id,
                        vs.store_name AS vendor_name,
                        q.courier_name, q.service_code, q.amount, q.currency,
                        q.booking_status, q.booking_attempts, q.booking_error,
                        q.created_at AS quote_created_at, q.booked_at,
                        s.id AS shipment_id, s.shipbubble_order_id,
                        s.tracking_number, s.tracking_url, s.waybill_document
                 FROM shipbubble_rate_quotes q
                 JOIN orders o ON o.id = q.order_id
                 LEFT JOIN vendor_settings vs ON vs.vendor_id = q.vendor_id
                 LEFT JOIN shipments s
                   ON s.order_id = q.order_id AND s.vendor_id = q.vendor_id
                   AND s.shipping_group_key IS NOT DISTINCT FROM q.package_group_key
                 WHERE ${where}
                 ORDER BY q.created_at ASC, q.id ASC
                 LIMIT $1 OFFSET $2`,
                [limit, offset]
            ),
        ]);
        return { rows: result.rows, total: countResult.rows[0]?.total ?? 0 };
    }
}

export default ShipbubbleLabel;
