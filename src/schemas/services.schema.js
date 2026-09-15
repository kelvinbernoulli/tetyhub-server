import Joi from 'joi';
import { normalizeServiceState } from '#utils/service-state.js';

const MAX_INT = 2147483647;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const identifier = Joi.number().integer().positive().max(MAX_INT);
const money = Joi.number().positive().precision(2).max(99999999.99);

// Matches the pattern in your product schema: validate shape via regex,
// then re-check the decoded byte length so oversized payloads are rejected
// before they ever reach the DB/storage layer.
const base64Image = Joi.string()
    .max(4 * Math.ceil(MAX_IMAGE_BYTES / 3) + 32)
    .custom((value, helpers) => {
        const match =
            /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
                value
            );
        if (!match) return helpers.error('any.invalid');
        const bytes = Buffer.from(match[2], 'base64');
        if (
            !bytes.length ||
            bytes.length > MAX_IMAGE_BYTES ||
            bytes.toString('base64') !== match[2]
        ) {
            return helpers.error('any.invalid');
        }
        return value;
    })
    .messages({
        'string.pattern.base':
            '{{#label}} must be a valid base64 image data URL',
        'any.invalid':
            '{{#label}} must be a valid PNG, JPEG or WebP base64 data URL, at most 2 MiB',
    });

const fields = {
    category_id: identifier,
    subcategory_id: identifier.allow(null),
    childcategory_id: identifier.allow(null),
    name: Joi.string().trim().min(3).max(100),
    short_description: Joi.string().trim().max(300).allow(null, ''),
    description: Joi.string().trim().min(10).max(2000).allow(null),
    tags: Joi.array().items(Joi.string().trim().max(50)).max(20).unique(),
    status: Joi.string().valid('active', 'paused'),
    base_price: money.max(10000000),
    compare_at_price: money.allow(null),
    currency_id: identifier,
    duration_mins: Joi.number().integer().min(15).max(480),
    buffer_mins: Joi.number().integer().min(0).max(120),
    max_bookings_per_slot: Joi.number().integer().min(1).max(MAX_INT),
    is_remote: Joi.boolean(),
    location_type: Joi.string().valid(
        'vendor_location',
        'customer_location',
        'remote'
    ),
    cancellation_window_hours: Joi.number().integer().min(0).max(720),
    cancellation_fee_percent: Joi.number()
        .precision(2)
        
        .min(0)
        .max(100),
    images: Joi.array().items(base64Image).max(5),
    thumbnail: base64Image.allow(null),
    meta_title: Joi.string().trim().max(255).allow(null, ''),
    meta_description: Joi.string().trim().max(500).allow(null, ''),
};

const validateState = (creating) => (value, helpers) => {
    try {
        const normalized = normalizeServiceState(value, {}, creating);
        return creating ? normalized : value;
    } catch (error) {
        return helpers.message({ custom: error.message });
    }
};

export const createServiceSchema = Joi.object(fields)
    .keys({
        category_id: identifier.required(),
        subcategory_id: identifier.optional(),
        childcategory_id: identifier.optional(),
        name: fields.name.required(),
        description: Joi.string().trim().min(10).max(2000).required(),
        base_price: fields.base_price.required(),
        currency_id: identifier.required(),
        thumbnail: base64Image.required(), // required only at creation
        status: fields.status.default('active'),
        duration_mins: fields.duration_mins.default(60),
        buffer_mins: fields.buffer_mins.default(0),
        max_bookings_per_slot: fields.max_bookings_per_slot.default(1),
        cancellation_window_hours: fields.cancellation_window_hours.default(24),
        cancellation_fee_percent: fields.cancellation_fee_percent.default(0),
        images: fields.images.default([]),
        tags: fields.tags.default([]),
    })
    .unknown(false)
    .required()
    .custom(validateState(true))
    .prefs({ abortEarly: false });

// Do not derive omitted update fields here: the model uses the locked current row.
export const updateServiceSchema = Joi.object(fields)
    .unknown(false)
    .required()
    .min(1)
    .custom(validateState(false))
    .prefs({ abortEarly: false });

export const serviceIdSchema = identifier.required();

export const serviceSearchSchema = Joi.object({
    search: Joi.string().trim().max(255),
    category_id: identifier,
    subcategory_id: identifier,
    childcategory_id: identifier,
    status: Joi.string().valid('active', 'paused'),
    min_price: Joi.number().min(0).max(99999999.99),
    max_price: Joi.number().min(0).max(99999999.99),
    is_remote: Joi.boolean(),
    location_type: fields.location_type,
    sort_by: Joi.string()
        .valid(
            'created_at',
            'updated_at',
            'name',
            'base_price',
            'duration_mins'
        )
        .default('created_at'),
    sort_order: Joi.string().uppercase().valid('ASC', 'DESC').default('DESC'),
    offset: Joi.number().integer().min(0).max(MAX_INT).default(0),
    limit: Joi.number().integer().min(1).max(50).default(20),
})
    .unknown(false)
    .required()
    .custom((value, helpers) => {
        if (
            value.min_price !== undefined &&
            value.max_price !== undefined &&
            value.max_price < value.min_price
        )
            return helpers.message({
                custom: 'Max price must be greater than or equal to min price',
            });
        return value;
    })
    .prefs({ abortEarly: false });

// Public browsing cannot request paused or deleted services.
export const publicServiceSearchSchema = serviceSearchSchema.keys({
    status: Joi.string().valid('active'),
});
