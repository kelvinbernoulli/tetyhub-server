import pool from "#services/pg_pool.js";

export default class SupportTicket {

    // Pass client for transactional context, pool otherwise
    static async create(client, vendorId = null, data) {
        const { subject, priority, ticketNumber, userId, category } = data;

        const result = await client.query(
            `INSERT INTO support_tickets
                (subject, priority, status, vendor_id, ticket_number, user_id, category)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [subject, priority, 'open', vendorId, ticketNumber, userId, category]
        );

        return result.rows[0];
    }

    static async findById(ticketId, vendorId = null) {
        console.log('Finding ticket by ID:', { ticketId, vendorId });
        const conditions = [`t.id = $1`];
        const params     = [ticketId];

        if (vendorId) {
            conditions.push(`t.vendor_id = $2`);
            params.push(vendorId);
        }

        const result = await pool.query(
            `SELECT
                t.*,
                COALESCE(
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'id',          r.id,
                            'message',     r.message,
                            'attachment', r.attachment,
                            'user_id',     r.user_id,
                            'created_at',  r.created_at
                        ) ORDER BY r.created_at ASC
                    ) FILTER (WHERE r.id IS NOT NULL),
                    '[]'::json
                ) AS replies
             FROM support_tickets t
             LEFT JOIN support_ticket_replies r ON r.ticket_id = t.id
             WHERE ${conditions.join(' AND ')}
             GROUP BY t.id
             LIMIT 1`,
            params
        );

        return result.rows[0] ?? null;
    }

    static async findAll(vendorId, offset = 0, limit = 20, filters = {}) {
        const params  = [vendorId];
        const where   = [`t.vendor_id = $1`];
        let   index   = 2;

        if (filters.status) {
            where.push(`t.status = $${index++}`);
            params.push(filters.status);
        }

        if (filters.priority) {
            where.push(`t.priority = $${index++}`);
            params.push(filters.priority);
        }

        if (filters.search?.trim()) {
            where.push(`t.subject ILIKE $${index++}`);
            params.push(`%${filters.search.trim()}%`);
        }

        const safeLimit  = Math.min(Math.max(Number(limit)  || 20, 1), 100);
        const safeOffset = Math.max(Number(offset) || 0, 0);

        const [dataResult, countResult] = await Promise.all([
            pool.query(
                `SELECT t.*,
                    (SELECT COUNT(*) FROM support_ticket_replies r WHERE r.ticket_id = t.id) AS reply_count
                 FROM support_tickets t
                 WHERE ${where.join(' AND ')}
                 ORDER BY t.created_at DESC
                 LIMIT $${index++} OFFSET $${index++}`,
                [...params, safeLimit, safeOffset]
            ),
            pool.query(
                `SELECT COUNT(*)::INTEGER AS total
                 FROM support_tickets t
                 WHERE ${where.join(' AND ')}`,
                params
            ),
        ]);

        return {
            total:  countResult.rows[0].total,
            limit:  safeLimit,
            offset: safeOffset,
            rows:   dataResult.rows,
        };
    }

    static async updateStatus(ticketId, status, vendorId = null) {
        const conditions = [`id = $1`];
        const params     = [ticketId, status];

        if (vendorId) {
            conditions.push(`vendor_id = $3`);
            params.push(vendorId);
        }

        const result = await pool.query(
            `UPDATE support_tickets
             SET status = $2, updated_at = NOW()
             WHERE ${conditions.join(' AND ')}
             RETURNING *`,
            params
        );

        return result.rows[0] ?? null;
    }
}