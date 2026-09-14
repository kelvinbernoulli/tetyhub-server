import Joi from 'joi';

export const bookingIdSchema = Joi.number()
    .integer()
    .positive()
    .max(2147483647)
    .required();
const scheduled = Joi.string()
    .isoDate()
    .strict()
    .pattern(/(?:Z|[+-]\d{2}:\d{2})$/)
    .required();
export const createBookingSchema = Joi.object({
    service_id: bookingIdSchema,
    scheduled_for: scheduled,
    gateway: Joi.string().valid('paystack').required(),
    expected_currency: Joi.string()
        .valid('NGN')
        .required(),
    expected_total: Joi.number()
        .positive()
        .max(99999999.99)
        .precision(2)
        .required(),
    // idempotency_key: Joi.string().guid({ version: 'uuidv4' }).required(),
    location: Joi.string().trim().max(1000),
    additional_notes: Joi.string().trim().max(1000),
})
    .required()
    .options({ allowUnknown: false, stripUnknown: false });
export const availabilitySchema = Joi.object({
    scheduled_for: scheduled,
}).required();
export const bookingListSchema = Joi.object({
    status: Joi.string().valid(
        'pending',
        'confirmed',
        'active',
        'completed',
        'cancelled',
        'expired',
        'payment_review'
    ),
    limit: Joi.number().integer().min(1).max(100).default(20),
    offset: Joi.number().integer().min(0).max(2147483647).default(0),
}).options({ allowUnknown: false, stripUnknown: false });
export const cancelBookingSchema = Joi.object({
    reason: Joi.string().trim().min(1).max(1000).required(),
}).required();
export const bookingStatusSchema = Joi.object({
    status: Joi.string().valid('active', 'completed').required(),
}).required();
