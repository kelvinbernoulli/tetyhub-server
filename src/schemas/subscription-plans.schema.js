import Joi from 'joi';

export const subscriptionPlanSchema = Joi.object({
    priceNaira: Joi.string()
        .pattern(/^\d{1,8}(\.\d{1,2})?$/)
        .required(),
    commissionPercent: Joi.number().min(0).max(100).precision(2).required(),
    activeServices: Joi.alternatives()
        .try(Joi.number().integer().min(0), Joi.valid(null))
        .required(),
    packagesPerService: Joi.number().integer().min(0).required(),
    portfolioImages: Joi.number().integer().min(0).required(),
    promotedSlotsPerMonth: Joi.number().integer().min(0).required(),
    analytics: Joi.string().valid('none', 'basic', 'full').required(),
    support: Joi.string().valid('standard', 'priority').required(),
}).unknown(false);
