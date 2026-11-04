import { randomUUID } from 'node:crypto';
import { ActivityLog, SystemLog } from '#services/audit-logs.js';

const loggedMutationMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const auditLogging = (req, res, next) => {
    req.requestId = req.get('x-request-id')?.slice(0, 100) || randomUUID();
    res.setHeader('X-Request-Id', req.requestId);

    res.once('finish', () => {
        const routePath = req.route?.path;
        const path = routePath
            ? `${req.baseUrl || ''}${routePath}`.slice(0, 300)
            : req.path.slice(0, 300);
        const auth = req.auth;

        if (res.statusCode >= 500) {
            void SystemLog.record({
                level: 'error',
                event: 'API_REQUEST_FAILED',
                details: { errorName: res.locals?.errorName ?? null },
                userId: auth?.userId,
                requestId: req.requestId,
                method: req.method,
                path,
                statusCode: res.statusCode,
            });
        }

        if (!auth?.userId || !loggedMutationMethods.has(req.method)) return;

        void ActivityLog.record({
            userId: auth.userId,
            action: `${req.method} ${path}`,
            details: {
                statusCode: res.statusCode,
                role: auth.role,
                requestId: req.requestId,
            },
        }).catch((error) => {
            void SystemLog.record({
                level: 'error',
                event: 'ACTIVITY_LOG_WRITE_FAILED',
                details: { errorName: error?.name ?? 'Error', errorCode: error?.code ?? null },
                userId: auth.userId,
                requestId: req.requestId,
                method: req.method,
                path,
                statusCode: res.statusCode,
            });
        });
    });

    next();
};

export default auditLogging;
