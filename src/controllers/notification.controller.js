import Notification from '#models/notification.model.js';
import {
    notificationQuerySchema,
    notificationReadSchema,
} from '#schemas/notifications.schema.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

const fail = (message, status) => Object.assign(new Error(message), { status });
const userId = (req) => {
    const id = req.auth?.userId;
    if (!Number.isSafeInteger(id) || id <= 0) throw fail('Unauthorized', 401);
    return id;
};
const notificationId = (req) => {
    const value = String(req.params.notificationId);
    const id = Number(value);
    if (
        !/^\d+$/.test(value) ||
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        id > 2147483647
    )
        throw fail('Invalid notification ID', 400);
    return id;
};
const validate = (schema, input) => {
    const { error, value } = schema.validate(input ?? {}, {
        abortEarly: false,
    });
    if (error) throw fail(error.details[0].message, 400);
    return value;
};
const handleError = (res, error) => {
    const status = error.status || 500;
    const codes = {
        400: ERROR_CODES.VALIDATION_ERROR,
        401: ERROR_CODES.UNAUTHORIZED,
        404: ERROR_CODES.RESOURCE_NOT_FOUND,
    };
    if (status === 500) console.error('Notification operation failed:', error);
    return respondWithError(
        res,
        status,
        status === 500 ? 'Internal server error' : error.message,
        codes[status] || ERROR_CODES.INTERNAL_SERVER_ERROR
    );
};

export const getUserNotifications = async (req, res) => {
    try {
        const id = userId(req);
        const { unread_only, ...options } = validate(
            notificationQuerySchema,
            req.query
        );
        const rows = await Notification.getUserNotifications(id, {
            ...options,
            unreadOnly: unread_only,
        });
        return respondWithSuccess(
            res,
            200,
            'Notifications fetched successfully',
            rows
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const getUserNotification = async (req, res) => {
    try {
        const id = userId(req);
        const notification = await Notification.getUserNotification(
            id,
            notificationId(req)
        );
        if (!notification) throw fail('Notification not found', 404);
        return respondWithSuccess(
            res,
            200,
            'Notification fetched successfully',
            notification
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const markAsRead = async (req, res) => {
    try {
        const id = userId(req);
        const notification = await Notification.markAsRead(
            notificationId(req),
            id
        );
        if (!notification) throw fail('Notification not found', 404);
        return respondWithSuccess(
            res,
            200,
            'Notification marked as read',
            notification
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const markAllAsRead = async (req, res) => {
    try {
        const id = userId(req);
        const { through_id } = validate(notificationReadSchema, req.body);
        const rows = await Notification.markAllAsRead(id, through_id);
        return respondWithSuccess(
            res,
            200,
            'All notifications marked as read',
            { count: rows.length }
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const getUnreadCount = async (req, res) => {
    try {
        const count = await Notification.getUnreadCount(userId(req));
        return respondWithSuccess(
            res,
            200,
            'Unread count fetched successfully',
            { count }
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const deleteNotification = async (req, res) => {
    try {
        const id = userId(req);
        const notification = await Notification.deleteNotification(
            notificationId(req),
            id
        );
        if (!notification) throw fail('Notification not found', 404);
        return respondWithSuccess(
            res,
            200,
            'Notification deleted successfully',
            notification
        );
    } catch (error) {
        return handleError(res, error);
    }
};
