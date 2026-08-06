import { Activity } from "#models/activity.model.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const fetchLogs = async (req, res) => {
    try {
        const { session, params, query, pagination } = req;
        const user = session?.user;
        const { offset, limit } = pagination;

        const result = await Activity.fetchAllLogs(offset, limit);
        if (result.length === 0) {
            return respondWithError(res, 404, "No logs found", ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, "Logs retrieved successfully", result);
        
    } catch (error) {
        console.error( error);
        return respondWithError(res, 500, "Internal Server Error", ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const viewLog = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        const id = parseInt(params.Id);

        const result = await Activity.viewLog(id);
        if (result.length === 0) {
            return respondWithError(res, 404, "Log NOT found", ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, "Log data retrieved successfully", result);

    } catch (error) {
        console.error( error);
        return respondWithError(res, 500, "Internal Server Error", ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const fetchUserLogs = async (req, res) => {
    try {
        const { session, pagination } = req;
        const user = session?.user;
        const { offset, limit } = pagination;

        const result = await Activity.getUserLogs(user.id, offset, limit);
        if (result.length <= 0) {
            return respondWithError(res, 404, "User logs NOT found", ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, "User logs retrieved successfully", result);

    } catch (error) {
        console.error( error);
        return respondWithError(res, 500, "Internal Server Error", ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const searchLogs = async (req, res) => {
    try {
        const { session, pagination } = req;
        const user = session?.user;
        const { offset, limit } = pagination;

        const result = await Activity.searchActivities(user.id, query, offset, limit);
        if (result.length <= 0) {
            return respondWithError(res, 404, "User logs NOT found", ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, "User logs retrieved successfully", result);

    } catch (error) {
        console.error( error);
        return respondWithError(res, 500, "Internal Server Error", ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const adminSearchLogs = async (req, res) => {
    try {
        const { session, pagination, query } = req;
        const { offset, limit } = pagination;

        const result = await Activity.searchActivities(query.user_id || null, query, offset, limit);
        if (result.length === 0) {
            return respondWithError(res, 404, "No logs found", ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, "Logs retrieved successfully", result);

    } catch (error) {
        console.error( error);
        return respondWithError(res, 500, "Internal Server Error", ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}