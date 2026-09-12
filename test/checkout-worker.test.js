import assert from 'node:assert/strict';
import test from 'node:test';
import pool from '../src/services/pg_pool.js';
import transporter from '../src/services/mail_transporter.js';
import { deliverCheckoutNotification } from '../src/services/checkout.worker.js';

for (const fail of [false, true]) {
    test(
        fail
            ? 'failed email remains queued for retry'
            : 'confirmed email uses order contact and currency then marks delivery',
        async (t) => {
            const calls = [];
            t.mock.method(pool, 'query', async (sql, values) => {
                calls.push({ sql, values });
                if (
                    sql.startsWith('UPDATE checkout_notifications SET attempts')
                )
                    return { rows: [{ id: 1, order_id: 5 }] };
                if (sql.startsWith('SELECT o.*'))
                    return {
                        rows: [
                            {
                                id: 5,
                                user_id: 1,
                                contact_email: 'checkout@example.com',
                                currency: 'USD',
                                status: 'processing',
                                payment_status: 'paid',
                                total: '10.00',
                                subtotal: '10.00',
                                shipping_fee: 0,
                                order_number: 'ORD-test',
                                created_at: new Date(),
                            },
                        ],
                    };
                if (sql.startsWith('SELECT * FROM order_items'))
                    return {
                        rows: [
                            {
                                product_name: '<script>bad</script>',
                                quantity: 1,
                                subtotal: '10.00',
                            },
                        ],
                    };
                if (sql.startsWith('SELECT firstname'))
                    return {
                        rows: [
                            {
                                firstname: 'Buyer',
                                email: 'account@example.com',
                            },
                        ],
                    };
                return { rows: [] };
            });
            t.mock.method(transporter, 'sendMail', async (mail) => {
                assert.equal(mail.to, 'checkout@example.com');
                assert.match(mail.html, /USD/);
                assert.ok(!mail.html.includes('<script>bad</script>'));
                if (fail) throw new Error('SMTP unavailable');
                return {};
            });
            t.mock.method(console, 'error', () => {});
            t.mock.method(console, 'log', () => {});
            if (fail)
                await assert.rejects(
                    deliverCheckoutNotification(),
                    /delivery failed/
                );
            else await deliverCheckoutNotification();
            assert.equal(
                calls.some((x) => x.sql.includes('SET delivered_at')),
                !fail
            );
        }
    );
}
