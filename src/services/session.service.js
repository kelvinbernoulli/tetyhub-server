import redisClient from '#config/redis.js';
import { generateCsrfToken } from '#utils/csrf.js';

export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const RECENT_AUTHENTICATION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const regenerateSession = (req) => new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
});

const saveSession = (req) => new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
});

/**
 * Starts a fresh authenticated session after credentials or an identity
 * provider have just been verified. Rotating both the session ID and CSRF
 * token prevents session fixation and invalidates tokens tied to the old
 * session.
 */
export const establishAuthenticatedSession = async (req, user) => {
    const previousSessionId = req.sessionID;
    const previousUserId = Number(req.session?.user?.id) || null;
    const userId = Number(user?.id);

    if (!Number.isInteger(userId) || userId <= 0) {
        throw new TypeError('A valid user is required to establish a session.');
    }

    const { password, ...safeUser } = user;
    await regenerateSession(req);

    const authenticatedAt = Date.now();
    req.session.user = safeUser;
    req.session.authenticated_at = authenticatedAt;
    req.session.csrf_token = generateCsrfToken();
    await saveSession(req);

    const sessionIndexKey = `user_sessions:${userId}`;
    const transaction = redisClient.multi();

    if (previousUserId && previousSessionId) {
        transaction.sRem(`user_sessions:${previousUserId}`, previousSessionId);
    }

    transaction
        .sAdd(sessionIndexKey, req.sessionID)
        .expire(sessionIndexKey, SESSION_MAX_AGE_MS / 1000);
    await transaction.exec();

    return {
        user: safeUser,
        sessionId: req.sessionID,
        expiresAt: req.session.cookie.expires,
        authenticatedAt,
        recentAuthenticationExpiresAt:
            authenticatedAt + RECENT_AUTHENTICATION_MAX_AGE_MS,
        csrfToken: req.session.csrf_token,
    };
};

export const revokeUserSessions = async (userId) => {
    const key = `user_sessions:${userId}`;
    const sessionIds = await redisClient.sMembers(key);

    if (sessionIds.length === 0) {
        await redisClient.del(key);
        return 0;
    }

    const transaction = redisClient.multi();
    sessionIds.forEach((sessionId) => transaction.del(`sess:${sessionId}`));
    transaction.del(key);
    await transaction.exec();

    return sessionIds.length;
};

export default {
    establishAuthenticatedSession,
    revokeUserSessions,
};
