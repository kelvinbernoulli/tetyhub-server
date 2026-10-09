import Joi from 'joi';

export const updateCommissionRatesSchema = Joi.object({
    product_rate: Joi.number()
        .min(0)
        .max(100)
        .custom((value, helpers) =>
            Math.abs(value * 100 - Math.round(value * 100)) < 1e-8
                ? value
                : helpers.error('number.precision')
        )
        .required(),
    service_rate: Joi.number()
        .min(0)
        .max(100)
        .custom((value, helpers) =>
            Math.abs(value * 100 - Math.round(value * 100)) < 1e-8
                ? value
                : helpers.error('number.precision')
        )
        .required(),
});

export default { updateCommissionRatesSchema };
