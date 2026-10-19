import { config } from 'dotenv';
config();

process.env.TZ = 'UTC';

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { UAParser } from 'ua-parser-js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

import auth from '#routes/auth.routes.js';
import admin from '#routes/admin.routes.js';
// import user from "#routes/user.routes.js";
import vendor from '#routes/vendor.routes.js';
import web from '#routes/web.routes.js';
import {
    paystackWebhook,
    stripeWebhook,
    startPaystackWebhookWorker,
} from '#services/webhook.js';
import { startCheckoutWorker } from '#services/checkout.worker.js';
import { startSubscriptionLifecycleJob } from '#services/subscription-lifecycle.service.js';
import passport from 'passport';
import pool from '#services/pg_pool.js';
import redisClient from '#config/redis.js';
import { createRedisRateLimiter } from '#middlewares/auth-rate-limit.middleware.js';
import sessionMiddleware from '#config/session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5000;
const APP_VERSION = 'v1';
const REQUEST_SIZE_LIMIT = `${process.env.REQUEST_SIZE_LIMIT || 20}mb`;

// Security
app.use(helmet());
const trustedProxySetting = process.env.TRUST_PROXY?.trim();
if (trustedProxySetting) {
    const hopCount = Number(trustedProxySetting);
    app.set(
        'trust proxy',
        Number.isInteger(hopCount) && hopCount >= 0
            ? hopCount
            : trustedProxySetting.split(',').map((entry) => entry.trim())
    );
}

// Shared across instances; auth routes apply tighter account-aware limits.
app.use(
    createRedisRateLimiter({
        scope: 'global',
        windowSeconds: 5 * 60,
        maxIp: 5000,
    })
);
// CORS
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

app.use(
    cors({
        origin(origin, callback) {
            if (!origin) return callback(null, true);
            const formatted = origin.trim().replace(/\/$/, '');
            if (allowedOrigins.includes(formatted)) return callback(null, true);
            console.error(`CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: [
            'Content-Type',
            'Authorization',
            'X-Requested-With',
            'X-CSRF-Token',
            'Accept',
            'Idempotency-Key',
        ],
        exposedHeaders: ['Content-Range', 'X-Content-Range'],
        maxAge: 86400,
        preflightContinue: false,
        optionsSuccessStatus: 204,
    })
);
app.options('/{*splat}', cors());

// Signature verification must receive the original bytes, before JSON parsing.
app.post(
    '/v1/api/webhook/paystack',
    express.raw({ type: 'application/json', limit: '1mb' }),
    paystackWebhook
);
app.post(
    '/v1/api/webhook/stripe',
    express.raw({ type: 'application/json', limit: '1mb' }),
    stripeWebhook
);

// Parsing
app.use(cookieParser());
app.use(sessionMiddleware);
app.use(express.json({ limit: REQUEST_SIZE_LIMIT }));
app.use(express.urlencoded({ limit: REQUEST_SIZE_LIMIT, extended: true }));
app.use(passport.initialize());

// Static assets
app.use('/assets', express.static(path.join(__dirname, 'assets')));

// Routes
app.use(`/${APP_VERSION}/api/auth`, auth);
app.use(`/${APP_VERSION}/api/admin`, admin);
// app.use(`/${APP_VERSION}/api/user`, user);
app.use(`/${APP_VERSION}/api/vendor`, vendor);
app.use(`/${APP_VERSION}/api`, web);

// Root — UA parser (consider removing or restricting in production)
app.get('/', (req, res) => {
    const parsedData = new UAParser(req.headers['user-agent']).getResult();
    res.json({ success: true, data: parsedData });
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Server is running.',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
    });
});

// 404
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.originalUrl,
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);

    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            success: false,
            message: 'CORS policy violation',
        });
    }

    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 500
        ? err.status
        : 500;
    res.status(status).json({
        success: false,
        message: status === 500
            ? 'Internal server error'
            : err.message || 'Request failed',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
});

// Startup
// const stopCheckoutWorker = startCheckoutWorker();
// const stopPaystackWebhookWorker = startPaystackWebhookWorker();
// const stopSubscriptionLifecycleJob = startSubscriptionLifecycleJob();

const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} — http://localhost:${PORT}/`);
});

let shuttingDown = false;
const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received: closing server and background workers`);
    stopCheckoutWorker();
    stopPaystackWebhookWorker();
    stopSubscriptionLifecycleJob();

    const forceExit = setTimeout(() => {
        console.error('Graceful shutdown timed out.');
        process.exit(1);
    }, 15000);
    forceExit.unref();

    server.close(async (error) => {
        if (error) console.error('HTTP server shutdown failed:', error);
        await Promise.allSettled([pool.end(), redisClient.quit()]);
        clearTimeout(forceExit);
        process.exitCode = error ? 1 : 0;
    });
};

// process.once('SIGTERM', () => shutdown('SIGTERM'));
// process.once('SIGINT', () => shutdown('SIGINT'));

export default app;
