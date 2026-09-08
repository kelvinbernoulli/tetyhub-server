import Joi from 'joi';

// PostgreSQL Int and Decimal(10, 2) limits.
const MAX_INT = 2147483647;
const MAX_PRICE = 99999999.99;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const imageSchema = Joi.string()
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
        'any.invalid':
            '{{#label}} must be a valid PNG, JPEG or WebP base64 data URL, at most 2 MiB',
    });

const validatePrices = (value, helpers) => {
    // Partial updates must also be checked against persisted prices in the service.
    if (
        value.price !== undefined &&
        value.compare_at_price != null &&
        value.compare_at_price < value.price
    ) {
        return helpers.message({
            custom: 'Compare At Price must be greater than or equal to Price',
        });
    }
    return value;
};

const variantSchema = Joi.object({
    sku: Joi.string().trim().max(100).allow(null),
    barcode: Joi.string().trim().max(100).allow(null),
    price: Joi.number().precision(2).strict().min(0).max(MAX_PRICE).required(),
    compare_at_price: Joi.number()
        .precision(2)
        .strict()
        .min(0)
        .max(MAX_PRICE)
        .allow(null),
    cost_price: Joi.number()
        .precision(2)
        .strict()
        .min(0)
        .max(MAX_PRICE)
        .allow(null),
    stock: Joi.number().integer().min(0).max(MAX_INT).required(),
    low_stock_threshold: Joi.number().integer().min(0).max(MAX_INT),
    weight: Joi.number().positive().allow(null),
    image: imageSchema.allow(null),
})
    .unknown(false)
    .custom(validatePrices);

const optionValues = Joi.array()
    .items(Joi.number().integer().positive().max(MAX_INT))
    .unique()
    .max(20);
const optionMapping = Joi.object()
    .pattern(
        Joi.string().trim().min(1).max(100),
        Joi.string().trim().min(1).max(100)
    )
    .max(20);
const createVariant = variantSchema.keys({
    option_values: optionValues.default([]),
    options: optionMapping,
});
const updateVariant = variantSchema.keys({
    id: Joi.number().integer().positive().max(MAX_INT),
    option_values: optionValues,
    options: optionMapping,
});
const attributesSchema = Joi.array()
    .items(
        Joi.object({
            name: Joi.string().trim().max(100).required(),
            value: Joi.string().trim().max(500).required(),
        }).unknown(false)
    )
    .max(50)
    .unique('name');
const optionsSchema = Joi.array()
    .items(
        Joi.object({
            name: Joi.string().trim().max(100).required(),
            values: Joi.array()
                .items(Joi.string().trim().max(100))
                .min(1)
                .max(100)
                .unique()
                .required(),
        }).unknown(false)
    )
    .max(20)
    .unique('name');

const variantsSchema = (itemSchema) =>
    Joi.array()
        .items(itemSchema)
        .max(100)
        .when('has_variants', {
            is: Joi.valid(true).required(),
            then: Joi.array().min(1).required().messages({
                'any.required':
                    'Variants are required when has_variants is true',
                'array.min':
                    'Add at least one variant when has_variants is true',
            }),
        })
        .when('has_variants', {
            is: Joi.valid(false).required(),
            then: Joi.array()
                .max(0)
                .messages({
                    'array.max':
                        'Variants must be empty when has_variants is false',
                }),
        })
        .label('Variants');

