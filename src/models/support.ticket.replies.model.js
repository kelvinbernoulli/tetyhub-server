import pool from '#services/pg_pool.js';

export default class SupportTicketReply {
    static async create(
        client,
        ticketId,
        userId,
        message,
        attachment = null,
        isInternal = false
    ) {
        const result = await client.query(
            `INSERT INTO support_ticket_replies (ticket_id, user_id, message, attachment, is_internal)
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [ticketId, userId, message ?? '', attachment, isInternal]
        );
        return result.rows[0];
    }

    static async findByTicket(ticketId, actor, { after = 0, limit = 50 } = {}) {
        const result = await pool.query(
            `SELECT r.*, u.firstname, u.lastname, u.role
             FROM support_ticket_replies r JOIN users u ON u.id = r.user_id
             JOIN support_tickets t ON t.id = r.ticket_id
             WHERE r.ticket_id = $1 AND ($2::boolean OR (t.user_id = $3 AND NOT r.is_internal))
             AND r.id > $4 ORDER BY r.id ASC LIMIT $5`,
            [ticketId, actor.supportStaff, actor.userId, after, limit + 1]
        );
        const rows = result.rows.slice(0, limit);
        return {
            rows,
            has_more: result.rows.length > limit,
            next_cursor: rows.at(-1)?.id ?? after,
        };
    }
}
