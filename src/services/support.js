import Notification from '#models/notification.model.js';
import SupportTicketReply from '#models/support.ticket.replies.model.js';
import SupportTicket from '#models/support.tickets.model.js';
import { randomInt } from 'crypto';
import pool from './pg_pool.js';

const fail = (message, status) => Object.assign(new Error(message), { status });

const VALID_TICKET_STATUSES = new Set([
    'open',
    'in_progress',
    'waiting_on_user',
    'resolved',
]);

const VALID_STATUS_TRANSITIONS = {
    open: new Set(['open', 'in_progress', 'waiting_on_user', 'resolved']),
    in_progress: new Set(['open', 'in_progress', 'waiting_on_user', 'resolved']),
    waiting_on_user: new Set(['open', 'in_progress', 'waiting_on_user', 'resolved']),
    resolved: new Set(['open', 'in_progress', 'waiting_on_user', 'resolved']),
};

const assertValidStatusTransition = (currentStatus, nextStatus) => {
    if (!VALID_TICKET_STATUSES.has(currentStatus)) return;
    if (nextStatus === undefined) return;
    if (!VALID_TICKET_STATUSES.has(nextStatus)) {
        throw fail(`Unsupported ticket status: ${nextStatus}`, 400);
    }
    if (
        !VALID_STATUS_TRANSITIONS[currentStatus]?.has(nextStatus) &&
        currentStatus !== nextStatus
    ) {
        throw fail(
            `Cannot change ticket status from ${currentStatus} to ${nextStatus}`,
            400
        );
    }
};

// Only active platform staff with current support grants can receive assignments.
const staffQuery = `SELECT u.id, u.firstname, u.lastname FROM users u JOIN admins a ON a.user_id = u.id
    WHERE u.status::text = 'active' AND a.status::text = 'active' AND a.scope::text = 'platform'
    AND (u.role::text = 'super_admin' OR (u.role::text = 'admin' AND EXISTS (
        SELECT 1 FROM admin_permissions ap JOIN admin_types at ON at.id = ap.admin_type_id
        WHERE ap.admin_id = a.id AND at.slug = 'support' AND at.scope::text IN ('platform', 'both')
        AND at.status = true AND ap.status = true AND ap.can_read = true AND ap.can_update = true
        AND (ap.expires_at IS NULL OR ap.expires_at > NOW())
    )))`;

const leastLoadedStaffQuery = `SELECT staff.id FROM (${staffQuery}) staff
    ORDER BY (
        SELECT COUNT(*) FROM support_tickets t
        WHERE t.assigned_to = staff.id
            AND t.status::text IN ('open', 'in_progress', 'waiting_on_user')
    ), staff.id
    LIMIT 1`;

const SUPPORT_ASSIGNMENT_LOCK_NAMESPACE = 736251;
const SUPPORT_ASSIGNMENT_LOCK_ID = 1;

export async function getSupportAgents(client = pool) {
    return (await client.query(staffQuery)).rows;
}

