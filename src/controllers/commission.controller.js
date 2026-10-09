import Commission from '#models/commission.model.js';
import { updateCommissionRatesSchema } from '#schemas/commission.schema.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

export const getRates = async (req, res) => {
    try {
        return respondWithSuccess(
            res,
            200,
            'Commission rates fetched successfully',
            await Commission.getRates()
        );
    } catch (error) {
        console.error('Commission rates fetch failed:', error);
        return respondWithError(
            res,
            500,
            'Unable to fetch commission rates',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const updateRates = async (req, res) => {
    const { error, value } = updateCommissionRatesSchema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
    });
    if (error)
        return respondWithError(
            res,
            400,
            error.details[0].message,
            ERROR_CODES.VALIDATION_ERROR
        );
    try {
        const changedBy = req.auth?.userId ?? req.session?.user?.id;
        const result = await Commission.updateRates(value, changedBy);
        return respondWithSuccess(
            res,
            200,
            'Commission rates updated successfully',
            result
        );
    } catch (failure) {
        console.error('Commission rates update failed:', failure);
        return respondWithError(
            res,
            500,
            'Unable to update commission rates',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const getRateHistory = async (req, res) => {
    try {
        const { limit = 50, offset = 0 } = req.pagination ?? {};
        const rows = await Commission.history({ limit, offset });
        return respondWithSuccess(
            res,
            200,
            'Commission rate history fetched successfully',
            rows
        );
    } catch (error) {
        console.error('Commission rates history fetch failed:', error);
        return respondWithError(
            res,
            500,
            'Unable to fetch commission rate history',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};
