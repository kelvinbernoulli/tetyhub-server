import Joi from 'joi';
import { CheckoutError } from '#utils/checkout.js';
import {
    listShipbubblePackageCategories,
    requestCartShippingRates,
    requestVendorShippingRates,
} from '#services/shipping-rates.service.js';
import { ShipbubbleError } from '#services/shipbubble.service.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';
import ERROR_CODES from '#utils/error.codes.js';

function logShippingProviderError(context, error) {
    console.error(context, {
        errorName: error?.name ?? 'Error',
        status: error?.status ?? null,
        message: error?.message ?? 'Unknown error',
    });
}

function shippingProviderStatus(error) {
    if ([400, 429, 503].includes(error.status)) return 503;
    if (error.status === 422) return 422;
    return 502;
}

const rateRequestSchema = Joi.object({
    firstname: Joi.string().trim().max(100).required(),
    lastname: Joi.string().trim().max(100).required(),
    email: Joi.string().trim().max(255).email().required(),
    phone_one: Joi.string().trim().pattern(/^\+?[1-9]\d{1,14}$/).required(),
    address: Joi.string().trim().max(500).required(),
    city: Joi.string().trim().max(100).required(),
    state: Joi.string().trim().max(100).required(),
    country: Joi.string().trim().max(100).required(),
    zip_code: Joi.string().trim().max(20).allow(null, '').optional(),
    pickup_date: Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).optional(),
    service_type: Joi.string().valid('pickup', 'dropoff').optional(),
    delivery_instructions: Joi.string().trim().max(500).allow('').optional(),
}).options({ stripUnknown: true });

export async function getShipbubblePackageCategories(req, res) {
    try {
        const categories = await listShipbubblePackageCategories();
        return respondWithSuccess(
            res,
            200,
            'ShipBubble package categories fetched',
            categories
        );
    } catch (error) {
        logShippingProviderError('ShipBubble categories request failed:', error);
        const status = error instanceof ShipbubbleError
            ? shippingProviderStatus(error)
            : 500;
        return respondWithError(
            res,
            status,
            'Shipping categories are temporarily unavailable',
            error instanceof ShipbubbleError
                ? ERROR_CODES.EXTERNAL_SERVICE_ERROR
                : ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
}

export async function getVendorShippingRates(req, res) {
    try {
        const user = req.session?.user;
        if (!user)
            return respondWithError(
                res,
                401,
                'Unauthorized',
                ERROR_CODES.UNAUTHORIZED
            );

        const vendorId = Number(req.params.vendorId);
        if (!Number.isSafeInteger(vendorId) || vendorId <= 0)
            return respondWithError(
                res,
                400,
                'Invalid vendor ID',
                ERROR_CODES.VALIDATION_ERROR
            );

        const { error, value } = rateRequestSchema.validate(req.body);
        if (error)
            return respondWithError(
                res,
                400,
                error.details.map((detail) => detail.message).join(', '),
                ERROR_CODES.VALIDATION_ERROR
            );

        const result = await requestVendorShippingRates(
            user.id,
            vendorId,
            value
        );
        return respondWithSuccess(res, 200, 'Shipping rates fetched', result);
    } catch (error) {
        if (error instanceof CheckoutError)
            return respondWithError(
                res,
                error.code,
                error.message,
                ERROR_CODES.VALIDATION_ERROR
            );
        logShippingProviderError('ShipBubble rate request failed:', error);
        const isProviderError = error instanceof ShipbubbleError;
        const status = isProviderError ? shippingProviderStatus(error) : 500;
        return respondWithError(
            res,
            status,
            status === 422
                ? 'ShipBubble could not accept the supplied shipping details'
                : 'Unable to fetch shipping rates right now',
            status === 422
                ? ERROR_CODES.VALIDATION_ERROR
                : isProviderError
                    ? ERROR_CODES.EXTERNAL_SERVICE_ERROR
                    : ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
}

export async function getCartShippingRates(req, res) {
    try {
        const user = req.session?.user;
        if (!user)
            return respondWithError(
                res,
                401,
                'Unauthorized',
                ERROR_CODES.UNAUTHORIZED
            );

        const { error, value } = rateRequestSchema.validate(req.body);
        if (error)
            return respondWithError(
                res,
                400,
                error.details.map((detail) => detail.message).join(', '),
                ERROR_CODES.VALIDATION_ERROR
            );

        const result = await requestCartShippingRates(user.id, value);
        return respondWithSuccess(res, 200, 'Shipping rates fetched', result);
    } catch (error) {
        if (error instanceof CheckoutError)
            return respondWithError(
                res,
                error.code,
                error.message,
                ERROR_CODES.VALIDATION_ERROR
            );
        logShippingProviderError('ShipBubble cart rates request failed:', error);
        const isProviderError = error instanceof ShipbubbleError;
        const status = isProviderError ? shippingProviderStatus(error) : 500;
        return respondWithError(
            res,
            status,
            status === 422
                ? 'ShipBubble could not accept the supplied shipping details'
                : 'Unable to fetch shipping rates right now',
            status === 422
                ? ERROR_CODES.VALIDATION_ERROR
                : isProviderError
                    ? ERROR_CODES.EXTERNAL_SERVICE_ERROR
                    : ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
}
