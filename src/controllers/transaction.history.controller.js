import { transactionIdSchema, transactionQuerySchema, adminTransactionQuerySchema } from '#schemas/transaction.history.schema.js';
import TransactionHistory from "#models/transaction.history.model.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";
import { ROLES } from "#utils/helpers.js";

export const getTransactions = async (req, res) => {
    try {
        const { session } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { error, value } = transactionQuerySchema.validate(req.query ?? {});
        if (error) return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        const transactions = await TransactionHistory.fetchTransactions(user.id, value);

        return respondWithSuccess(res, 200, 'Transactions retrieved successfully', transactions);
    } catch (error) {
        console.error("Error fetching transactions:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getTransactionById = async (req, res) => {
    try {
        const { session } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }
        const { error, value: id } = transactionIdSchema.validate(req.params.id);
        if (error) return respondWithError(res, 400, 'Invalid transaction ID', ERROR_CODES.VALIDATION_ERROR);
        const transaction = await TransactionHistory.getTransactionById(id, user.id);
        if (!transaction) {
            return respondWithError(res, 404, 'Transaction not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'Transaction retrieved successfully', transaction);
    } catch (error) {
        console.error("Error fetching transaction:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getVendorTransactions = async (req, res) => {
    try {
        const { session } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const vendorId = req.auth?.vendorId;
        if (![ROLES.VENDOR, ROLES.VENDOR_ADMIN].includes(user.role) || !vendorId) {
            return respondWithError(res, 403, 'Forbidden', ERROR_CODES.FORBIDDEN);
        }
        const { error, value } = transactionQuerySchema.validate(req.query ?? {});
        if (error) return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        const transactions = await TransactionHistory.fetchVendorTransactions(vendorId, value);

        return respondWithSuccess(res, 200, 'Vendor transactions retrieved successfully', transactions);
    } catch (error) {
        console.error("Error fetching vendor transactions:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getAllTransactions = async (req, res) => {
    try {
        const { session } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        if (user.role !== ROLES.SUPER_ADMIN && user.role !== ROLES.ADMIN) {
            return respondWithError(res, 403, 'Forbidden', ERROR_CODES.FORBIDDEN);
        }

        const { error, value } = adminTransactionQuerySchema.validate(req.query ?? {});
        if (error) return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        const transactions = await TransactionHistory.fetchAllTransactions(value);

        return respondWithSuccess(res, 200, 'All transactions retrieved successfully', transactions);
    } catch (error) {
        console.error("Error fetching all transactions:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};