import pool from '#services/pg_pool.js';

export default class SupportTicket {
    static async create(client, vendorId, data) {
        const result = await client.query(
            `INSERT INTO support_tickets
                (subject, priority, status, vendor_id, ticket_number, user_id, category)
             VALUES ($1, $2, 'open', $3, $4, $5, $6) RETURNING *`,
            [
                data.subject,
                data.priority,
                vendorId,
                data.ticketNumber,
                data.userId,
                data.category,
            ]
        );
        return result.rows[0];
    }

    static async findById(ticketId, actor, client = pool, lock = false) {
        const result = await client.query(
            `SELECT * FROM support_tickets WHERE id = $1
             AND ($2::boolean OR user_id = $3) ${lock ? 'FOR UPDATE' : ''}`,
            [ticketId, actor.supportStaff, actor.userId]
        );
        return result.rows[0] ?? null;
    }

    static async findAll(actor, offset = 0, limit = 20, filters = {}) {
        const params = [actor.supportStaff, actor.userId];
        const where = ['($1::boolean OR t.user_id = $2)'];
        for (const field of ['status', 'priority', 'category', 'assigned_to']) {
            if (filters[field] !== undefined) {
                params.push(filters[field]);
                where.push(`t.${field} = $${params.length}`);
            }
        }
        if (filters.search) {
            params.push(`%${filters.search}%`);
            where.push(
                `(t.subject ILIKE $${params.length} OR t.ticket_number ILIKE $${params.length})`
            );
        }
        const [data, count] = await Promise.all([
            pool.query(
                `SELECT t.*, (SELECT COUNT(*)::integer FROM support_ticket_replies r
                    WHERE r.ticket_id = t.id AND ($1::boolean OR NOT r.is_internal)) AS reply_count
                 FROM support_tickets t WHERE ${where.join(' AND ')}
                 ORDER BY COALESCE(t.updated_at, t.created_at) DESC, t.id DESC
                 LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
                [...params, limit, offset]
            ),
            pool.query(
                `SELECT COUNT(*)::integer AS total FROM support_tickets t WHERE ${where.join(' AND ')}`,
                params
            ),
        ]);
        return { total: count.rows[0].total, limit, offset, rows: data.rows };
    }

    static async update(client, ticketId, data) {
        const fields = ['status', 'priority', 'assigned_to'].filter(
            (field) => data[field] !== undefined
        );
        const values = fields.map((field) => data[field]);
        const setters = fields.map(
            (field, index) => `${field} = $${index + 1}`
        );
        values.push(ticketId);
        const result = await client.query(
            `UPDATE support_tickets SET ${[...setters, 'updated_at = NOW()'].join(', ')}
             WHERE id = $${values.length} RETURNING *`,
            values
        );
        return result.rows[0];
    }
}
