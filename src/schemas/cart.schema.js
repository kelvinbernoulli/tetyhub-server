import Joi from 'joi';

export const addToCartSchema = Joi.object({
    product_id: Joi.number()
        .integer()
        .positive()
        .required()
        .label('Product ID'),
    variant_id: Joi.number()
        .integer()
        .positive()
        .optional()
        .label('Variant ID'),
    quantity: Joi.number()
        .integer()
        .min(1)
        .max(100)
        .default(1)
        .optional()
        .label('Quantity'),
}).min(1);

export const upsertCartSchema = Joi.object({
    product_id: Joi.number()
        .integer()
        .positive()
        .required()
        .label('Product ID'),
    variant_id: Joi.number()
        .integer()
        .positive()
        .optional()
        .label('Variant ID'),
    quantity: Joi.number()
        .integer()
        .min(1)
        .max(100)
        .default(1)
        .required()
        .label('Quantity'),
});

export const checkoutSchema = Joi.object({
    expected_total: Joi.number().precision(2).positive().required().label('Total'),
    expected_currency: Joi.string().length(3).uppercase().default('NGN').required().label('Currency'),
    gateway: Joi.string().valid('paystack', 'stripe').default('paystack').required(),
    // idempotency_key: Joi.string().guid({ version: 'uuidv4' }).required(),
    firstname: Joi.string().trim().max(100).required().label('First Name'),
    lastname: Joi.string().trim().max(100).required().label('Last Name'),
    email: Joi.string().trim().max(255).email().required().label('Email'),
    phone_one: Joi.string()
        .trim()
        .pattern(/^\+?[1-9]\d{1,14}$/)
        .required()
        .label('Phone'),
    phone_two: Joi.string()
        .trim()
        .pattern(/^\+?[1-9]\d{1,14}$/)
        .optional()
        .allow(null, '')
        .label('Phone (alt)'),
    address: Joi.string().trim().max(500).required().label('Address'),
    city: Joi.string().trim().max(100).required().label('City'),
    state: Joi.string().trim().max(100).required().label('State'),
    country: Joi.string().trim().max(100).required().label('Country'),
    zip_code: Joi.string()
        .trim()
        .max(20)
        .optional()
        .allow(null, '')
        .label('Zip Code'),
    coupon_code: Joi.string()
        .trim()
        .max(50)
        .optional()
        .allow(null, '')
        .label('Coupon Code'),
    note: Joi.string()
        .trim()
        .max(500)
        .optional()
        .allow(null, '')
        .label('Order Note'),
}).options({ stripUnknown: true });

export default {
    addToCartSchema,
    upsertCartSchema,
    checkoutSchema,
};
