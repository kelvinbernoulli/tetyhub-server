import Review from '#models/review.model.js';
import {
    createReviewSchema,
    updateReviewSchema,
    moderateReviewSchema,
    reviewListSchema,
    privateReviewListSchema,
} from '#schemas/reviews.schema.js';
import { ROLES, isPlatformActor } from '#utils/access-control.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

const fail = (message, status) => Object.assign(new Error(message), { status });
const id = (value) => {
    const number = Number(value);
    if (
        !/^\d+$/.test(String(value)) ||
        !Number.isSafeInteger(number) ||
        number < 1 ||
        number > 2147483647
    )
        throw fail('Invalid review or resource ID', 400);
    return number;
};
const actor = (req, staff = false) => {
    if (!req.auth?.userId) throw fail('Unauthorized: Login to continue', 401);
    if (
        staff
            ? !isPlatformActor(req.auth.role)
            : req.auth.role !== ROLES.CUSTOMER
    )
        throw fail('You are not allowed to perform this action', 403);
    return req.auth.userId;
};
const validate = (schema, data) => {
    const { error, value } = schema.validate(data ?? {}, { abortEarly: false });
    if (error) throw fail(error.details[0].message, 400);
    return value;
};
const target = (req) =>
    req.params.serviceId !== undefined
        ? ['service', id(req.params.serviceId)]
        : ['product', id(req.params.productId ?? req.params.productID)];
const handleError = (res, error) => {
    const status = error.status || 500;
    const codes = {
        400: ERROR_CODES.VALIDATION_ERROR,
        401: ERROR_CODES.UNAUTHORIZED,
        403: ERROR_CODES.FORBIDDEN,
        404: ERROR_CODES.RESOURCE_NOT_FOUND,
        409: ERROR_CODES.RESOURCE_CONFLICT,
    };
    if (status === 500) console.error('Review operation failed:', error);
    return respondWithError(
        res,
        status,
        status === 500 ? 'Internal server error' : error.message,
        codes[status] || ERROR_CODES.INTERNAL_SERVER_ERROR
    );
};

export const createReview = async (req, res) => {
    try {
        const userId = actor(req);
        const [kind, resourceId] = target(req);
        const value = validate(createReviewSchema, req.body);
        const review = await Review.create(kind, resourceId, userId, value);
        return respondWithSuccess(
            res,
            201,
            'Review submitted for approval',
            review
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const updateReview = async (req, res) => {
    try {
        const userId = actor(req);
        const review = await Review.update(
            id(req.params.reviewId),
            userId,
            validate(updateReviewSchema, req.body)
        );
        return respondWithSuccess(res, 200, 'Review updated', review);
    } catch (error) {
        return handleError(res, error);
    }
};

export const deleteReview = async (req, res) => {
    try {
        const userId = actor(req);
        const result = await Review.delete(id(req.params.reviewId), userId);
        return respondWithSuccess(
            res,
            200,
            'Review deleted successfully',
            result
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const fetchReviews = async (req, res) => {
    try {
        const [kind, resourceId] = target(req);
        const result = await Review.listPublic(
            kind,
            resourceId,
            validate(reviewListSchema, req.query)
        );
        return respondWithSuccess(
            res,
            200,
            'Reviews fetched successfully',
            result
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const fetchMyReviews = async (req, res) => {
    try {
        const userId = actor(req);
        const result = await Review.list(
            userId,
            validate(privateReviewListSchema, req.query)
        );
        return respondWithSuccess(
            res,
            200,
            'Reviews fetched successfully',
            result
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const fetchAdminReviews = async (req, res) => {
    try {
        const userId = actor(req, true);
        const result = await Review.list(
            userId,
            validate(privateReviewListSchema, req.query),
            true
        );
        return respondWithSuccess(
            res,
            200,
            'Reviews fetched successfully',
            result
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const moderateReview = async (req, res) => {
    try {
        const userId = actor(req, true);
        const review = await Review.moderate(
            id(req.params.reviewId),
            userId,
            validate(moderateReviewSchema, req.body)
        );
        return respondWithSuccess(res, 200, 'Review moderation saved', review);
    } catch (error) {
        return handleError(res, error);
    }
};

export const deleteAdminReview = async (req, res) => {
    try {
        const userId = actor(req, true);
        const result = await Review.delete(
            id(req.params.reviewId),
            userId,
            true
        );
        return respondWithSuccess(
            res,
            200,
            'Review deleted successfully',
            result
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const viewReview = async (req, res) => {
    try {
        const userId = actor(req);
        const review = await Review.view(id(req.params.reviewId), userId);
        return respondWithSuccess(
            res,
            200,
            'Review fetched successfully',
            review
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export const viewAdminReview = async (req, res) => {
    try {
        const userId = actor(req, true);
        const review = await Review.view(id(req.params.reviewId), userId, true);
        return respondWithSuccess(
            res,
            200,
            'Review fetched successfully',
            review
        );
    } catch (error) {
        return handleError(res, error);
    }
};

export default {
    viewReview,
    viewAdminReview,
    createReview,
    updateReview,
    deleteReview,
    fetchReviews,
    fetchMyReviews,
    fetchAdminReviews,
    moderateReview,
    deleteAdminReview,
};
