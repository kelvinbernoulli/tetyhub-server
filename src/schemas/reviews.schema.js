import Joi, { optional } from "joi";

export const createReviewSchema = Joi.object({
    rate: Joi.number().min(1).max(5).optional().label("Rate"),
    comment: Joi.string().min(2).max(500).optional().label("Comment")
}).min(1);

export default createReviewSchema;