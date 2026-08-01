import Cart from "#models/cart.model.js";
import VendorModel from "#models/vendor.model.js";
import { addToCartSchema, checkoutSchema, upsertCartSchema } from "#schemas/cart.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const addToCart = async (req, res) => {
    try {
        const { body, session } = req;

        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, "Unauthorized", ERROR_CODES.UNAUTHORIZED);
        }

        const { error, value } = addToCartSchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details.map(err => err.message).join(", "), ERROR_CODES.VALIDATION_ERROR);
        }
        console.log("Validated add to cart data:", value);

        const result = await Cart.addToCart(user.id, value);

        if (result?.error) {
            return respondWithError(res, 400, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200,"Item added to cart", result);

    } catch (error) {
        console.error("Add to cart controller error:", error);
        return respondWithError(res, 500, error.message || "Internal Server Error", ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const cartItems = async (req, res) => {
    try {
        const { session, pagination } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const result = await Cart.getCartItems(user.id, user.vendor_id, pagination);

        // Handle model-level errors
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200, 'Item added to cart', result);
    } catch (error) {
        console.error("Error adding to cart:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const upsertCart = async (req, res) => {
    try {
        const { body, session } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { error, value } = upsertCartSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Cart.updateCart(user.id, user.vendor_id, value);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200, 'Cart updated successfully', result);
    } catch (error) {
        console.error("Error upserting cart item:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const removeFromCart = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { itemId } = params;

        if (!itemId) {
            return respondWithError(res, 400, 'Cart item ID is required', ERROR_CODES.BAD_REQUEST);
        }

        const result = await Cart.removeFromCart(user.id, user.vendor_id, itemId);

        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Item removed from cart', result);
    } catch (error) {
        console.error("Error removing cart item:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const previewCheckout = async (req, res) => {
    try {
        const { session, query } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { coupon_code } = query;

        const result = await Cart.previewCheckout(user.id, user.vendor_id, coupon_code);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200, 'Checkout preview fetched successfully', result);
    } catch (error) {
        console.error("Error previewing checkout:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const validateCoupon = async (req, res) => {
    try {
        const { session, params, body } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { coupon_code, subtotal } = body;

        if (!coupon_code || !subtotal) {
            return respondWithError(res, 400, 'Coupon code and subtotal are required', ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Cart.validateCoupon(coupon_code, user.vendor_id, user.id, subtotal);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200, 'Coupon applied successfully', {
            discount: result.discount,
            coupon: result.coupon
        });
    } catch (error) {
        console.error("Error validating coupon:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const processCheckout = async (req, res) => {
    try {
        const { session, params, body } = req;
        const user = session?.user;
        
        const { error } = checkoutSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const vendor = await VendorModel.getVendorById(user.vendor_id);

        const result = await Cart.processCheckout(user, vendor, body);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200, 'Order placed successfully', result);
    } catch (error) {
        console.error("Error processing checkout:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};