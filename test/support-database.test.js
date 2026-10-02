import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import pool from '../src/services/pg_pool.js';
import {
    createTicketWithOpeningMessage,
    replyToTicket,
    getTicketById,
    getTicketMessages,
    getTickets,
    updateTicket,
} from '../src/services/support.js';

const connectionString = process.env.SUPPORT_DATABASE_URL;
test(
    'PostgreSQL support migration, ownership, notes, assignment and notifications',
    { skip: !connectionString, timeout: 60000 },
    async (t) => {
        const namespace = `support_test_${randomUUID().replaceAll('-', '')}`;
        const admin = new Pool({
            connectionString,
            connectionTimeoutMillis: 5000,
        });
        const db = new Pool({
            connectionString,
            options: `-c search_path=${namespace}`,
            connectionTimeoutMillis: 5000,
        });
        try {
            await admin.query(`CREATE SCHEMA "${namespace}"`);
            await db.query(`
            CREATE TABLE users (id SERIAL PRIMARY KEY, firstname TEXT, lastname TEXT, role TEXT, status TEXT DEFAULT 'active');
            CREATE TABLE admins (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), scope TEXT, status TEXT);
            CREATE TABLE admin_types (id SERIAL PRIMARY KEY, slug TEXT, scope TEXT, status BOOLEAN);
            CREATE TABLE admin_permissions (admin_id INTEGER, admin_type_id INTEGER, status BOOLEAN, can_read BOOLEAN, can_update BOOLEAN, expires_at TIMESTAMP);
            CREATE TABLE support_tickets (id SERIAL PRIMARY KEY, ticket_number TEXT UNIQUE, subject TEXT, priority TEXT DEFAULT 'normal', status TEXT DEFAULT 'open', user_id INTEGER REFERENCES users(id), vendor_id INTEGER, category TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP);
            CREATE TABLE support_ticket_replies (id SERIAL PRIMARY KEY, ticket_id INTEGER REFERENCES support_tickets(id), user_id INTEGER REFERENCES users(id), message TEXT NOT NULL, attachment TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP);
            CREATE TABLE notifications (id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id), type TEXT, title TEXT, message TEXT, metadata TEXT);
            INSERT INTO users (firstname, role) VALUES ('Owner','customer'), ('Other','customer'), ('Agent','admin');
            INSERT INTO admins (user_id, scope, status) VALUES (3, 'platform', 'active');
            INSERT INTO admin_types (slug, scope, status) VALUES ('support', 'both', true);
            INSERT INTO admin_permissions VALUES (1,1,true,true,true,NULL);
            INSERT INTO support_tickets (ticket_number, subject, priority, status, category, user_id) VALUES ('legacy','Legacy','normal','closed','external',1);
        `);
            await db.query(
                await readFile(
                    new URL(
                        '../prisma/migrations/20260924120000_support_ticket_chat/migration.sql',
                        import.meta.url
                    ),
                    'utf8'
                )
            );
            const legacy = (
                await db.query('SELECT * FROM support_tickets WHERE id = 1')
            ).rows[0];
            assert.equal(legacy.priority, 'medium');
            assert.equal(legacy.status, 'resolved');
            assert.equal(legacy.category, 'general');
            t.mock.method(pool, 'query', (...args) => db.query(...args));
            t.mock.method(pool, 'connect', () => db.connect());
            const owner = { userId: 1, supportStaff: false };
            const other = { userId: 2, supportStaff: false };
            const staff = { userId: 3, supportStaff: true };
            const ticket = await createTicketWithOpeningMessage(owner, {
                subject: 'Help me',
                message: 'Opening message',
                category: 'account',
                priority: 'medium',
            });
            assert.equal(ticket.replies.length, 1);
            await assert.rejects(getTicketById(ticket.id, other), {
                status: 404,
            });
            await assert.rejects(
                replyToTicket(ticket.id, other, { message: 'Intrusion' }),
                { status: 404 }
            );
            assert.equal((await getTickets(other, 0, 20, {})).total, 0);
            await updateTicket(ticket.id, staff, {
                assigned_to: 3,
                status: 'in_progress',
            });
            await replyToTicket(ticket.id, staff, {
                message: 'Private note',
                is_internal: true,
            });
            assert.equal(
                (await getTicketMessages(ticket.id, owner, {})).rows.length,
                1
            );
            assert.equal(
                (await getTicketMessages(ticket.id, staff, {})).rows.length,
                2
            );
            assert.equal(
                (
                    await getTickets(owner, 0, 20, {
                        search: ticket.ticket_number,
                    })
                ).rows[0].reply_count,
                1
            );
            await replyToTicket(ticket.id, staff, {
                message: 'Please try again',
            });
            assert.equal(
                (await getTicketById(ticket.id, owner)).status,
                'waiting_on_user'
            );
            await updateTicket(ticket.id, owner, { status: 'resolved' });
            await Promise.all([
                replyToTicket(ticket.id, owner, { message: 'Still broken' }),
                replyToTicket(ticket.id, owner, { message: 'More details' }),
            ]);
            assert.equal(
                (await getTicketById(ticket.id, owner)).status,
                'open'
            );
            const first = await getTicketMessages(ticket.id, owner, {
                limit: 2,
            });
            const second = await getTicketMessages(ticket.id, owner, {
                after: first.next_cursor,
                limit: 2,
            });
            assert.equal(first.has_more, true);
            assert.equal(second.rows.length, 2);
            assert.equal(second.has_more, false);
            const notifications = (
                await db.query('SELECT * FROM notifications')
            ).rows;
            assert.ok(notifications.some((row) => row.user_id === 1));
            assert.ok(notifications.some((row) => row.user_id === 3));
            assert.ok(!JSON.stringify(notifications).includes('Private note'));
            await db.query(
                "UPDATE admins SET status = 'suspended' WHERE user_id = 3"
            );
            await assert.rejects(
                updateTicket(ticket.id, staff, { assigned_to: 3 }),
                { status: 400 }
            );
        } finally {
            t.mock.restoreAll();
            await db.end();
            await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
            await admin.end();
        }
    }
);
