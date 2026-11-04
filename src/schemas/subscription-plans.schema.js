import Joi from 'joi';

export const subscriptionPlanSchema = Joi.object({
    price: Joi.string()
        .pattern(/^\d{1,8}(\.\d{1,2})?$/)
        .required(),
    commission_percent: Joi.number().min(0).max(100).precision(2).required(),
    active_services: Joi.alternatives()
        .try(Joi.number().integer().min(0), Joi.valid(null))
        .required(),
    promoted_slots: Joi.number().integer().min(0).required(),
    portfolio_images: Joi.number().integer().min(0).required()
}).unknown(false);