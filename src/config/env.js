import { config } from 'dotenv';

config();

const required = [
    'SESSION_SECRET',
    'REDIS_URL',
    'DB_USER_NAME',
    'DB_HOST',
    'DB_NAME',
    'DB_PASSWORD',
    'DB_PORT',
];

export function validateRuntimeConfig() {
    const missing = required.filter((name) => !process.env[name]?.trim());
    if (missing.length) {
        throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
    }

    if (process.env.SESSION_SECRET.length < 32) {
        throw new Error('SESSION_SECRET must contain at least 32 characters.');
    }

    const databasePort = Number(process.env.DB_PORT);
    if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
        throw new Error('DB_PORT must be a valid TCP port.');
    }

    let redisUrl;
    try {
        redisUrl = new URL(process.env.REDIS_URL);
    } catch {
        throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL.');
    }
    if (!['redis:', 'rediss:'].includes(redisUrl.protocol)) {
        throw new Error('REDIS_URL must use redis:// or rediss://.');
    }
    if (process.env.NODE_ENV === 'production' && redisUrl.protocol !== 'rediss:') {
        throw new Error('Production REDIS_URL must use rediss://.');
    }

    // if (process.env.NODE_ENV === 'production' && process.env.DB_SSL === 'false') {
    //     throw new Error('DB_SSL cannot be false in production.');
    // }

    if (process.env.SESSION_COOKIE_SAME_SITE === 'none' && process.env.SESSION_COOKIE_SECURE === 'false') {
        throw new Error('SESSION_COOKIE_SECURE must be true when SESSION_COOKIE_SAME_SITE is none.');
    }
}

validateRuntimeConfig();