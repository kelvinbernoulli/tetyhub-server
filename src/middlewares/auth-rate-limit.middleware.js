import { createHash } from 'node:crypto';
import redisClient from '#config/redis.js';
import { respondWithError } from '#utils/response.js';
import ERROR_CODES from '#utils/error.codes.js';

const incrementScript = `
    local ipCount = redis.call('INCR', KEYS[1])
    if ipCount == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
    local accountCount = 0
    if ARGV[2] == '1' then
        accountCount = redis.call('INCR', KEYS[2])
        if accountCount == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
    end
    return { ipCount, accountCount }
`;

const digest = (value) =>
    createHash('sha256').update(value, 'utf8').digest('hex');

export const createRedisRateLimiter = ({
    scope,
    windowSeconds = 15 * 60,
    maxIp = 30,
    maxAccount = null,
}) => async (req, res, next) => {
    try {
        const ip = req.ip || req.socket?.remoteAddress || 'unknown';
        const account = String(req.body?.email ?? req.query?.email ?? '')
            .trim()
            .toLowerCase();
        const keyPrefix = `rate-limit:{auth-${scope}}`;
        const ipKey = `${keyPrefix}:ip:${digest(ip)}`;
        const accountKey = `${keyPrefix}:account:${digest(account || '-')}`;
        const counts = await redisClient.eval(incrementScript, {
            keys: [ipKey, accountKey],
            arguments: [String(windowSeconds), account && maxAccount !== null ? '1' : '0'],
        });
        if (Number(counts[0]) > maxIp || (maxAccount !== null && Number(counts[1]) > maxAccount)) {
            return respondWithError(
                res,
                429,
                'Too many attempts. Please try again later.',
                ERROR_CODES.FORBIDDEN
            );
        }
        return next();
    } catch (error) {
        console.error('Authentication rate limiter failed:', error.message);
        return respondWithError(
            res,
            503,
            'Authentication service is temporarily unavailable.',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};
export const createAuthRateLimiter = createRedisRateLimiter;
