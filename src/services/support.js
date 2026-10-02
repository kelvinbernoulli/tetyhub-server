import Notification from '#models/notification.model.js';
import SupportTicketReply from '#models/support.ticket.replies.model.js';
import SupportTicket from '#models/support.tickets.model.js';
import { randomUUID } from 'node:crypto';
import pool from './pg_pool.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

// Only active platform staff with current support grants can receive assignments.
const staffQuery = `SELECT u.id, u.firstname, u.lastname FROM users u JOIN admins a ON a.user_id = u.id
    WHERE u.status::text = 'active' AND a.status::text = 'active' AND a.scope::text = 'platform'
    AND (u.role::text = 'super_admin' OR (u.role::text = 'admin' AND EXISTS (
        SELECT 1 FROM admin_permissions ap JOIN admin_types at ON at.id = ap.admin_type_id
        WHERE ap.admin_id = a.id AND at.slug = 'support' AND at.scope::text IN ('platform', 'both')
        AND at.status = true AND ap.status = true AND ap.can_read = true AND ap.can_update = true
        AND (ap.expires_at IS NULL OR ap.expires_at > NOW())
    )))`;

export async function getSupportAgents(client = pool) {
    return (await client.query(staffQuery)).rows;
}

async function notify(
    client,
    ticket,
    actor,
    title,
    { internal = false, assignment = false } = {}
) {
    const staff = await getSupportAgents(client);
    let recipients = actor.supportStaff
        ? internal
            ? []
            : [ticket.user_id]
        : ticket.assigned_to &&
            staff.some((user) => user.id === ticket.assigned_to)
          ? [ticket.assigned_to]
          : staff.map((user) => user.id);
    if (assignment && ticket.assigned_to) recipients.push(ticket.assigned_to);
    recipients = [...new Set(recipients)].filter(
        (id) => id && id !== actor.userId
    );
    if (!recipients.length) return;
    await Notification.createMany(recipients, 'support', title,
        `Ticket ${ticket.ticket_number} has an update.`,
        { ticket_id: ticket.id, ticket_number: ticket.ticket_number }, client);
}

async function transaction(work) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

export async function createTicketWithOpeningMessage(actor, data) {
    return transaction(async (client) => {
        const ticket = await SupportTicket.create(
            client,
            actor.vendorId ?? null,
            {
                ...data,
                ticketNumber: `SUP-${randomUUID()}`,
                userId: actor.userId,
            }
        );
        const reply = await SupportTicketReply.create(
            client,
            ticket.id,
            actor.userId,
            data.message,
            data.attachment
        );
        await notify(
            client,
            ticket,
            { ...actor, supportStaff: false },
            'New support ticket'
        );
        return { ...ticket, replies: [reply] };
    });
}

export async function getTicketById(
    ticketId,
    actor,
    client = pool,
    lock = false
) {
    const ticket = await SupportTicket.findById(ticketId, actor, client, lock);
    if (!ticket) throw fail('Ticket not found', 404);
    return ticket;
}

export function checkReplyAccess(actor, data) {
    if (data.is_internal && !actor.supportStaff)
        throw fail('Only support staff can add internal notes', 403);
}

export async function replyToTicket(ticketId, actor, data) {
    checkReplyAccess(actor, data);
    return transaction(async (client) => {
        const ticket = await getTicketById(ticketId, actor, client, true);
        if (ticket.status === 'closed')
            throw fail('Cannot reply to a closed ticket', 400);
        const reply = await SupportTicketReply.create(
            client,
            ticketId,
            actor.userId,
            data.message,
            data.attachment,
            data.is_internal ?? false
        );
        // Notes do not change the public conversation's status or activity time.
        if (!data.is_internal) {
            const status = actor.supportStaff ? 'waiting_on_user' : 'open';
            await SupportTicket.update(client, ticketId, { status });
            await notify(client, ticket, actor, 'New support reply');
        }
        return reply;
    });
}

export async function updateTicket(ticketId, actor, data) {
    if (
        !actor.supportStaff &&
        (Object.keys(data).some((key) => key !== 'status') ||
            !['open', 'resolved'].includes(data.status))
    ) {
        throw fail('You can only resolve or reopen your own ticket', 403);
    }
    return transaction(async (client) => {
        const existing = await getTicketById(ticketId, actor, client, true);
        if (Object.entries(data).every(([key, value]) => existing[key] === value)) return existing;
        if (data.assigned_to != null) {
            const staff = await getSupportAgents(client);
            if (!staff.some((user) => user.id === data.assigned_to))
                throw fail('Select an active support agent', 400);
        }
        const ticket = await SupportTicket.update(client, ticketId, data);
        await notify(client, ticket, actor, 'Support ticket updated', {
            assignment: data.assigned_to != null,
        });
        return ticket;
    });
}

export async function getTickets(actor, offset, limit, filters) {
    return SupportTicket.findAll(actor, offset, limit, filters);
}

export async function getTicketMessages(ticketId, actor, options) {
    await getTicketById(ticketId, actor);
    return SupportTicketReply.findByTicket(ticketId, actor, options);
}