function generateTicketNumber() {
    const now = new Date();
    const pad = (n, len = 2) => String(n).padStart(len, '0');

    const timestamp =
        now.getFullYear() +
        pad(now.getMonth() + 1) +
        pad(now.getDate()) +
        pad(now.getHours()) +
        pad(now.getMinutes()) +
        pad(now.getSeconds()) +
        pad(now.getMilliseconds(), 3);

    const random = randomInt(0, 1000000).toString().padStart(6, '0');

    return `TICKET-${timestamp}-${random}`;
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
        // Serialize assignment selection so concurrent ticket creates see current workloads.
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', [
            SUPPORT_ASSIGNMENT_LOCK_NAMESPACE,
            SUPPORT_ASSIGNMENT_LOCK_ID,
        ]);
        const assignee = (await client.query(leastLoadedStaffQuery)).rows[0];
        const ticket = await SupportTicket.create(
            client,
            actor.vendorId ?? null,
            {
                ...data,
                ticketNumber: generateTicketNumber(),
                userId: actor.userId,
                assignedTo: assignee?.id ?? null,
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

async function notifyTransferParticipants(
    client,
    ticket,
    userIds,
    title,
    message,
    transfer
) {
    await Notification.createMany(
        userIds,
        'support',
        title,
        message,
        {
            ticket_id: ticket.id,
            ticket_number: ticket.ticket_number,
            transfer,
        },
        client
    );
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

function assertReplyPermission(actor, ticket) {
    if (!actor.supportStaff) return;
    if (actor.role === 'super_admin') return;
    if (ticket.assigned_to == null) {
        throw fail(
            'Only the assigned support agent or a super admin can reply to this ticket',
            403
        );
    }
    if (ticket.assigned_to !== actor.userId) {
        throw fail(
            'Only the assigned support agent or a super admin can reply to this ticket',
            403
        );
    }
}

export async function replyToTicket(ticketId, actor, data) {
    checkReplyAccess(actor, data);
    return transaction(async (client) => {
        const ticket = await getTicketById(ticketId, actor, client, true);
        assertReplyPermission(actor, ticket);
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
            assertValidStatusTransition(ticket.status, status);
            await SupportTicket.update(client, ticketId, { status });
            await notify(client, ticket, actor, 'New support reply');
        }
        return reply;
    });
}

export async function requestTicketTransfer(ticketId, actor, data) {
    if (!actor.supportStaff) {
        throw fail('Only support staff can transfer tickets', 403);
    }
    return transaction(async (client) => {
        const ticket = await getTicketById(ticketId, actor, client, true);
        if (Number(ticket.assigned_to) !== actor.userId) {
            throw fail('Only the current assignee can request a ticket transfer', 403);
        }
        if (!['open', 'in_progress', 'waiting_on_user'].includes(ticket.status)) {
            throw fail('Only unresolved tickets can be transferred', 400);
        }
        if (ticket.pending_assigned_to != null) {
            throw fail(
                'This ticket already has a pending transfer request',
                409
            );
        }
        if (Number(ticket.assigned_to) === data.assigned_to) {
            throw fail('Select a different support agent', 400);
        }

        const staff = await getSupportAgents(client);
        if (!staff.some((user) => Number(user.id) === data.assigned_to)) {
            throw fail('Select an active support agent', 400);
        }

        const updated = await SupportTicket.update(client, ticketId, {
            pending_assigned_to: data.assigned_to,
            transfer_requested_by: actor.userId,
            transfer_requested_at: new Date(),
        });
        await notifyTransferParticipants(
            client,
            updated,
            [data.assigned_to],
            'Ticket transfer requested',
            `You have been asked to take over ticket ${ticket.ticket_number}.`,
            {
                status: 'pending',
                from_user_id: actor.userId,
                to_user_id: data.assigned_to,
            }
        );
        return updated;
    });
}

export async function respondToTicketTransfer(ticketId, actor, data) {
    if (!actor.supportStaff) {
        throw fail('Only support staff can respond to ticket transfers', 403);
    }
    return transaction(async (client) => {
        const ticket = await getTicketById(ticketId, actor, client, true);
        if (
            ticket.pending_assigned_to == null ||
            Number(ticket.pending_assigned_to) !== actor.userId
        ) {
            throw fail('No pending transfer request is assigned to you', 403);
        }

        const requesterId = Number(ticket.transfer_requested_by);
        const transfer = {
            status: data.decision === 'accept' ? 'accepted' : 'declined',
            from_user_id: Number(ticket.assigned_to),
            to_user_id: actor.userId,
        };
        let updated;
        if (data.decision === 'accept') {
            const staff = await getSupportAgents(client);
            if (!staff.some((user) => Number(user.id) === actor.userId)) {
                throw fail(
                    'You are no longer eligible to receive support tickets',
                    403
                );
            }
            updated = await SupportTicket.update(client, ticketId, {
                assigned_to: actor.userId,
                pending_assigned_to: null,
                transfer_requested_by: null,
                transfer_requested_at: null,
            });
            await notifyTransferParticipants(
                client,
                updated,
                [requesterId, ticket.user_id],
                'Ticket transfer accepted',
                `Ticket ${ticket.ticket_number} has been accepted by the new assignee.`,
                transfer
            );
        } else {
            updated = await SupportTicket.update(client, ticketId, {
                pending_assigned_to: null,
                transfer_requested_by: null,
                transfer_requested_at: null,
            });
            await notifyTransferParticipants(
                client,
                updated,
                [requesterId],
                'Ticket transfer declined',
                `The transfer request for ticket ${ticket.ticket_number} was declined. You remain the assignee.`,
                transfer
            );
        }
        return updated;
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
        if (data.assigned_to !== undefined && actor.role !== 'super_admin') {
            throw fail(
                'Only a super admin can directly reassign a ticket; request a transfer instead',
                403
            );
        }
        const cancelsTransfer =
            data.assigned_to !== undefined ||
            (data.status === 'resolved' &&
                existing.pending_assigned_to != null);
        const updateData = cancelsTransfer
            ? {
                  ...data,
                  pending_assigned_to: null,
                  transfer_requested_by: null,
                  transfer_requested_at: null,
              }
            : data;
        if (
            Object.entries(updateData).every(
                ([key, value]) => existing[key] === value
            )
        ) {
            return existing;
        }
        if (data.status !== undefined) {
            assertValidStatusTransition(existing.status, data.status);
        }
        if (data.assigned_to != null) {
            const staff = await getSupportAgents(client);
            if (!staff.some((user) => user.id === data.assigned_to))
                throw fail('Select an active support agent', 400);
        }
        const ticket = await SupportTicket.update(client, ticketId, updateData);
        if (data.assigned_to !== undefined) {
            const recipients = [
                existing.assigned_to,
                existing.pending_assigned_to,
            ].filter(
                (id) =>
                    id != null &&
                    Number(id) !== Number(data.assigned_to) &&
                    Number(id) !== Number(actor.userId)
            );
            await notify(client, ticket, actor, 'Support ticket reassigned', {
                assignment: data.assigned_to != null,
            });
            await notifyTransferParticipants(
                client,
                ticket,
                recipients,
                'Ticket assignment changed',
                `A super admin changed the assignment for ticket ${ticket.ticket_number}.`,
                {
                    status: 'overridden',
                    from_user_id: existing.assigned_to,
                    to_user_id: data.assigned_to,
                }
            );
        } else {
            await notify(client, ticket, actor, 'Support ticket updated');
            if (
                data.status === 'resolved' &&
                existing.pending_assigned_to != null
            ) {
                await notifyTransferParticipants(
                    client,
                    ticket,
                    [
                        existing.pending_assigned_to,
                        existing.transfer_requested_by,
                    ],
                    'Ticket transfer cancelled',
                    `The pending transfer for resolved ticket ${ticket.ticket_number} was cancelled.`,
                    {
                        status: 'cancelled',
                        from_user_id: existing.assigned_to,
                        to_user_id: existing.pending_assigned_to,
                    }
                );
            }
        }
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
