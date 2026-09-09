import Product, { productError } from '#models/products.model.js';
import {
    createProductSchema,
    updateProductSchema,
    productSearchSchema,
} from '#schemas/products.schema.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';
import ERROR_CODES from '#utils/error.codes.js';

const validate = (schema, input) => {
    const { error, value } = schema.validate(input, { abortEarly: false });
    if (error)
        throw productError(
            error.details.map((detail) => detail.message).join(', '),
            400
        );
    return value;
};
const id = (value) => {
    if (
        !/^\d+$/.test(String(value)) ||
        !Number.isInteger(Number(value)) ||
        Number(value) < 1 ||
        Number(value) > 2147483647
    )
        throw productError('Invalid product ID', 400);
    return Number(value);
};
const vendor = (req) => {
    // Populated by authenticated middleware; never derive vendor identity from user.id.
    const vendorId = req.auth?.vendorId;
    if (!Number.isInteger(vendorId) || vendorId < 1)
        throw productError('Vendor authentication required', 403);
    return vendorId;
};
const endpoint =
    (action, message, status = 200) =>
    async (req, res) => {
        try {
            const result = await action(req);
            if (result === null)
                return respondWithError(
                    res,
                    404,
                    'Product not found',
                    ERROR_CODES.RESOURCE_NOT_FOUND
                );
            return respondWithSuccess(res, status, message, result);
        } catch (error) {
            const status =
                error.status ??
                (error.code === '23503'
                    ? 422
                    : error.code === '23505'
                      ? 409
                      : 500);
            if (status >= 500) console.error('Product request failed:', error);
            const message =
                error.status && status < 500
                    ? error.message
                    : status === 422
                      ? 'Invalid product reference'
                      : status === 409
                        ? 'Product data conflicts with an existing record'
                        : 'Internal Server Error';
            const code =
                status === 403
                    ? ERROR_CODES.FORBIDDEN
                    : status === 409
                      ? ERROR_CODES.RESOURCE_CONFLICT
                      : status < 500
                        ? ERROR_CODES.VALIDATION_ERROR
                        : ERROR_CODES.INTERNAL_SERVER_ERROR;
            return respondWithError(res, status, message, code);
        }
    };
const filters = (req, vendorView = false, defaultLimit = 20) => {
    const value = validate(productSearchSchema, {
        ...req.query,
        limit: req.query?.limit ?? defaultLimit,
    });
    if (!vendorView && value.status !== undefined && value.status !== 'active')
        throw productError('Only active products are available publicly', 400);
    if (vendorView && value.vendor_id !== undefined)
        throw productError('Vendor scope comes from authentication', 400);
    return value;
};

export const createProduct = endpoint(
    (req) =>
        Product.create(vendor(req), validate(createProductSchema, req.body)),
    'Product added successfully',
    201
);
export const updateProduct = endpoint(
    (req) =>
        Product.update(
            id(req.params.id),
            vendor(req),
            validate(updateProductSchema, req.body)
        ),
    'Product updated successfully'
);
export const deleteProduct = endpoint(
    (req) => Product.delete(id(req.params.id), vendor(req)),
    'Product deleted successfully'
);

// Public reads stay public even when a vendor is logged in on the same browser.
export const fetchProducts = endpoint(
    (req) => Product.list(filters(req)),
    'Products fetched successfully'
);
export const fetchVendorProducts = endpoint(
    (req) => Product.list(filters(req, true), vendor(req)),
    'Products fetched successfully'
);
export const fetchProductById = endpoint(
    (req) => Product.findPublicById(id(req.params.productId ?? req.params.id)),
    'Product fetched successfully'
);
export const fetchVendorProductById = endpoint(
    (req) => Product.findById(id(req.params.id), vendor(req)),
    'Product fetched successfully'
);
export const searchProducts = endpoint(
    (req) => Product.search(null, filters(req, false, 40)),
    'Products fetched successfully'
);
export const searchVendorProducts = endpoint(
    (req) => Product.search(vendor(req), filters(req, true, 40)),
    'Products fetched successfully'
);
export const getFilters = endpoint(
    (req) => Product.getFilters(filters(req).vendor_id ?? null),
    'Filters fetched successfully'
);
export const getRelatedProducts = endpoint(
    (req) =>
        Product.getRelatedProducts(
            id(req.params.productId),
            filters(req, false, 8).limit
        ),
    'Related products fetched successfully'
);
export const getFeaturedProducts = endpoint((req) => {
    const value = filters(req, false, 10);
    return Product.getFeaturedProducts(value.limit, value.vendor_id ?? null);
}, 'Featured products fetched successfully');