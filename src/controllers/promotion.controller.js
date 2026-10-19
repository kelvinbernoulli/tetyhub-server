import Promotions from '#models/promotions.model.js';
import { calculatePromotionPrice } from '#services/promotion-pricing.service.js';
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

export const fetchLandingPagePromotions = async (req, res) => {
    try {
        const placement = req.query?.placement ?? 'homepage_banner';
        const limit = Math.min(
            20,
            Math.max(1, Number(req.query?.limit ?? 10) || 10)
        );

        const rows = await Promotions.listByPlacement(
            placement,
            limit
        );

        return respondWithSuccess(
            res,
            200,
            'Landing page promotions fetched successfully',
            rows
        );
    } catch (error) {
        console.error('Error fetching landing page promotions:', error);
        return respondWithError(
            res,
            500,
            'Internal server error',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const fetchVendorPromotions = async (req, res) => {
    try {
        const rows = await Promotions.list({
            placement: req.query?.placement,
            vendorId: vendorId(req),
            status: req.query?.status ?? 'active',
            limit: req.query?.limit ?? 20,
            offset: req.query?.offset ?? 0,
        });

        return respondWithSuccess(res, 200, 'Vendor promotions fetched successfully', rows);
    } catch (error) {
        const status = error.status ?? 500;
        const message = error.status && error.status < 500 ? error.message : 'Internal server error';
        return respondWithError(res, status, message, status < 500 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchVendorPromotionById = async (req, res) => {
    try {
        const row = await Promotions.findById(req.params.promotionId ?? req.params.id, vendorId(req));
        if (!row) {
            return respondWithError(res, 404, 'Promotion not found.', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'Promotion fetched successfully', row);
    } catch (error) {
        const status = error.status ?? 500;
        const message = error.status && error.status < 500 ? error.message : 'Internal server error';
        return respondWithError(res, status, message, status < 500 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const createPromotion = async (req, res) => {
    try {
        const row = await Promotions.create(vendorId(req), req.body ?? {});
        return respondWithSuccess(res, 201, 'Promotion created successfully', row);
    } catch (error) {
        const status = error.status ?? 500;
        const message = error.status && error.status < 500 ? error.message : 'Internal server error';
        return respondWithError(res, status, message, status < 500 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updatePromotion = async (req, res) => {
    try {
        const row = await Promotions.update(req.params.promotionId ?? req.params.id, vendorId(req), req.body ?? {});
        return respondWithSuccess(res, 200, 'Promotion updated successfully', row);
    } catch (error) {
        const status = error.status ?? 500;
        const message = error.status && error.status < 500 ? error.message : 'Internal server error';
        return respondWithError(res, status, message, status < 500 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const deletePromotion = async (req, res) => {
    try {
        const deleted = await Promotions.remove(req.params.promotionId ?? req.params.id, vendorId(req));
        return respondWithSuccess(res, 200, 'Promotion deleted successfully', deleted);
    } catch (error) {
        const status = error.status ?? 500;
        const message = error.status && error.status < 500 ? error.message : 'Internal server error';
        return respondWithError(res, status, message, status < 500 ? ERROR_CODES.VALIDATION_ERROR : ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const estimatePromotionPrice = async (req, res) => {
    try {
        const payload = calculatePromotionPrice({
            placement: req.query?.placement,
            days: req.query?.days,
            baseDailyRate: req.query?.baseDailyRate,
            keyword: req.query?.keyword,
            season: req.query?.season,
            minTotalPrice: req.query?.minTotalPrice,
            platformCommissionRate: req.query?.platformCommissionRate,
        });

        return respondWithSuccess(
            res,
            200,
            'Promotion pricing estimate calculated successfully',
            payload
        );
    } catch (error) {
        console.error('Error estimating promotion price:', error);
        return respondWithError(
            res,
            500,
            'Internal server error',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};
