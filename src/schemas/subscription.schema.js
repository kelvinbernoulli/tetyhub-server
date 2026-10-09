import Joi from 'joi';

export const subscriptionCheckoutSchema = Joi.object({
    plan: Joi.string().valid('PRO', 'BUSINESS').required(),
    renewalMode: Joi.string()
        .valid('automatic', 'manual')
        .default('automatic'),
}).unknown(false);

export const subscriptionDowngradeSchema = Joi.object({
    plan: Joi.string().valid('FREE', 'PRO', 'BUSINESS').required(),
}).unknown(false);

