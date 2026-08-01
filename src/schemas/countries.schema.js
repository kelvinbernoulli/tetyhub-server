import { base64ImagePattern } from "#utils/helpers.js";
import Joi from "joi";

export const createCountrySchema = Joi.object({
    name: Joi.string().required().label('Country Name'),
    country_code: Joi.string().length(2).uppercase().required().label('Country Code'),
    dial_code: Joi.string().required().label('Dial Code'),
    currency_id: Joi.number().required().label('Currency ID'),
    flag: Joi.string().pattern(base64ImagePattern).required().label('Flag'),
    status: Joi.boolean().valid(true, false).required().label('Status'),
});

export const updateCountrySchema = Joi.object({
    name: Joi.string().optional().label('Country Name'),
    country_code: Joi.string().length(2).uppercase().optional().label('Country Code'),
    dial_code: Joi.string().optional().label('Dial Code'),
    currency_id: Joi.number().optional().label('Currency ID'),
    flag: Joi.string().pattern(base64ImagePattern).optional().label('Flag'),
    status: Joi.boolean().valid(true, false).optional().label('Status'),
}).min(1);

export default {
    createCountrySchema,
    updateCountrySchema
}