export const createProductSchema = Joi.object({
    // Basic Info
    name: Joi.string().trim().min(3).max(255).required().label('Product Name'),
    description: Joi.string()
        .trim()
        .min(10)
        .max(5000)
        .optional()
        .label('Description'),
    short_description: Joi.string()
        .trim()
        .max(500)
        .optional()
        .label('Short Description'),
    sku: Joi.string().trim().max(100).optional().label('SKU'), // unique identifier for the product
    barcode: Joi.string().trim().max(100).optional().label('Barcode'),

    currency_id: Joi.number()
        .integer()
        .max(MAX_INT)
        .positive()
        .required()
        .label('Currency ID'),

    // Pricing
    price: Joi.number()
        .precision(2)
        .strict()
        .min(0)
        .max(MAX_PRICE)
        .required()
        .label('Price'), // selling price
    compare_at_price: Joi.number()
        .precision(2)
        .strict()
        .min(0)
        .max(MAX_PRICE)
        .optional()
        .label('Compare At Price'), // original price before discount
    cost_price: Joi.number()
        .precision(2)
        .strict()
        .min(0)
        .max(MAX_PRICE)
        .optional()
        .label('Cost Price'), // vendor paid
    discount: Joi.number()
        .precision(2)
        .strict()
        .min(0)
        .max(100)
        .optional()
        .label('Discount (%)'), // percentage discount for the product

    // Inventory
    stock: Joi.number().integer().max(MAX_INT).min(0).required().label('Stock'), // available quantity
    low_stock_threshold: Joi.number()
        .integer()
        .max(MAX_INT)
        .min(0)
        .optional()
        .label('Low Stock Threshold'), // threshold to trigger low stock alert
    track_inventory: Joi.boolean().default(true).label('Track Inventory'), // whether to track inventory for this product

    // Categorization
    category_id: Joi.number()
        .integer()
        .max(MAX_INT)
        .positive()
        .required()
        .label('Category ID'),
    subcategory_id: Joi.number()
        .integer()
        .max(MAX_INT)
        .positive()
        .optional()
        .label('Subcategory ID'),
    childcategory_id: Joi.number()
        .integer()
        .max(MAX_INT)
        .positive()
        .optional()
        .label('Childcategory ID'),
    brand: Joi.string().trim().max(255).optional().label('Brand'),
    tags: Joi.array()
        .items(Joi.string().trim().max(50))
        .unique()
        .max(20)
        .optional()
        .label('Tags'),
    has_variants: Joi.boolean().default(false).label('Variants'),
    variants: variantsSchema(createVariant),
    attributes: attributesSchema,
    options: optionsSchema,

    // Media
    images: Joi.array()
        .items(imageSchema)
        .min(1)
        .max(10)
        .optional()
        .label('Images'),
    thumbnail: imageSchema.optional().label('Thumbnail'),

    // Shipping
    weight: Joi.number().positive().optional().label('Weight (kg)'),
    length: Joi.number().positive().optional().label('Length (cm)'),
    width: Joi.number().positive().optional().label('Width (cm)'),
    height: Joi.number().positive().optional().label('Height (cm)'),
    free_shipping: Joi.boolean().default(false).label('Free Shipping'),

    // Status
    status: Joi.string()
        .valid('active', 'inactive', 'draft', 'archived')
        .default('draft')
        .label('Status'),
    is_featured: Joi.boolean().default(false).label('Featured'),
    is_digital: Joi.boolean().default(false).label('Digital Product'),

    // SEO
    meta_title: Joi.string().trim().max(255).optional().label('Meta Title'),
    meta_description: Joi.string()
        .trim()
        .max(500)
        .optional()
        .label('Meta Description'),
})
    .unknown(false)
    .required()
    .custom(validatePrices)
    .prefs({ abortEarly: false });

