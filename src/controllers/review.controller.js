import Product from "#models/products.model.js";
import Review from "#models/review.model.js";
import createReviewSchema from "#schemas/reviews.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const createReview = async (req, res) => {
    try {
        const { body, session, params } = req;
        const user = session?.user;
        const { productID } = params;

        const { rate, comment } = body;
        const { error } = createReviewSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const product = await Product.findById(productID, user.vendor_id);
        if(!product){
            return respondWithError(res, 404, "Product not found", ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        // check if customer bought this product
        // check if customer has already given a review
        const submit = await Review.create(productID, user.id, vendorId, body);
        if (!submit) {
            return respondWithError(res, 400, "Failed to submit review", ERROR_CODES.OPERATION_FAILED);
        }

        return respondWithSuccess(res, 200, "Review submitted successfully", submit);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export default {
    createReview
}