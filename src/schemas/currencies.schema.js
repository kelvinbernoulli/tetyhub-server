import Joi from "joi";

export const createCurrencySchema = Joi.object({
    name: Joi.string().required().label('Currency Name'),
    currency_code: Joi.string().length(3).uppercase().required().label('Currency Code'),
});

export const updateCurrencySchema = Joi.object({
    name: Joi.string().label('Currency Name'),
    currency_code: Joi.string().length(3).uppercase().label('Currency Code'),
    status: Joi.boolean().valid(true, false).label('Currency Status')
}).min(1);

export default {
    createCurrencySchema,
    updateCurrencySchema
}
