import pool from "#services/pg_pool.js";

export default class SupportTicketReply {

    static async create(client, ticketId, userId, message, attachment = null) {
        const result = await client.query(
            `INSERT INTO support_ticket_replies
                (ticket_id, user_id, message, attachment)
             VALUES ($1, $2, $3, $4)
             RETURNING *`,
            [ticketId, userId, message, attachment ?? null]
        );

        return result.rows[0];
    }

    static async findByTicket(ticketId) {
        const result = await pool.query(
            `SELECT r.*, u.firstname, u.lastname, u.role
             FROM support_ticket_replies r
             JOIN users u ON u.id = r.user_id
             WHERE r.ticket_id = $1
             ORDER BY r.created_at ASC`,
            [ticketId]
        );

        return result.rows;
    }
}