import ServiceBookmark from '#models/service-bookmark.model.js';
import { serviceIdSchema } from '#schemas/services.schema.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

const serviceId = (req) => {
    const { value, error } = serviceIdSchema.validate(req.params.serviceId);
    if (error) throw Object.assign(new Error('Invalid service ID'), { status: 400 });
    return value;
};

const handleError = (res, error) => {
    const status = error.status ?? 500;
    if (status >= 500) console.error('Service bookmark request failed:', error);
    const code = status === 400
        ? ERROR_CODES.VALIDATION_ERROR
        : status === 401
          ? ERROR_CODES.UNAUTHORIZED
          : status === 404
            ? ERROR_CODES.RESOURCE_NOT_FOUND
            : ERROR_CODES.INTERNAL_SERVER_ERROR;
    return respondWithError(
        res,
        status,
        status >= 500 ? 'Internal server error' : error.message,
        code
    );
};

export const addServiceBookmark = async (req, res) => {
    try {
        const bookmark = await ServiceBookmark.add(
            req.auth.userId,
            serviceId(req)
        );
        if (bookmark?.error) {
            return respondWithError(
                res,
                bookmark.code,
                bookmark.error,
                ERROR_CODES.RESOURCE_CONFLICT
            );
        }
        if (!bookmark) {
            return respondWithError(
                res,
                404,
                'Service not found or unavailable',
                ERROR_CODES.RESOURCE_NOT_FOUND
            );
        }
        return respondWithSuccess(res, 201, 'Service bookmarked successfully', bookmark);
    } catch (error) {
        return handleError(res, error);
    }
};

export const getServiceBookmarks = async (req, res) => {
    try {
        const { offset = 0, limit = 20 } = req.pagination ?? {};
        const result = await ServiceBookmark.findAll(req.auth.userId, {
            offset,
            limit,
        });
        return respondWithSuccess(res, 200, 'Service bookmarks fetched successfully', result);
    } catch (error) {
        return handleError(res, error);
    }
};

export const removeServiceBookmark = async (req, res) => {
    try {
        const bookmark = await ServiceBookmark.remove(
            req.auth.userId,
            serviceId(req)
        );
        if (!bookmark) {
            return respondWithError(
                res,
                404,
                'Service bookmark not found',
                ERROR_CODES.RESOURCE_NOT_FOUND
            );
        }
        return respondWithSuccess(res, 200, 'Service bookmark removed successfully', bookmark);
    } catch (error) {
        return handleError(res, error);
    }
};
