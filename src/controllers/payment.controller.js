import Payment from "#models/payment.model.js";
import { processRefundSchema } from "#schemas/order.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const initiatePayment = async (req, res) => {
    try {
        const { session, params, body } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { order_id } = params;
        const { gateway } = body;

        if (!['paystack', 'stripe'].includes(gateway)) {
            return respondWithError(res, 400, 'Invalid gateway. Use paystack or stripe', ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Payment.initiatePayment(user.id, order_id, gateway);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200, 'Payment initiated successfully', result);
    } catch (error) {
        console.error("Error initiating payment:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const verifyPayment = async (req, res) => {
    try {
        const { query } = req;
        const { gateway, reference } = query;

        if (!gateway || !reference) {
            return respondWithError(res, 400, 'Gateway and reference are required', ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Payment.verifyPayment(gateway, reference);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200, 'Payment verified successfully', result);
    } catch (error) {
        console.error("Error verifying payment:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const refund = async (req, res) => {
    try {
        const { body, session } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { error } = processRefundSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Payment.processRefund(user.id, body);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.OPERATION_FAILED);
        }

        // Send refund confirmation email
        await sendRefundConfirmationEmail(user, result);

        return respondWithSuccess(res, 200, 'Refund processed successfully', result);
    } catch (error) {
        console.error("Error processing refund:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};