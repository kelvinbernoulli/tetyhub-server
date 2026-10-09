import assert from 'node:assert/strict';
import test from 'node:test';
import transporter from '#services/mail_transporter.js';
import { sendSubscriptionRenewalEmail } from '#models/mail.model.js';

test('subscription renewal email uses escaped user data and explains plan checkout', async (t) => {
    let sent;
    t.mock.method(transporter, 'sendMail', async (message) => {
        sent = message;
        return {};
    });

    const result = await sendSubscriptionRenewalEmail(
        {
            email: 'provider@example.com',
            firstname: '<Provider>',
        },
        {
            currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
            pendingPlan: 'PRO',
        }
    );

    assert.equal(result, true);
    assert.equal(sent.to, 'provider@example.com');
    assert.match(sent.subject, /plan change needs checkout/);
    assert.match(sent.html, /&lt;Provider&gt;/);
    assert.doesNotMatch(sent.html, /<Provider>/);
    assert.match(sent.html, /scheduled PRO plan/);
    assert.match(sent.html, /1 December 2026/);
});

test('subscription renewal email without a scheduled change uses the normal renewal copy', async (t) => {
    let sent;
    t.mock.method(transporter, 'sendMail', async (message) => {
        sent = message;
        return {};
    });

    const result = await sendSubscriptionRenewalEmail(
        { email: 'provider@example.com', firstname: 'Provider' },
        {
            currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
            pendingPlan: null,
        }
    );

    assert.equal(result, true);
    assert.match(sent.subject, /subscription renews soon/);
    assert.match(sent.html, /subscription is due to renew/);
});
