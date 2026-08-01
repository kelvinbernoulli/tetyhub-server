import Wishlist from "#models/wishlist.model.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";


export const addToWishList = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { product_id } = params;

        if (!product_id) {
            return respondWithError(res, 400, 'Product ID is required', ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Wishlist.addToWishlist(user.id, user.vendor_id, product_id);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 201, 'Item added to wishlist', result);
    } catch (error) {
        console.error("Error adding wishlist:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const wishListItems = async (req, res) => {
    try {
        const { session, pagination } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { offset, limit } = pagination;

        const result = await Wishlist.getWishlistItems(user.id, user.vendor_id, { offset, limit });

        return respondWithSuccess(res, 200, 'Wishlist items fetched successfully', result);
    } catch (error) {
        console.error("Error fetching wishlist items:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const removeFromWishList = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { wishlist_item_id } = params;

        if (!wishlist_item_id) {
            return respondWithError(res, 400, 'Wishlist item ID is required', ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Wishlist.removeFromWishlist(user.id, user.vendor_id, wishlist_item_id);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Item removed from wishlist', result);
    } catch (error) {
        console.error("Error removing item from wishlist:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const moveToCart = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { wishlist_item_id } = params;

        const result = await Wishlist.moveToCart(user.id, user.vendor_id, wishlist_item_id);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.VALIDATION_ERROR);
        }

        return respondWithSuccess(res, 200, 'Item moved to cart', result);
    } catch (error) {
        console.error("Error moving to cart:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};