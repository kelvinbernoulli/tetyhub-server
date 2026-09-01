import { base64ImagePattern } from "#utils/helpers.js";
import Joi from "joi";

export const createProductSchema = Joi.object({
    // Basic Info
    name: Joi.string().trim().min(3).max(255).required().label("Product Name"),
    description: Joi.string().trim().min(10).max(5000).optional().label("Description"),
    short_description: Joi.string().trim().max(500).optional().label("Short Description"),
    sku: Joi.string().trim().max(100).optional().label("SKU"), // unique identifier for the product
    barcode: Joi.string().trim().max(100).optional().label("Barcode"),

    // Pricing
    price: Joi.number().precision(2).positive().required().label("Price"), // selling price
    compare_at_price: Joi.number().precision(2).positive().optional().label("Compare At Price"), // original price before discount
    cost_price: Joi.number().precision(2).positive().optional().label("Cost Price"), // vendor paid
    discount: Joi.number().precision(2).min(0).max(100).optional().label("Discount (%)"), // percentage discount for the product

    // Inventory
    stock: Joi.number().integer().min(1).required().label("Stock"), // available quantity
    low_stock_threshold: Joi.number().integer().min(0).optional().label("Low Stock Threshold"), // threshold to trigger low stock alert
    track_inventory: Joi.boolean().default(true).label("Track Inventory"), // whether to track inventory for this product

    // Categorization
    category_id: Joi.number().integer().positive().required().label("Category ID"),
    subcategory_id: Joi.number().integer().positive().optional().label("Subcategory ID"),
    child_subcategory_id: Joi.number().integer().positive().optional().label("Child subcategory ID"),
    brand: Joi.string().trim().max(255).optional().label("Brand"),
    tags: Joi.array().items(Joi.string().trim().max(50)).max(20).optional().label("Tags"),

    // Media
    images: Joi.array()
        .items(Joi.string().pattern(base64ImagePattern))
        .min(1)
        .max(10)
        .optional()
        .label("Images"),
    thumbnail: Joi.string().pattern(base64ImagePattern).optional().label("Thumbnail"),

    // Shipping
    weight: Joi.number().positive().optional().label("Weight (kg)"),
    length: Joi.number().positive().optional().label("Length (cm)"),
    width: Joi.number().positive().optional().label("Width (cm)"),
    height: Joi.number().positive().optional().label("Height (cm)"),
    free_shipping: Joi.boolean().default(false).label("Free Shipping"),
    
    // Status
    status: Joi.string()
        .valid('active', 'inactive', 'draft', 'archived')
        .default('draft')
        .label("Status"),
    is_featured: Joi.boolean().default(false).label("Featured"),
    is_digital: Joi.boolean().default(false).label("Digital Product"),

    // SEO
    meta_title: Joi.string().trim().max(255).optional().label("Meta Title"),
    meta_description: Joi.string().trim().max(500).optional().label("Meta Description"),
}).options({ stripUnknown: true });

