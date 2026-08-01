import session from 'express-session';
import { RedisStore } from 'connect-redis';
import redisClient from './redis.js';

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

export const sessionMiddleware = session({
    store: new RedisStore({
        client: redisClient,
        prefix: 'sess:',          // Redis key pattern: sess:<sessionId>
        ttl: SESSION_MAX_AGE / 1000, // connect-redis expects seconds
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,   // don't create session until something stored
    rolling: true,              // reset TTL on every active request
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: SESSION_MAX_AGE,
    },
});

export default sessionMiddleware;