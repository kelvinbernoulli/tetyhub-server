import Payment from '#models/payment.model.js';
import { processRefundSchema } from '#schemas/order.schema.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

export const initiatePayment = async (req, res) => {
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

        const order_id = Number(params.order_id);
        if (!Number.isSafeInteger(order_id) || order_id < 1)
            return respondWithError(res, 400, 'Invalid order ID');
        const { gateway } = body;

        if (!['paystack', 'stripe'].includes(gateway)) {
            return respondWithError(
                res,
                400,
                'Invalid gateway. Use paystack or stripe',
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        const result = await Payment.initiatePayment(
            user.id,
            order_id,
            gateway
        );
        if (result?.error) {
            return respondWithError(
                res,
                result.code,
                result.error,
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        return respondWithSuccess(
            res,
            200,
            'Payment initiated successfully',
            result
        );
    } catch (error) {
        console.error('Error initiating payment:', error.message);
        return respondWithError(
            res,
            Number.isInteger(error.code) ? error.code : 502,
            Number.isInteger(error.code)
                ? error.message
                : 'Payment provider unavailable',
            ERROR_CODES.OPERATION_FAILED
        );
    }
};

export const verifyPayment = async (req, res) => {
    try {
        const { query } = req;
        const gateway = query.gateway;
        const reference = req.params.reference || query.reference;

        if (!gateway || !reference) {
            return respondWithError(
                res,
                400,
                'Gateway and reference are required',
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        const result = await Payment.verifyPayment(
            gateway,
            reference,
            req.session?.user?.id
        );
        if (result?.error) {
            return respondWithError(
                res,
                result.code,
                result.error,
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        return respondWithSuccess(
            res,
            200,
            'Payment verified successfully',
            result
        );
    } catch (error) {
        console.error('Error verifying payment:', error.message);
        return respondWithError(
            res,
            Number.isInteger(error.code) ? error.code : 502,
            Number.isInteger(error.code)
                ? error.message
                : 'Payment provider unavailable',
            ERROR_CODES.OPERATION_FAILED
        );
    }
};

export const refund = async (req, res) => {
    try {
        const { body, session } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(
                res,
                401,
                'Unauthorized',
                ERROR_CODES.UNAUTHORIZED
            );
        }

        const { error } = processRefundSchema.validate(body);
        if (error) {
            return respondWithError(
                res,
                400,
                error.details[0].message,
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        const result = await Payment.processRefund(user.id, body);
        if (result?.error) {
            return respondWithError(
                res,
                result.code,
                result.error,
                ERROR_CODES.OPERATION_FAILED
            );
        }

        // Send refund confirmation email

        return respondWithSuccess(
            res,
            200,
            'Refund processed successfully',
            result
        );
    } catch (error) {
        console.error('Error processing refund:', error.message);
        return respondWithError(
            res,
            Number.isInteger(error.code) ? error.code : 502,
            Number.isInteger(error.code)
                ? error.message
                : 'Payment provider unavailable',
            ERROR_CODES.OPERATION_FAILED
        );
    }
};
