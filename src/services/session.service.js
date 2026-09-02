import redisClient from '#config/redis.js';

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

export default { revokeUserSessions };
