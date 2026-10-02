import Joi from 'joi';

const fields = {
    rating: Joi.number().integer().min(1).max(5).label('Rating'),
    title: Joi.string().trim().min(2).max(150).allow(null).label('Title'),
    comment: Joi.string().trim().min(2).max(500).allow(null).label('Comment'),
};

// Keep the original request name working while persisting the database's rating field.
export const createReviewSchema = Joi.object({
    ...fields,
    rating: fields.rating.required(),
}).rename('rate', 'rating');

export const updateReviewSchema = Joi.object(fields)
    .min(1)
    .rename('rate', 'rating');

export const moderateReviewSchema = Joi.object({
    status: Joi.string().valid('pending', 'approved', 'rejected').required(),
    revision: Joi.number().integer().positive().required(),
    moderation_note: Joi.string().trim().min(2).max(500).allow(null),
});

export const reviewListSchema = Joi.object({
    offset: Joi.number().integer().min(0).default(0),
    limit: Joi.number().integer().min(1).max(100).default(20),
    rating: Joi.number().integer().min(1).max(5),
});

export const privateReviewListSchema = reviewListSchema
    .keys({
        status: Joi.string().valid('pending', 'approved', 'rejected'),
        product_id: Joi.number().integer().positive().max(2147483647),
        service_id: Joi.number().integer().positive().max(2147483647),
    })
    .oxor('product_id', 'service_id');

export default createReviewSchema;
