import pool from '#services/pg_pool.js';

const PUBLIC_SERVICE_FILTER = `
    s.status = 'active'
    AND s.deleted_at IS NULL
    AND v.status = 'active'
    AND c.status = true
`;

export default class ServiceBookmark {
    static async add(userId, serviceId) {
        const { rows: services } = await pool.query(
            `SELECT s.id FROM services s
             JOIN vendors v ON v.id = s.vendor_id
             JOIN currencies c ON c.id = s.currency_id
             WHERE s.id = $1 AND ${PUBLIC_SERVICE_FILTER}`,
            [serviceId]
        );
        if (!services.length) return null;

        const { rows } = await pool.query(
            `INSERT INTO service_bookmarks (user_id, service_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, service_id) DO NOTHING
             RETURNING id, user_id, service_id, created_at`,
            [userId, serviceId]
        );
        if (!rows.length) {
            return { error: 'Service is already bookmarked', code: 409 };
        }
        return rows[0] ?? null;
    }

    static async findAll(userId, { offset = 0, limit = 20 } = {}) {
        const [bookmarks, count] = await Promise.all([
            pool.query(
                `SELECT sb.id AS bookmark_id, sb.created_at AS bookmarked_at,
                        s.id AS service_id, s.name, s.slug, s.short_description,
                        s.description, s.base_price, s.compare_at_price,
                        s.duration_mins, s.thumbnail, s.images, s.tags,
                        s.is_remote, s.location_type,
                        c.code AS currency, c.name AS currency_name,
                        v.id AS vendor_id, vs.store_name AS vendor_name
                 FROM service_bookmarks sb
                 JOIN services s ON s.id = sb.service_id
                 JOIN vendors v ON v.id = s.vendor_id
                 JOIN currencies c ON c.id = s.currency_id
                 LEFT JOIN vendor_settings vs ON vs.vendor_id = s.vendor_id
                 WHERE sb.user_id = $1 AND ${PUBLIC_SERVICE_FILTER}
                 ORDER BY sb.created_at DESC, sb.id DESC
                 LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            ),
            pool.query(
                `SELECT COUNT(*)::integer AS total
                 FROM service_bookmarks sb
                 JOIN services s ON s.id = sb.service_id
                 JOIN vendors v ON v.id = s.vendor_id
                 JOIN currencies c ON c.id = s.currency_id
                 WHERE sb.user_id = $1 AND ${PUBLIC_SERVICE_FILTER}`,
                [userId]
            ),
        ]);

        return {
            items: bookmarks.rows,
            pagination: {
                offset,
                limit,
                total: count.rows[0].total,
            },
        };
    }

    static async remove(userId, serviceId) {
        const { rows } = await pool.query(
            `DELETE FROM service_bookmarks
             WHERE user_id = $1 AND service_id = $2
             RETURNING id, user_id, service_id, created_at`,
            [userId, serviceId]
        );
        return rows[0] ?? null;
    }
}