export const updateProductSchema = Joi.object({
    name: Joi.string()
        .trim()
        .min(3)
        .max(255)
        .optional()
        .label("Product Name"),

    description: Joi.string()
        .trim()
        .min(10)
        .max(5000)
        .optional()
        .label("Description"),

    short_description: Joi.string()
        .trim()
        .max(500)
        .allow(null, '')
        .optional()
        .label("Short Description"),

    price: Joi.number()
        .precision(2)
        .min(0)
        .optional()
        .label("Price"),

    compare_at_price: Joi.number()
        .precision(2)
        .min(0)
        .allow(null)
        .optional()
        .label("Compare At Price"),

    cost_price: Joi.number()
        .precision(2)
        .min(0)
        .allow(null)
        .optional()
        .label("Cost Price"),

    discount: Joi.number()
        .precision(2)
        .min(0)
        .max(100)
        .optional()
        .label("Discount (%)"),

    stock: Joi.number()
        .integer()
        .min(1)
        .optional()
        .label("Stock"),

    low_stock_threshold: Joi.number()
        .integer()
        .min(0)
        .optional()
        .label("Low Stock Threshold"),

    track_inventory: Joi.boolean()
        .optional()
        .label("Track Inventory"),

    category_id: Joi.number()
        .integer()
        .positive()
        .optional()
        .label("Category ID"),

    subcategory_id: Joi.number()
        .integer()
        .positive()
        .allow(null)
        .optional()
        .label("Subcategory ID"),

    child_subcategory_id: Joi.number()
        .integer()
        .positive()
        .allow(null)
        .optional()
        .label("Child subcategory ID"),

    brand: Joi.string()
        .trim()
        .max(255)
        .allow(null, '') // allow removing brand
        .optional()
        .label("Brand"),

    tags: Joi.array()
        .items(Joi.string().trim().max(50))
        .max(20)
        .optional()
        .label("Tags"),

    images: Joi.array()
        .items(Joi.string().pattern(base64ImagePattern))
        .max(10)
        .optional()
        .label("Images"),

    thumbnail: Joi.string()
        .pattern(base64ImagePattern)
        .allow(null) // allow removing thumbnail
        .optional()
        .label("Thumbnail"),

    weight: Joi.number()
        .min(0)
        .allow(null)
        .optional()
        .label("Weight (kg)"),

    length: Joi.number()
        .min(0)
        .allow(null)
        .optional()
        .label("Length (cm)"),

    width: Joi.number()
        .min(0)
        .allow(null)
        .optional()
        .label("Width (cm)"),

    height: Joi.number()
        .min(0)
        .allow(null)
        .optional()
        .label("Height (cm)"),

    free_shipping: Joi.boolean()
        .optional()
        .label("Free Shipping"),

    status: Joi.string()
        .valid('active', 'inactive', 'draft', 'archived')
        .optional()
        .label("Status"),

    is_featured: Joi.boolean()
        .optional()
        .label("Featured"),

    is_digital: Joi.boolean()
        .optional()
        .label("Digital Product"),

    meta_title: Joi.string()
        .trim()
        .max(255)
        .allow(null, '')
        .optional()
        .label("Meta Title"),

    meta_description: Joi.string()
        .trim()
        .max(500)
        .allow(null, '')
        .optional()
        .label("Meta Description"),
})
.min(1)
.custom((value, helpers) => {
    // compare_at_price >= price
    if (
        value.compare_at_price !== undefined &&
        value.price !== undefined &&
        value.compare_at_price < value.price
    ) {
        return helpers.error("any.invalid", {
            message: "Compare price must be >= price"
        });
    }

    return value;
});

export const productSearchSchema = Joi.object({
    q:              Joi.string().trim().max(255).optional().label("Search Query"),
    category_id:    Joi.number().integer().positive().optional().label("Category ID"),
    brand:          Joi.string().trim().max(255).optional().label("Brand"),
    min_price:      Joi.number().precision(2).positive().optional().label("Min Price"),
    max_price:      Joi.number().precision(2).positive().optional().label("Max Price"),
    in_stock:       Joi.boolean().optional().label("In Stock"),
    is_featured:    Joi.boolean().optional().label("Featured"),
    is_digital:     Joi.boolean().optional().label("Digital"),
    tags:           Joi.array().items(Joi.string().trim()).optional().label("Tags"),
    status:         Joi.string().valid('active', 'inactive', 'draft', 'archived').optional().label("Status"),
    sort_by:        Joi.string().valid('price_asc', 'price_desc', 'newest', 'oldest', 'popular', 'rating').optional().label("Sort By"),
    offset:         Joi.number().integer().min(0).default(0).optional().label("Offset"),
    limit:          Joi.number().integer().min(1).max(100).default(40).optional().label("Limit"),
});

export default {
    createProductSchema,
    updateProductSchema,
    productSearchSchema
};