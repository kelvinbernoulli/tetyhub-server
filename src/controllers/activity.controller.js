import { ActivityLog } from '#services/audit-logs.js';
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const fetchUserLogs = async (req, res) => {
    try {
        const { offset, limit } = req.pagination;
        const result = await ActivityLog.listForUser(req.auth.userId, offset, limit);
        console.log('activity:', result);
        return respondWithSuccess(res, 200, 'Activity logs retrieved successfully', {
            data: result.rows,
            pagination: { offset, limit, total: result.total },
        });
    } catch (error) {
        console.error('Unable to fetch user activity logs', { errorName: error?.name ?? 'Error' });
        return respondWithError(res, 500, 'Unable to retrieve activity logs.', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchAdminLogs = async (req, res) => {
    try {
        const { offset, limit } = req.pagination;
        const { source, user_id: userId, level, search } = req.query;
        const allowedSources = new Set(['activity', 'system']);
        const allowedLevels = new Set(['info', 'warn', 'error', 'fatal']);
        if (source && !allowedSources.has(source)) {
            return respondWithError(res, 400, 'Invalid log source.', ERROR_CODES.VALIDATION_ERROR);
        }
        if (level && !allowedLevels.has(level)) {
            return respondWithError(res, 400, 'Invalid log level.', ERROR_CODES.VALIDATION_ERROR);
        }
        const parsedUserId = userId === undefined ? null : Number(userId);
        if (parsedUserId !== null && (!Number.isSafeInteger(parsedUserId) || parsedUserId <= 0)) {
            return respondWithError(res, 400, 'Invalid user_id filter.', ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await ActivityLog.listForAdmin({
            offset,
            limit,
            source,
            userId: parsedUserId,
            level,
            search: typeof search === 'string' ? search.trim().slice(0, 100) : null,
        });
        return respondWithSuccess(res, 200, 'Audit logs retrieved successfully', {
            data: result.rows,
            pagination: { offset, limit, total: result.total },
        });
    } catch (error) {
        console.error('Unable to fetch admin audit logs', { errorName: error?.name ?? 'Error' });
        return respondWithError(res, 500, 'Unable to retrieve audit logs.', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchUserLogDetails = async (req, res) => {
    try {
        const rawId = req.params.id;
        const id = Number(rawId);
        if (!/^[1-9]\d*$/.test(rawId) || !Number.isSafeInteger(id) || id > 2147483647) {
            return respondWithError(res, 400, 'Invalid log ID.', ERROR_CODES.VALIDATION_ERROR);
        }

        const log = await ActivityLog.getUserById(req.auth.userId, id);
        if (!log) {
            return respondWithError(res, 404, 'Log not found.', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'Activity log retrieved successfully', log);
    } catch (error) {
        console.error('Unable to fetch user activity log', { errorName: error?.name ?? 'Error' });
        return respondWithError(res, 500, 'Unable to retrieve activity log.', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchAdminLogDetails = async (req, res) => {
    try {
        const { source, id } = req.params;
        if (!['activity', 'system'].includes(source)) {
            return respondWithError(res, 400, 'Invalid log source.', ERROR_CODES.VALIDATION_ERROR);
        }
        // Keep BIGSERIAL system log IDs as strings so values beyond JS safe
        // integer precision are passed to PostgreSQL without being rounded.
        if (!/^[1-9]\d*$/.test(id)) {
            return respondWithError(res, 400, 'Invalid log ID.', ERROR_CODES.VALIDATION_ERROR);
        }
        if (source === 'activity' && Number(id) > 2147483647) {
            return respondWithError(res, 400, 'Invalid log ID.', ERROR_CODES.VALIDATION_ERROR);
        }
        if (source === 'system' && BigInt(id) > 9223372036854775807n) {
            return respondWithError(res, 400, 'Invalid log ID.', ERROR_CODES.VALIDATION_ERROR);
        }

        const log = await ActivityLog.getAdminById(source, id);
        if (!log) {
            return respondWithError(res, 404, 'Log not found.', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'Audit log retrieved successfully', log);
    } catch (error) {
        console.error('Unable to fetch admin audit log', { errorName: error?.name ?? 'Error' });
        return respondWithError(res, 500, 'Unable to retrieve audit log.', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

// Query form supports clients that use the same detail URL for either source:
// GET /logs/:id?source=activity|system
export const fetchAdminLogDetailById = async (req, res) => {
    req.params.source = req.query.source;
    return fetchAdminLogDetails(req, res);
};
