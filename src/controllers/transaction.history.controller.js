import TransactionHistory from "#models/transaction.history.model.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";
import { ROLES } from "#utils/helpers.js";

export const getTransactions = async (req, res) => {
    try {
        const { session, pagination } = req;
        const { offset, limit } = pagination;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const transactions = await TransactionHistory.fetchTransactions(user.id, {offset, limit});

        return respondWithSuccess(res, 200, 'Transactions retrieved successfully', transactions);
    } catch (error) {
        console.error("Error fetching transactions:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getTransactionById = async (req, res) => {
    try {
        const { session } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }
        const { id } = req.params;
        const transaction = await TransactionHistory.getTransactionById(id, user.id);
        if (!transaction) {
            return respondWithError(res, 404, 'Transaction not found', ERROR_CODES.NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'Transaction retrieved successfully', transaction);
    } catch (error) {
        console.error("Error fetching transaction:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getVendorTransactions = async (req, res) => {
    try {
        const { session, pagination, query } = req;
        const { offset, limit } = pagination;
        const { status, payment_status } = query;
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

        const transactions = await TransactionHistory.fetchVendorTransactions(vendorId, 
            {offset,limit, status, payment_status}
        );

        return respondWithSuccess(res, 200, 'Vendor transactions retrieved successfully', transactions);
    } catch (error) {
        console.error("Error fetching vendor transactions:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getAllTransactions = async (req, res) => {
    try {
        const { session, pagination, query } = req;
        const { offset, limit } = pagination;
        const { status, payment_status, vendor_id } = query;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        if (user.role !== ROLES.SUPER_ADMIN && user.role !== ROLES.ADMIN) {
            return respondWithError(res, 403, 'Forbidden', ERROR_CODES.FORBIDDEN);
        }

        const transactions = await TransactionHistory.fetchAllTransactions({
            offset: parseInt(offset, 10),
            limit: parseInt(limit, 10),
            status,
            payment_status,
            vendor_id: vendor_id ? parseInt(vendor_id, 10) : undefined
        });

        return respondWithSuccess(res, 200, 'All transactions retrieved successfully', transactions);
    } catch (error) {
        console.error("Error fetching all transactions:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};