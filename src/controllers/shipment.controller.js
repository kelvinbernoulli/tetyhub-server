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

        const { error } = createShipmentSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Shipment.createShipment(orderId, user.vendor_id, body);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 201, 'Shipment created successfully', result);
    } catch (error) {
        console.error("Error creating shipment:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
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

        const { error } = updateShipmentSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Shipment.updateShipment(shipmentId, user.vendor_id, body);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200, 'Shipment updated successfully', result);
    } catch (error) {
        console.error("Error updating shipment:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
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

        const shipment = await Shipment.getShipmentByOrderId(orderId, user.vendor_id);

        if (!shipment) {
            return respondWithError(res, 404, 'Shipment not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Shipment fetched successfully', shipment);
    } catch (error) {
        console.error("Error fetching shipment:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
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

        const shipment = await Shipment.getShipmentById(shipmentId, user.vendor_id);

        if (!shipment) {
            return respondWithError(res, 404, 'Shipment not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Shipment fetched successfully', shipment);
    } catch (error) {
        console.error("Error fetching shipment:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
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

        const trackingHistory = await Shipment.getTrackingHistory(shipmentId, user.vendor_id);

        return respondWithSuccess(res, 200, 'Tracking history fetched successfully', trackingHistory);
    } catch (error) {
        console.error("Error fetching tracking history:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
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

        const { error } = addTrackingUpdateSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Shipment.addTrackingUpdate(shipmentId, user.vendor_id, body);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 201, 'Tracking update added successfully', result);
    } catch (error) {
        console.error("Error adding tracking update:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};