export const updateProductSchema = Joi.object({
    has_variants: Joi.boolean().optional().label('Has Variants'),
    variants: variantsSchema(updateVariant).unique('id', {
        ignoreUndefined: true,
    }),
    attributes: attributesSchema,
    options: optionsSchema,
    sku: Joi.string().trim().max(100).allow(null),
    barcode: Joi.string().trim().max(100).allow(null),
    currency_id: Joi.number().integer().positive().max(MAX_INT),

    name: Joi.string().trim().min(3).max(255).optional().label('Product Name'),

    description: Joi.string()
        .trim()
        .min(10)
        .max(5000)
        .optional()
        .label('Description'),

    short_description: Joi.string()
        .trim()
        .max(500)
        .allow(null, '')
        .optional()
        .label('Short Description'),

    price: Joi.number()
        .precision(2)
        .strict()
        .min(0)
        .max(MAX_PRICE)
        .optional()
        .label('Price'),

    compare_at_price: Joi.number()
        .precision(2)
        .strict()
        .min(0)
        .max(MAX_PRICE)
        .allow(null)
        .optional()
        .label('Compare At Price'),

    cost_price: Joi.number()
        .precision(2)
        .strict()
        .min(0)
        .max(MAX_PRICE)
        .allow(null)
        .optional()
        .label('Cost Price'),

    discount: Joi.number()
        .precision(2)
        .strict()
        .min(0)
        .max(100)
        .optional()
        .label('Discount (%)'),

    stock: Joi.number().integer().max(MAX_INT).min(0).optional().label('Stock'),

    low_stock_threshold: Joi.number()
        .integer()
        .max(MAX_INT)
        .min(0)
        .optional()
        .label('Low Stock Threshold'),

    track_inventory: Joi.boolean().optional().label('Track Inventory'),

    category_id: Joi.number()
        .integer()
        .max(MAX_INT)
        .positive()
        .optional()
        .label('Category ID'),

    subcategory_id: Joi.number()
        .integer()
        .max(MAX_INT)
        .positive()
        .allow(null)
        .optional()
        .label('Subcategory ID'),

    childcategory_id: Joi.number()
        .integer()
        .max(MAX_INT)
        .positive()
        .allow(null)
        .optional()
        .label('Childcategory ID'),

    brand: Joi.string()
        .trim()
        .max(255)
        .allow(null, '') // allow removing brand
        .optional()
        .label('Brand'),

    tags: Joi.array()
        .items(Joi.string().trim().max(50))
        .unique()
        .max(20)
        .optional()
        .label('Tags'),

    images: Joi.array().items(imageSchema).max(10).optional().label('Images'),

    thumbnail: imageSchema
        .allow(null) // allow removing thumbnail
        .optional()
        .label('Thumbnail'),

    weight: Joi.number().min(0).allow(null).optional().label('Weight (kg)'),

    length: Joi.number().min(0).allow(null).optional().label('Length (cm)'),

    width: Joi.number().min(0).allow(null).optional().label('Width (cm)'),

    height: Joi.number().min(0).allow(null).optional().label('Height (cm)'),

    free_shipping: Joi.boolean().optional().label('Free Shipping'),

    status: Joi.string()
        .valid('active', 'inactive', 'draft', 'archived')
        .optional()
        .label('Status'),

    is_featured: Joi.boolean().optional().label('Featured'),

    is_digital: Joi.boolean().optional().label('Digital Product'),

    meta_title: Joi.string()
        .trim()
        .max(255)
        .allow(null, '')
        .optional()
        .label('Meta Title'),

    meta_description: Joi.string()
        .trim()
        .max(500)
        .allow(null, '')
        .optional()
        .label('Meta Description'),
})
    .min(1)
    .unknown(false)
    .required()
    .custom(validatePrices)
    .prefs({ abortEarly: false });

export const productSearchSchema = Joi.object({
    vendor_id: Joi.number().integer().positive().max(MAX_INT),
    subcategory_id: Joi.number().integer().positive().max(MAX_INT),
    childcategory_id: Joi.number().integer().positive().max(MAX_INT),
    search: Joi.string().trim().max(255),
    sort_order: Joi.string().uppercase().valid('ASC', 'DESC'),
    q: Joi.string().trim().max(255).optional().label('Search Query'),
    category_id: Joi.number()
        .integer()
        .max(MAX_INT)
        .positive()
        .optional()
        .label('Category ID'),
    brand: Joi.string().trim().max(255).optional().label('Brand'),
    min_price: Joi.number()
        .precision(2)
        .min(0)
        .max(MAX_PRICE)
        .optional()
        .label('Min Price'),
    max_price: Joi.number()
        .precision(2)
        .min(0)
        .max(MAX_PRICE)
        .optional()
        .label('Max Price'),
    in_stock: Joi.boolean().optional().label('In Stock'),
    is_featured: Joi.boolean().optional().label('Featured'),
    is_digital: Joi.boolean().optional().label('Digital'),
    tags: Joi.array()
        .items(Joi.string().trim().max(50))
        .max(20)
        .unique()
        .optional()
        .label('Tags'),
    status: Joi.string()
        .valid('active', 'inactive', 'draft', 'archived')
        .optional()
        .label('Status'),
    sort_by: Joi.string()
        .valid(
            'price_asc',
            'price_desc',
            'newest',
            'oldest',
            'popular',
            'rating',
            'created_at',
            'updated_at',
            'name',
            'price',
            'stock'
        )
        .optional()
        .label('Sort By'),
    offset: Joi.number()
        .integer()
        .max(MAX_INT)
        .min(0)
        .default(0)
        .optional()
        .label('Offset'),
    limit: Joi.number()
        .integer()
        .max(MAX_INT)
        .min(1)
        .max(100)
        .default(40)
        .optional()
        .label('Limit'),
})
    .unknown(false)
    .required()
    .custom((value, helpers) => {
        if (
            value.min_price !== undefined &&
            value.max_price !== undefined &&
            value.max_price < value.min_price
        ) {
            return helpers.message({
                custom: 'Max Price must be greater than or equal to Min Price',
            });
        }
        return value;
    })
    .prefs({ abortEarly: false });

export default {
    createProductSchema,
    updateProductSchema,
    productSearchSchema,
};
