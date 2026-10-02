import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/services/pg_pool.js';
import SupportTicket from '../src/models/support.tickets.model.js';
import SupportTicketReply from '../src/models/support.ticket.replies.model.js';
import {
    replyToTicket,
    updateTicket,
    createTicketWithOpeningMessage,
} from '../src/services/support.js';
import {
    supportTicketSchema,
    ticketReplySchema,
    ticketUpdateSchema,
} from '../src/schemas/support.tickets.schema.js';
import {
    getSupportTicket,
    replyToSupportTicket,
} from '../src/controllers/support.ticket.controller.js';

const owner = { userId: 1, role: 'customer', supportStaff: false };
const staff = { userId: 2, role: 'admin', supportStaff: true };
const ticket = {
    id: 10,
    user_id: 1,
    ticket_number: 'SUP-test',
    status: 'resolved',
    assigned_to: 2,
};
function database(t, handler = () => undefined) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        const result = handler(sql, values);
        if (result !== undefined) return result;
        if (sql.includes('SELECT u.id, u.firstname, u.lastname FROM users'))
            return { rows: [{ id: 2 }] };
        if (sql.includes('COUNT(*)::integer AS total'))
            return { rows: [{ total: 1 }] };
        if (sql.includes('INSERT INTO support_ticket_replies'))
            return { rows: [{ id: 4, is_internal: values[4] }] };
        return { rows: [ticket] };
    };
    t.mock.method(pool, 'query', query);
    t.mock.method(pool, 'connect', async () => ({
        query,
        release() {
            calls.push({ sql: 'RELEASE' });
        },
    }));
    return calls;
}

test('ticket and message validation reject blank content, forged attachments and invalid updates', () => {
    assert.ok(
        supportTicketSchema.validate({ subject: 'Help', message: '   ' }).error
    );
    assert.ok(ticketReplySchema.validate({ is_internal: true }).error);
    assert.ok(ticketReplySchema.validate({ message: '   ' }).error);
    assert.ok(
        ticketReplySchema.validate({ attachment: 'data:image/png;base64,YWJj' })
            .error
    );
    assert.ok(
        ticketReplySchema.validate({ message: 'Hi', is_internal: 'false' })
            .error
    );
    assert.ok(ticketUpdateSchema.validate({ status: 'deleted' }).error);
    assert.equal(
        ticketReplySchema.validate({
            attachment: 'data:application/pdf;base64,JVBERi0xLjQ=',
        }).error,
        undefined
    );
    assert.equal(
        supportTicketSchema.validate({
            subject: 'Help',
            message: 'Please help',
        }).value.category,
        'general'
    );
});

test('ticket reads and lists bind the user rather than the vendor', async (t) => {
    const calls = database(t);
    await SupportTicket.findById(10, { ...owner, vendorId: 99 });
    await SupportTicket.findAll(owner, 0, 20, {
        status: 'open',
        search: 'hello',
    });
    assert.deepEqual(calls[0].values, [10, false, 1]);
    assert.match(calls[0].sql, /user_id = \$3/);
    assert.deepEqual(calls[1].values, [false, 1, 'open', '%hello%', 20, 0]);
    assert.match(calls[1].sql, /NOT r.is_internal/);
});

test('chat history hides notes and uses a bounded, stable cursor', async (t) => {
    const calls = database(t, () => ({
        rows: [{ id: 11 }, { id: 12 }, { id: 13 }],
    }));
    const result = await SupportTicketReply.findByTicket(10, owner, {
        after: 9,
        limit: 2,
    });
    assert.deepEqual(result, {
        rows: [{ id: 11 }, { id: 12 }],
        has_more: true,
        next_cursor: 12,
    });
    assert.deepEqual(calls[0].values, [10, false, 1, 9, 3]);
    assert.match(calls[0].sql, /t.user_id = \$3 AND NOT r.is_internal/);
});

test('a reply to someone else ticket rolls back before writing', async (t) => {
    const calls = database(t, (sql) =>
        sql.includes('SELECT * FROM support_tickets') ? { rows: [] } : undefined
    );
    await assert.rejects(replyToTicket(10, owner, { message: 'Hello' }), {
        status: 404,
    });
    assert.ok(!calls.some(({ sql }) => sql.includes('INSERT')));
    assert.equal(calls.at(-2).sql, 'ROLLBACK');
    assert.equal(calls.at(-1).sql, 'RELEASE');
});

test('owner reply reopens a resolved ticket and notifies staff within the transaction', async (t) => {
    const calls = database(t);
    await replyToTicket(10, owner, { message: 'Still broken' });
    assert.match(calls[1].sql, /FOR UPDATE/);
    assert.ok(
        calls.some(
            ({ sql, values }) =>
                sql.includes('UPDATE support_tickets') && values[0] === 'open'
        )
    );
    assert.deepEqual(
        calls.find(({ sql }) => sql.includes('INSERT INTO notifications'))
            .values[0],
        [2]
    );
    assert.equal(calls.at(-2).sql, 'COMMIT');
});

test('staff public replies wait on the user and notify the owner', async (t) => {
    const calls = database(t);
    await replyToTicket(10, staff, { message: 'Please retry' });
    assert.ok(
        calls.some(
            ({ sql, values }) =>
                sql.includes('UPDATE support_tickets') &&
                values[0] === 'waiting_on_user'
        )
    );
    assert.deepEqual(
        calls.find(({ sql }) => sql.includes('INSERT INTO notifications'))
            .values[0],
        [1]
    );
});

test('internal notes stay private and do not alter public activity', async (t) => {
    const calls = database(t);
    await assert.rejects(
        replyToTicket(10, owner, { message: 'Note', is_internal: true }),
        { status: 403 }
    );
    assert.equal(calls.length, 0);
    await replyToTicket(10, staff, { message: 'Note', is_internal: true });
    assert.ok(
        !calls.some(
            ({ sql }) =>
                sql.includes('notifications') ||
                sql.includes('UPDATE support_tickets')
        )
    );
});

test('users cannot assign or progress tickets and staff cannot assign inactive agents', async (t) => {
    const calls = database(t);
    await assert.rejects(updateTicket(10, owner, { assigned_to: 2 }), {
        status: 403,
    });
    await assert.rejects(updateTicket(10, owner, { status: 'in_progress' }), {
        status: 403,
    });
    assert.equal(calls.length, 0);
    await assert.rejects(updateTicket(10, staff, { assigned_to: 999 }), {
        status: 400,
    });
    assert.ok(!calls.some(({ sql }) => sql.includes('UPDATE support_tickets')));
});

test('creation rolls back the ticket when its opening message fails', async (t) => {
    const calls = database(t, (sql) => {
        if (sql.includes('INSERT INTO support_ticket_replies'))
            throw new Error('write failed');
    });
    await assert.rejects(
        createTicketWithOpeningMessage(owner, {
            subject: 'Help',
            message: 'Hello',
            category: 'general',
            priority: 'medium',
        }),
        /write failed/
    );
    assert.equal(calls.at(-2).sql, 'ROLLBACK');
});

test('controllers return 400 for malformed IDs and 404 before uploading unauthorized replies', async (t) => {
    database(t, () => ({ rows: [] }));
    const res = {
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        },
    };
    await getSupportTicket(
        { auth: owner, params: { ticketId: '10oops' } },
        res
    );
    assert.equal(res.statusCode, 400);
    await replyToSupportTicket(
        { auth: owner, params: { ticketId: '10' }, body: { message: 'Hi' } },
        res
    );
    assert.equal(res.statusCode, 404);
});
