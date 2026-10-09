import { Footer, Header } from './layout.js';

const escapeHtml = (value = '') =>
    String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');

export const subscriptionRenewal = ({
    firstname,
    currentPeriodEnd,
    pendingPlan,
}) => {
    const renewalDate = new Intl.DateTimeFormat('en-NG', {
        dateStyle: 'long',
        timeZone: 'Africa/Lagos',
    }).format(new Date(currentPeriodEnd));
    const requiresCheckout = Boolean(pendingPlan);
    const title = requiresCheckout
        ? 'Your plan change needs checkout'
        : 'Your subscription renews soon';
    const message = requiresCheckout
        ? `Your paid period ends on ${renewalDate}. Your existing automatic renewal has been disabled. Complete checkout for your scheduled ${escapeHtml(pendingPlan)} plan after the current period ends.`
        : `Your subscription is due to renew on ${renewalDate}. Please review your plan and payment method.`;

    return `
        ${Header()}
        <tr>
            <td style="padding: 28px 30px; color: #333; font-size: 15px; line-height: 1.6;">
                <h2 style="margin: 0 0 18px; text-align: center;">${title}</h2>
                <p>Hi <strong>${escapeHtml(firstname || 'there')}</strong>,</p>
                <p>${message}</p>
                <p>If you have already updated your subscription, no action is needed.</p>
            </td>
        </tr>
        ${Footer()}
    `;
};
