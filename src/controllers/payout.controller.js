import * as PayoutService from '#services/payout.service.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

const vendorId = (req) => {
    const id = Number(req.auth?.vendorId ?? req.session?.user?.vendor_id);
    if (!Number.isInteger(id) || id < 1) {
        const error = new Error('Vendor authentication required.');
        error.status = 403;
        throw error;
    }
    return id;
};

export const listPayouts = async (req, res) => {
    try {
        const payouts = await PayoutService.listVendorPayouts(vendorId(req), {
            status: req.query?.status,
            limit: req.query?.limit ?? 20,
            offset: req.query?.offset ?? 0,
        });

        return respondWithSuccess(res, 200, 'Payouts fetched successfully', payouts);
    } catch (error) {
        const status = error.status ?? 500;
        const message = status < 500 ? error.message : 'Internal server error';
        return respondWithError(
            res,
            status,
            message,
            status < 500 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const getPayoutById = async (req, res) => {
    try {
        const payout = await PayoutService.getVendorPayoutById(vendorId(req), req.params.payoutId);
        if (!payout) {
            return respondWithError(res, 404, 'Payout not found.', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Payout fetched successfully', payout);
    } catch (error) {
        const status = error.status ?? 500;
        const message = status < 500 ? error.message : 'Internal server error';
        return respondWithError(
            res,
            status,
            message,
            status < 500 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const getSummary = async (req, res) => {
    try {
        const summary = await PayoutService.summarizeVendorPayouts(vendorId(req));
        return respondWithSuccess(res, 200, 'Payout summary fetched successfully', summary);
    } catch (error) {
        const status = error.status ?? 500;
        const message = status < 500 ? error.message : 'Internal server error';
        return respondWithError(
            res,
            status,
            message,
            status < 500 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const processPayout = async (req, res) => {
    try {
        const payout = await PayoutService.processVendorPayout(vendorId(req), req.params.payoutId);
        return respondWithSuccess(res, 200, 'Payout entered processing state', payout);
    } catch (error) {
        const status = error.status ?? 500;
        const message = status < 500 ? error.message : 'Internal server error';
        return respondWithError(
            res,
            status,
            message,
            status < 500 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const settlePayout = async (req, res) => {
    try {
        const payout = await PayoutService.settleVendorPayout(vendorId(req), req.params.payoutId);
        return respondWithSuccess(res, 200, 'Payout marked as paid', payout);
    } catch (error) {
        const status = error.status ?? 500;
        const message = status < 500 ? error.message : 'Internal server error';
        return respondWithError(
            res,
            status,
            message,
            status < 500 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export default {
    listPayouts,
    getPayoutById,
    getSummary,
    processPayout,
    settlePayout,
};
