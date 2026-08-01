import Return from "#models/return.model.js";
import { createReturnRequestSchema, updateReturnStatusSchema, adminUpdateReturnSchema } from "#schemas/order.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const createReturnRequest = async (req, res) => {
    try {
        const { session, params, body } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { orderId } = params;

        const { error } = createReturnRequestSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Return.createReturnRequest(orderId, user.id, body);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 201, 'Return request created successfully', result);
    } catch (error) {
        console.error("Error creating return request:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateReturnStatus = async (req, res) => {
    try {
        const { session, params, body } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { returnId } = params;

        const { error } = updateReturnStatusSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Return.updateReturnStatus(returnId, user.vendor_id, body.status, body.vendor_notes);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200, 'Return status updated successfully', result);
    } catch (error) {
        console.error("Error updating return status:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getReturnById = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { returnId } = params;

        const returnRequest = await Return.getReturnById(returnId, user.id, user.vendor_id);

        if (!returnRequest) {
            return respondWithError(res, 404, 'Return request not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Return request fetched successfully', returnRequest);
    } catch (error) {
        console.error("Error fetching return request:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getReturnsByOrderId = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { orderId } = params;

        const returns = await Return.getReturnsByOrderId(orderId, user.id, user.vendor_id);

        return respondWithSuccess(res, 200, 'Returns fetched successfully', returns);
    } catch (error) {
        console.error("Error fetching returns:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getVendorReturns = async (req, res) => {
    try {
        const { session, query, pagination } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { offset, limit } = pagination;
        const { status } = query;

        const returns = await Return.getVendorReturns(user.vendor_id, { status, offset, limit });

        return respondWithSuccess(res, 200, 'Returns fetched successfully', returns);
    } catch (error) {
        console.error("Error fetching vendor returns:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getCustomerReturns = async (req, res) => {
    try {
        const { session, query, pagination } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { offset, limit } = pagination;
        const { status } = query;

        const returns = await Return.getCustomerReturns(user.id, user.vendor_id, { status, offset, limit });

        return respondWithSuccess(res, 200, 'Returns fetched successfully', returns);
    } catch (error) {
        console.error("Error fetching customer returns:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const adminUpdateReturn = async (req, res) => {
    try {
        const { session, params, body } = req;
        const user = session?.user;

        if (!user || !user.is_admin) {
            return respondWithError(res, 403, 'Admin access required', ERROR_CODES.FORBIDDEN);
        }

        const { returnId } = params;

        const { error } = adminUpdateReturnSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Return.adminUpdateReturn(returnId, user.id, body);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200, 'Return updated successfully', result);
    } catch (error) {
        console.error("Error updating return by admin:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getAllReturns = async (req, res) => {
    try {
        const { session, query, pagination } = req;
        const user = session?.user;

        if (!user || !user.is_admin) {
            return respondWithError(res, 403, 'Admin access required', ERROR_CODES.FORBIDDEN);
        }

        const { offset, limit } = pagination;
        const { status, vendor_id } = query;

        const returns = await Return.getAllReturns({ status, vendor_id, offset, limit });

        return respondWithSuccess(res, 200, 'Returns fetched successfully', returns);
    } catch (error) {
        console.error("Error fetching all returns:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};