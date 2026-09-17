import { base64ImagePattern } from '#utils/helpers.js';
import Joi from 'joi';

const optionalText = Joi.string().trim().allow('', null);

export const updateVendorSettingsSchema = Joi.object({
    store_name: optionalText,
    description: optionalText,
    logo: Joi.string().pattern(base64ImagePattern).allow('', null),
    banner: optionalText,
    phone_one: optionalText,
    phone_two: optionalText,
    facebook: optionalText,
    twitter: optionalText,
    instagram: optionalText,
    linkedIn: optionalText,
    snapchat: optionalText,
    whatsapp: optionalText,
    email: Joi.string().trim().email().allow('', null),
    website: Joi.string().trim().uri({ scheme: ['https'] }).allow('', null),
    address: optionalText,
    city: optionalText,
    state: optionalText,
    postal_code: optionalText,
    country_id: Joi.number().integer().positive().max(2147483647).allow(null),
    terms_and_conditions: optionalText,
    privacy_policy: optionalText,
}).min(1).required().unknown(false);
