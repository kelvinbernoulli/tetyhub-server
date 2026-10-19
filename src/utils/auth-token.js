import { createHash, randomBytes } from 'node:crypto';

const consumeTokenScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
    end
    return 0
`;

export const createAuthToken = () => randomBytes(32).toString('hex');

export const hashAuthToken = (token) =>
    createHash('sha256').update(token, 'utf8').digest('hex');

export const consumeAuthToken = async (redisClient, key, tokenHash) => {
    const consumed = await redisClient.eval(consumeTokenScript, {
        keys: [key],
        arguments: [tokenHash],
    });
    return Number(consumed) === 1;
};