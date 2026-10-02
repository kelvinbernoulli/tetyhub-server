import { CheckoutError } from '#utils/checkout.js';
import Shipment from "#models/shipment.model.js";
import { createShipmentSchema, updateShipmentSchema, addTrackingUpdateSchema } from "#schemas/order.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const createShipment = async (req, res) => {
    try {
        const { session, params, body } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { orderId } = params;
        if (!/^[1-9]\d*$/.test(String(orderId)) || Number(orderId) > 2147483647) {
            return respondWithError(res, 400, 'Invalid ID', ERROR_CODES.VALIDATION_ERROR);
        }

        const { error, value } = createShipmentSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Shipment.createShipment(orderId, req.auth?.vendorId, value, user.id);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 201, 'Shipment created successfully', result);
    } catch (error) {
        if (error instanceof CheckoutError) {
            return respondWithError(res, error.code, error.message, ERROR_CODES.VALIDATION_ERROR);
        }
        console.error("Error creating shipment:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateShipment = async (req, res) => {
    try {
        const { session, params, body } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { shipmentId } = params;
        if (!/^[1-9]\d*$/.test(String(shipmentId)) || Number(shipmentId) > 2147483647) {
            return respondWithError(res, 400, 'Invalid ID', ERROR_CODES.VALIDATION_ERROR);
        }

        const { error, value } = updateShipmentSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Shipment.updateShipment(shipmentId, req.auth?.vendorId, value, user.id);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200, 'Shipment updated successfully', result);
    } catch (error) {
        if (error instanceof CheckoutError) {
            return respondWithError(res, error.code, error.message, ERROR_CODES.VALIDATION_ERROR);
        }
        console.error("Error updating shipment:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getShipmentByOrderId = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { orderId } = params;
        if (!/^[1-9]\d*$/.test(String(orderId)) || Number(orderId) > 2147483647) {
            return respondWithError(res, 400, 'Invalid ID', ERROR_CODES.VALIDATION_ERROR);
        }

        const shipment = await Shipment.getShipmentByOrderId(orderId, req.auth?.vendorId, req.auth?.vendorId ? null : user.id);

        if (!shipment) {
            return respondWithError(res, 404, 'Shipment not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Shipment fetched successfully', shipment);
    } catch (error) {
        if (error instanceof CheckoutError) {
            return respondWithError(res, error.code, error.message, ERROR_CODES.VALIDATION_ERROR);
        }
        console.error("Error fetching shipment:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getShipmentById = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { shipmentId } = params;
        if (!/^[1-9]\d*$/.test(String(shipmentId)) || Number(shipmentId) > 2147483647) {
            return respondWithError(res, 400, 'Invalid ID', ERROR_CODES.VALIDATION_ERROR);
        }

        const shipment = await Shipment.getShipmentById(shipmentId, req.auth?.vendorId, req.auth?.vendorId ? null : user.id);

        if (!shipment) {
            return respondWithError(res, 404, 'Shipment not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Shipment fetched successfully', shipment);
    } catch (error) {
        if (error instanceof CheckoutError) {
            return respondWithError(res, error.code, error.message, ERROR_CODES.VALIDATION_ERROR);
        }
        console.error("Error fetching shipment:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getTrackingHistory = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { shipmentId } = params;
        if (!/^[1-9]\d*$/.test(String(shipmentId)) || Number(shipmentId) > 2147483647) {
            return respondWithError(res, 400, 'Invalid ID', ERROR_CODES.VALIDATION_ERROR);
        }

        const trackingHistory = await Shipment.getTrackingHistory(shipmentId, req.auth?.vendorId, req.auth?.vendorId ? null : user.id);

        return respondWithSuccess(res, 200, 'Tracking history fetched successfully', trackingHistory);
    } catch (error) {
        if (error instanceof CheckoutError) {
            return respondWithError(res, error.code, error.message, ERROR_CODES.VALIDATION_ERROR);
        }
        console.error("Error fetching tracking history:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const addTrackingUpdate = async (req, res) => {
    try {
        const { session, params, body } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { shipmentId } = params;
        if (!/^[1-9]\d*$/.test(String(shipmentId)) || Number(shipmentId) > 2147483647) {
            return respondWithError(res, 400, 'Invalid ID', ERROR_CODES.VALIDATION_ERROR);
        }

        const { error, value } = addTrackingUpdateSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Shipment.addTrackingUpdate(shipmentId, req.auth?.vendorId, value, user.id);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 201, 'Tracking update added successfully', result);
    } catch (error) {
        if (error instanceof CheckoutError) {
            return respondWithError(res, error.code, error.message, ERROR_CODES.VALIDATION_ERROR);
        }
        console.error("Error adding tracking update:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};
export const getShipmentsByOrderId = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { orderId } = params;
        if (!/^[1-9]\d*$/.test(String(orderId)) || Number(orderId) > 2147483647) {
            return respondWithError(res, 400, 'Invalid ID', ERROR_CODES.VALIDATION_ERROR);
        }

        const shipment = await Shipment.getShipmentsByOrderId(orderId, req.auth?.vendorId, req.auth?.vendorId ? null : user.id);

        if (!shipment) {
            return respondWithError(res, 404, 'Shipment not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Shipments fetched successfully', shipment);
    } catch (error) {
        if (error instanceof CheckoutError) {
            return respondWithError(res, error.code, error.message, ERROR_CODES.VALIDATION_ERROR);
        }
        console.error("Error fetching shipment:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};
