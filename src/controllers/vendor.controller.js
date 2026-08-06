import Order from "#models/order.model.js";
import { cancelOrderSchema, updateOrderStatusSchema } from "#schemas/order.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { ROLES } from "#utils/helpers.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const getVendorOrders = async (req, res) => {
    try {
        const { session, query, pagination } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { offset, limit } = pagination;
        const { status, payment_status } = query;
        
        const orders = await Order.fetchVendorOrders(user.id, { status, payment_status, offset, limit });

        if (orders.length === 0) {
            return respondWithError(res, 404, 'No orders found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Orders fetched successfully', orders);
    } catch (error) {
        console.error("Error fetching vendor orders:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getVendorOrderById = async (req, res) => {
    try {
        const { session, query,params, pagination } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        let vendorId;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        } else {
            return respondWithError(res, 403, 'Forbidden', ERROR_CODES.FORBIDDEN);
        }

        if (!vendorId) {
            return respondWithError(res, 403, 'Forbidden', ERROR_CODES.FORBIDDEN);
        }

        const { orderId } = params;
        const { offset, limit } = pagination;
        const { status, payment_status } = query;

        const orders = await Order.getOrderById(orderId, null, vendorId);

        return respondWithSuccess(res, 200, 'Orders fetched successfully', orders);
    } catch (error) {
        console.error("Error fetching vendor orders:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getCustomerOrders = async (req, res) => {
    try {
        const { session, query, pagination } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        let vendorId;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        } else if (user.role === ROLES.CUSTOMER) {
            vendorId = user.vendor_id;
        }

        const { offset, limit } = pagination;
        const { status } = query;

        const orders = await Order.fetchCustomerOrders(user.id, vendorId, status, { offset: parseInt(offset), limit: parseInt(limit) });

        return respondWithSuccess(res, 200, 'Orders fetched successfully', orders);
    } catch (error) {
        console.error("Error fetching customer orders:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateOrderStatus = async (req, res) => {
    try {
        const { session, params, body } = req;
        const user = session?.user;

        const orderID = parseInt(params.orderId);

        const { error, value } = updateOrderStatusSchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        let vendorId;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        if (!vendorId) {
            return respondWithError(res, 403, 'Forbidden', ERROR_CODES.FORBIDDEN);
        }

        const result = await Order.updateOrderStatus(orderID, vendorId, user.id, value);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        // Send status update email to customer
        await sendOrderStatusEmail(result);

        return respondWithSuccess(res, 200, 'Order status updated successfully', result);
    } catch (error) {
        console.error("Error updating order status:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const cancelOrder = async (req, res) => {
    try {
        const { session, params, body } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { orderId } = params;

        const { error } = cancelOrderSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Order.cancelOrder(orderId, user.id, body);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        // Send cancellation email
        await sendOrderCancellationEmail(user, result);

        return respondWithSuccess(res, 200, 'Order cancelled successfully', result);
    } catch (error) {
        console.error("Error cancelling order:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getOrderHistory = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { orderId } = params;
        const history = await Order.fetchOrderHistory(orderId, user.id);

        return respondWithSuccess(res, 200, 'Order history fetched successfully', history);
    } catch (error) {
        console.error("Error fetching order history:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getDashboard = async (req, res) => {
    try {
        const { session, query } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        let vendorId;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        if (!vendorId) {
            return respondWithError(res, 403, 'Forbidden', ERROR_CODES.FORBIDDEN);
        }

        const { period } = query;
        const dashboard = await VendorDashboardModel.getDashboard(vendorId, period);

        return respondWithSuccess(res, 200, 'Dashboard fetched successfully', dashboard);
    } catch (error) {
        console.error("Error fetching dashboard:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getRevenueChart = async (req, res) => {
    try {
        const { session, query } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        let vendorId;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        if (!vendorId) {
            return respondWithError(res, 403, 'Forbidden', ERROR_CODES.FORBIDDEN);
        }

        const { period } = query;

        if (period && !['daily', 'weekly', 'monthly', 'yearly'].includes(period)) {
            return respondWithError(res, 400, 'Invalid period. Use daily, weekly, monthly or yearly', ERROR_CODES.VALIDATION_ERROR);
        }

        const chart = await VendorDashboardModel.getRevenueChart(vendorId, period);
        return respondWithSuccess(res, 200, 'Revenue chart fetched successfully', chart);
    } catch (error) {
        console.error("Error fetching revenue chart:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getLowStockProducts = async (req, res) => {
    try {
        const { session, query } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        let vendorId;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        if (!vendorId) {
            return respondWithError(res, 403, 'Forbidden', ERROR_CODES.FORBIDDEN);
        }

        const { limit } = query;
        const products = await VendorDashboardModel.getLowStockProducts(vendorId, parseInt(limit) || 10);
        return respondWithSuccess(res, 200, 'Low stock products fetched successfully', products);
    } catch (error) {
        console.error("Error fetching low stock products:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};