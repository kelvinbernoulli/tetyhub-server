import Notification from "#models/notification.model.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const getUserNotifications = async (req, res) => {
    try {
        const { session, query, pagination } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { offset, limit } = pagination;
        const { unread_only } = query;
        const unreadOnly = unread_only === 'true';

        const notifications = await Notification.getUserNotifications(user.id, {
            offset,
            limit,
            unreadOnly
        });

        return respondWithSuccess(res, 200, 'Notifications fetched successfully', notifications);
    } catch (error) {
        console.error("Error fetching notifications:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getUserNotification = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        const notificationID  = parseInt(params.notificationId);

        const notification = await Notification.getUserNotification(user.id, notificationID);

        if (!notification) {
            return respondWithError(res, 404, 'Notification not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Notification fetched successfully', notification);
    } catch (error) {
        console.error("Error fetching notification:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const markAsRead = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { notificationId } = params;

        const notification = await Notification.markAsRead(notificationId, user.id);

        if (!notification) {
            return respondWithError(res, 404, 'Notification not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Notification marked as read', notification);
    } catch (error) {
        console.error("Error marking notification as read:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const markAllAsRead = async (req, res) => {
    try {
        const { session } = req;
        const user = session?.user;

        const notifications = await Notification.markAllAsRead(user.id);

        return respondWithSuccess(res, 200, 'All notifications marked as read', {
            count: notifications.length
        });
    } catch (error) {
        console.error("Error marking all notifications as read:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getUnreadCount = async (req, res) => {
    try {
        const { session } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const count = await Notification.getUnreadCount(user.id);

        return respondWithSuccess(res, 200, 'Unread count fetched successfully', { count });
    } catch (error) {
        console.error("Error fetching unread count:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};