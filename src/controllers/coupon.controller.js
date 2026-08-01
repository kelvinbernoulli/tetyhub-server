import Coupon from '#models/coupons.model.js';
import { createCouponSchema, updateCouponSchema } from '#schemas/coupons.schema.js';
import ERROR_CODES from '#utils/error.codes.js';
import { vendorID } from '#utils/helpers.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

export const createCoupon = async (req, res) => {
	try {
		const { body, session } = req;
		const user = session?.user;
        
		const { error, value } = createCouponSchema.validate(body);
		if (error) return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);

		const vendorId = vendorID(user);
		if (!vendorId) return respondWithError(res, 403, 'Forbidden: Vendor ID not found', ERROR_CODES.FORBIDDEN);

		const duplicate = await Coupon.duplicateCheck(value.code, vendorId);
		if (duplicate) return respondWithError(res, 409, 'Coupon code already exists', ERROR_CODES.DUPLICATE_RESOURCE);

		const created = await Coupon.create({ vendorId, ...value });
		return respondWithSuccess(res, 201, 'Coupon created successfully', created);
	} catch (error) {
		console.error('Error creating coupon:', error);
		return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
	}
};

export const updateCoupon = async (req, res) => {
	try {
		const { body, params, session } = req;
		const user = session?.user;
		const { couponId } = params;

		const { error, value } = updateCouponSchema.validate(body);
		if (error) return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);

		const vendorId = vendorID(user);
		if (!vendorId) return respondWithError(res, 403, 'Forbidden: Vendor ID not found', ERROR_CODES.FORBIDDEN);

		const existing = await Coupon.fetchById(couponId, vendorId);
		if (!existing) return respondWithError(res, 404, 'Coupon not found', ERROR_CODES.RESOURCE_NOT_FOUND);

		if (value.code && value.code !== existing.code) {
			const dup = await Coupon.duplicateCheck(value.code, vendorId);
			if (dup) return respondWithError(res, 409, 'Coupon code already exists', ERROR_CODES.DUPLICATE_RESOURCE);
		}

		const updated = await Coupon.update(couponId, vendorId, value);
		if (!updated) return respondWithError(res, 400, 'Failed to update coupon', ERROR_CODES.RESOURCE_UPDATE_FAILED);

		return respondWithSuccess(res, 200, 'Coupon updated successfully', updated);
	} catch (error) {
		console.error('Error updating coupon:', error);
		return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
	}
};

export const fetchCoupons = async (req, res) => {
	try {
		const { session, pagination } = req;
		const user = session?.user;
		const vendorId = vendorID(user);
		if (!vendorId) return respondWithError(res, 403, 'Forbidden: Vendor ID not found', ERROR_CODES.FORBIDDEN);

		const { limit, offset } = pagination;
		const result = await Coupon.fetchByVendorId(vendorId, { limit, offset });
		if (result.rowCount === 0) return respondWithError(res, 404, 'No coupons found', ERROR_CODES.RESOURCE_NOT_FOUND);

		return respondWithSuccess(res, 200, 'Coupons fetched successfully', result.rows);
	} catch (error) {
		console.error('Error fetching coupons:', error);
		return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
	}
};

export const fetchCouponById = async (req, res) => {
	try {
		const { params, session } = req;
		const user = session?.user;
		const { couponId } = params;

		const vendorId = vendorID(user);
		if (!vendorId) return respondWithError(res, 403, 'Forbidden: Vendor ID not found', ERROR_CODES.FORBIDDEN);

		const result = await Coupon.fetchById(couponId, vendorId);
		if (!result) return respondWithError(res, 404, 'Coupon not found', ERROR_CODES.RESOURCE_NOT_FOUND);

		return respondWithSuccess(res, 200, 'Coupon fetched successfully', result);
	} catch (error) {
		console.error('Error fetching coupon by ID:', error);
		return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
	}
};

export const deleteCoupon = async (req, res) => {
	try {
		const { params, session } = req;
		const user = session?.user;
		const { couponId } = params;

		const vendorId = vendorID(user);
		if (!vendorId) return respondWithError(res, 403, 'Forbidden: Vendor ID not found', ERROR_CODES.FORBIDDEN);

		const result = await Coupon.delete(couponId, vendorId);
		if (!result) return respondWithError(res, 400, 'Failed to delete coupon', ERROR_CODES.RESOURCE_NOT_FOUND);

		return respondWithSuccess(res, 200, 'Coupon deleted successfully', result);
	} catch (error) {
		console.error('Error deleting coupon:', error);
		return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
	}
};

