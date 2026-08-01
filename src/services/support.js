import SupportTicketReply from "#models/support.ticket.replies.model.js";
import SupportTicket from "#models/support.tickets.model.js";
import { generateTicketNumber } from "#utils/helpers.js";
import pool from "./pg_pool.js";

export async function createTicketWithOpeningMessage(vendorId, userId, data) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const ticket = await SupportTicket.create(client, vendorId, {
            ...data,
            ticketNumber: generateTicketNumber(),
            userId
        });

        const reply = await SupportTicketReply.create(
            client,
            ticket.id,
            userId,
            data.message,
            data.attachment
        );

        await client.query('COMMIT');

        return { ...ticket, replies: [reply] };

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function replyToTicket(ticketId, userId, message, attachment = null) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Verify ticket exists and is not closed
        const ticket = await SupportTicket.findById(ticketId);
        if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });
        if (ticket.status === 'closed') throw Object.assign(new Error('Cannot reply to a closed ticket'), { status: 400 });

        const reply = await SupportTicketReply.create(client, ticketId, userId, message, attachment);

        // Re-open ticket if it was resolved and customer replies
        if (ticket.status === 'resolved') {
            await SupportTicket.updateStatus(ticketId, 'open');
        }

        await client.query('COMMIT');

        return reply;

    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function getTickets(vendorId, offset, limit, filters) {
    return SupportTicket.findAll(vendorId, offset, limit, filters);
}

export async function getTicketById(ticketId, vendorId) {
    const ticket = await SupportTicket.findById(ticketId, vendorId);
    if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });
    return ticket;
}

export async function closeTicket(ticketId, vendorId) {
    const ticket = await SupportTicket.updateStatus(ticketId, 'closed', vendorId);
    if (!ticket) throw Object.assign(new Error('Ticket not found'), { status: 404 });
    return ticket;
}