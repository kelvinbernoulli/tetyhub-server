import crypto from 'crypto';
import { frontendBase } from './helpers.js';

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

export const hashAdminInvitationToken = (token) => (
    crypto.createHash('sha256').update(token, 'utf8').digest('hex')
);

export const createAdminInvitation = (now = new Date()) => {
    const token = crypto.randomBytes(32).toString('base64url');
    return {
        token,
        tokenHash: hashAdminInvitationToken(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
    };
};

export const buildAdminInvitationUrl = (token) => {
    const configuredUrl = process.env.ADMIN_INVITE_URL;
    const url = configuredUrl
        ? new URL(configuredUrl)
        : new URL('/admin/invitations/accept', frontendBase);

    url.searchParams.set('token', token);
    return url.toString();
};

export const ADMIN_INVITATION_TTL_MS = INVITATION_TTL_MS;
