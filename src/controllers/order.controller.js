import { sendOrderConfirmationEmail } from '#models/mail.model.js';
import Order from '#models/order.model.js';
import { cancelOrderSchema } from '#schemas/order.schema.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

export const getCustomerOrders = async (req, res) => {
    try {
        const { session, query, pagination } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(
                res,
                401,
                'Unauthorized',
                ERROR_CODES.UNAUTHORIZED
            );
        }

        const { offset, limit } = pagination;
        const { status } = query;

        const orders = await Order.fetchCustomerOrders(
            user.id,
            user.vendor_id,
            { status, offset, limit }
        );
        if (orders.length === 0) {
            return respondWithError(
                res,
                404,
                'No orders found',
                ERROR_CODES.RESOURCE_NOT_FOUND
            );
        }

        return respondWithSuccess(
            res,
            200,
            'Orders fetched successfully',
            orders
        );
    } catch (error) {
        console.error('Error fetching customer orders:', error);
        return respondWithError(
            res,
            500,
            error.message || 'Internal Server Error',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const getCustomerOrderById = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(
                res,
                401,
                'Unauthorized',
                ERROR_CODES.UNAUTHORIZED
            );
        }

        const { orderId } = params;

        const order = await Order.getOrderById(orderId, user.id);

        if (!order) {
            return respondWithError(
                res,
                404,
                'Order not found',
                ERROR_CODES.RESOURCE_NOT_FOUND
            );
        }

        return respondWithSuccess(
            res,
            200,
            'Order fetched successfully',
            order
        );
    } catch (error) {
        console.error('Error fetching customer order:', error);
        return respondWithError(
            res,
            500,
            error.message || 'Internal Server Error',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const cancelOrder = async (req, res) => {
    try {
        const { session, params, body } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(
                res,
                401,
                'Unauthorized',
                ERROR_CODES.UNAUTHORIZED
            );
        }

        const { orderId: order_id } = params;

        const { error } = cancelOrderSchema.validate(body);
        if (error) {
            return respondWithError(
                res,
                400,
                error.details[0].message,
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        const result = await Order.cancelOrder(order_id, user.id, body);
        if (result?.error) {
            return respondWithError(
                res,
                result.code,
                result.error,
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        // Send cancellation email

        return respondWithSuccess(
            res,
            200,
            'Order cancelled successfully',
            result
        );
    } catch (error) {
        console.error('Error cancelling order:', error);
        return respondWithError(
            res,
            500,
            error.message || 'Internal Server Error',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const getOrderHistory = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(
                res,
                401,
                'Unauthorized',
                ERROR_CODES.UNAUTHORIZED
            );
        }

        const { orderId } = params;
        const history = await Order.fetchOrderHistory(orderId, user.id);

        return respondWithSuccess(
            res,
            200,
            'Order history fetched successfully',
            history
        );
    } catch (error) {
        console.error('Error fetching order history:', error);
        return respondWithError(
            res,
            500,
            error.message || 'Internal Server Error',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const confirmVendorDelivery = async (req, res) => {
    try {
        const userId = req.auth?.userId ?? req.session?.user?.id;
        const orderId = Number(req.params.orderId);
        const vendorId = Number(req.params.vendorId);
        if (
            !Number.isSafeInteger(orderId) || orderId < 1 ||
            !Number.isSafeInteger(vendorId) || vendorId < 1
        )
            return respondWithError(
                res,
                400,
                'Invalid order or vendor ID',
                ERROR_CODES.VALIDATION_ERROR
            );
        const result = await Order.confirmVendorDelivery(
            orderId,
            userId,
            vendorId
        );
        return respondWithSuccess(
            res,
            200,
            'Vendor delivery confirmed',
            result
        );
    } catch (error) {
        const status = error instanceof Error && Number.isInteger(error.code)
            ? error.code
            : 500;
        if (status >= 500)
            console.error('Vendor delivery confirmation failed:', error);
        return respondWithError(
            res,
            status,
            status >= 500 ? 'Unable to confirm vendor delivery' : error.message,
            status === 404
                ? ERROR_CODES.RESOURCE_NOT_FOUND
                : status === 409
                  ? ERROR_CODES.RESOURCE_CONFLICT
                  : status >= 500
                    ? ERROR_CODES.INTERNAL_SERVER_ERROR
                    : ERROR_CODES.VALIDATION_ERROR
        );
    }
};
