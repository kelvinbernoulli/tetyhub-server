import { Footer, Header } from './layout.js';

const escapeHtml = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

export const adminRegistration = (admin, invitationUrl) => {
    const firstname = escapeHtml(admin.firstname || 'there');
    const safeInvitationUrl = escapeHtml(invitationUrl);

    return `
        ${Header()}
        <tr>
            <td style="padding: 20px 30px;">
                <p style="text-align: center; font-size: 15px; line-height: 1.6; color: #555;">
                    Hi ${firstname}, you have been invited to join TetyHub as an administrator.
                    Use the secure link below to choose your password and activate your account.
                </p>

                <p style="text-align: center;">
                    <a href="${safeInvitationUrl}"
                       style="display: inline-block; margin: 20px auto; padding: 12px 30px;
                              background-color: #007BFF; color: #fff; text-decoration: none;
                              border-radius: 5px; font-size: 15px; font-weight: 600;">
                        Accept invitation
                    </a>
                </p>

                <p style="text-align: center; font-size: 13px; color: #888;">
                    This single-use link expires in 24 hours. If you did not expect this
                    invitation, you can safely ignore this email.
                </p>
            </td>
        </tr>
        ${Footer()}
    `;
};
