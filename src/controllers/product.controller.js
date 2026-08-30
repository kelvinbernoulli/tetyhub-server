import Category from "#models/categories.model.js";
import Product from "#models/products.model.js";
import Subcategory from "#models/subcategories.model.js";
import { createProductSchema, productSearchSchema, updateProductSchema } from "#schemas/products.schema.js";
import { getBase64Extension, S3delete, S3upload } from "#services/s3bucket.js";
import redisClient from "#config/redis.js";
import ERROR_CODES from "#utils/error.codes.js";
import { ROLES } from "#utils/helpers.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";
import UserModel from "#models/user.model.js";
import { fetch_one_by_key } from "#models/query.model.js";

const PRODUCT_CACHE_TTL_SECONDS = Number(process.env.PRODUCT_CACHE_TTL_SECONDS) || 60;

const getProductListCacheKey = (offset, limit) => `products:offset:${offset}:limit:${limit}`;
const getProductCacheKey = (productId) => `product:${productId}`;

const invalidateProductCache = async (productId) => {
    try {
        const keys = [];
        const listKeys = await redisClient.keys(`products*`);
        if (listKeys?.length) {
            keys.push(...listKeys);
        }

        if (productId) {
            keys.push(getProductCacheKey(productId));
        }

        if (keys.length) {
            await redisClient.del(...keys);
        }
    } catch (err) {
        console.warn("Unable to invalidate product cache:", err);
    }
};

export const createProduct = async (req, res) => {
    try {
        const { session, body } = req;
        const { error, value } = createProductSchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details.map(err => err.message).join(', '), ERROR_CODES.VALIDATION_ERROR);
        }

        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const category = await Category.fetchById(value.category_id);
        if (!category) {
            return respondWithError(res, 422, 'Invalid category', ERROR_CODES.VALIDATION_ERROR);
        }

        if (value.subcategory_id) {
            const subcategory = await Subcategory.fetchById(value.subcategory_id);
            if (!subcategory) {
                return respondWithError(res, 422, 'Invalid subcategory', ERROR_CODES.VALIDATION_ERROR);
            }
        }

        const currencyData = await fetch_one_by_key('currencies', 'id', value.currency_id);
        if (!currencyData) {
            return respondWithError(res, 422, 'Invalid currency', ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await Product.create(user.id, value);
        if (!result) {
            return respondWithError(res, 400, 'Failed to add product', ERROR_CODES.OPERATION_FAILED);
        }

        await invalidateProductCache(result.id);

        return respondWithSuccess(res, 201, 'Product added successfully', result);

    } catch (err) {
        console.error("Error creating product:", err);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateProduct = async (req, res) => {
    try {
        const { body, session, params } = req;
        const user = session?.user;
        const { id } = params;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { error, value } = updateProductSchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details.map(err => err.message).join(', '), ERROR_CODES.VALIDATION_ERROR);
        }

        // Check product exists and belongs to vendor
        const productData = await Product.findByKey([{ key: 'id', value: id }]);
        if (!productData) {
            return respondWithError(res, 404, "Product not found", ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        // Check category exists if being updated
        if (value.category_id) {
            const category = await Category.fetchById(value.category_id);
            if (!category) {
                return respondWithError(res, 422, 'Invalid category ID', ERROR_CODES.VALIDATION_ERROR);
            }
        }

        // Check subcategory exists if being updated
        if (value.subcategory_id) {
            const subcategory = await Subcategory.fetchById(value.subcategory_id);
            if (!subcategory) {
                return respondWithError(res, 422, 'Invalid subcategory ID', ERROR_CODES.VALIDATION_ERROR);
            }
        }

        const updatedProduct = await Product.update(id, user.id, value);
    if (!updatedProduct) {
        return respondWithError(res, 400, "Failed to update product", ERROR_CODES.RESOURCE_UPDATE_FAILED);
    }

    await invalidateProductCache(id);
    
    return respondWithSuccess(res, 200, "Product updated successfully", updatedProduct);
} catch (error) {
    console.error("Error updating product:", error);
    return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
}
}

export const fetchProducts = async (req, res) => {
    try {
        const user = req.session?.user;
        const vendorId = user?.role === ROLES.VENDOR ? user.id : user?.vendor_id;

        const { offset, limit } = req.pagination;
        const filters = req.query;

        const cacheKey = getProductListCacheKey(offset, limit);

        // 1. Try cache
        const cached = await redisClient.get(cacheKey).catch((err) => {
            console.warn('Redis cache read error:', err);
            return null;
        });

        if (cached) {
            return respondWithSuccess(res, 200, 'Products fetched successfully', JSON.parse(cached));
        }

        // 2. Fetch from DB
        const products = await Product.fetchAll({ offset, limit, filters });

        // 3. Store in cache — fire and forget, never block the response
        redisClient
            .set(cacheKey, JSON.stringify(products), { EX: PRODUCT_CACHE_TTL_SECONDS })
            .catch((err) => console.warn('Redis cache set error:', err));

        return respondWithSuccess(res, 200, 'Products fetched successfully', products);

    } catch (error) {
        console.error('Error fetching products:', error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchProductById = async (req, res) => {
    try {
        const user = req.session?.user;
        const productId = req.params.id;

        if (!productId) {
            return respondWithError(res, 400, 'Invalid product ID', ERROR_CODES.VALIDATION_ERROR);
        }

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        } else if (user.role === ROLES.CUSTOMER) {
            vendorId = user.vendor_id;
        }

        if (!vendorId) {
            return respondWithError(res, 403, 'Forbidden', ERROR_CODES.FORBIDDEN);
        }

        const cacheKey = await getProductCacheKey(
            vendorId,
            productId
        );

        try {
            const cachedProduct = await redisClient.get(cacheKey);

            if (cachedProduct) {
                return respondWithSuccess(res, 200, 'Product fetched successfully', JSON.parse(cachedProduct));
            }
        } catch (cacheError) {
            console.warn('Redis cache read error:', cacheError);
        }

        const product = await Product.findByKey(
            [{ key: 'id', value: productId }],
            vendorId
        );

        if (!product) {
            return respondWithError(res, 404, 'Product not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        try {
            await redisClient.set(
                cacheKey,
                JSON.stringify(product),
                {
                    EX: PRODUCT_CACHE_TTL_SECONDS
                }
            );
        } catch (cacheError) {
            console.warn('Redis cache set error:', cacheError);
        }

        return respondWithSuccess(res, 200, 'Product fetched successfully', product);
    } catch (error) {
        console.error('Error fetching product:', error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const deleteProduct = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        const { id } = params;

        let vendorId;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }
        if (!vendorId) {
            return respondWithError(res, 401, "Forbiden: Unauthorized", ERROR_CODES.UNAUTHORIZED);
        }

        const productData = await Product.findByKey([{ key: 'id', value: id }], vendorId);
        if (!productData) {
            return respondWithError(res, 404, "Product not found", ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const deleted = await Product.delete(id, vendorId);
        if (!deleted) {
            return respondWithError(res, 400, "Failed to delete product", ERROR_CODES.RESOURCE_DELETE_FAILED);
        }
        if (productData.images) {
            await S3delete(productData.images);
        }

        await invalidateProductCache(vendorId, id);
        return respondWithSuccess(res, 200, "Product deleted successfully", null);
    } catch (error) {
        console.error("Error deleting product:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const searchProducts = async (req, res) => {
    try {
        const user = req.session?.user;

        if (!user) {
            return respondWithError(
                res,
                401,
                'Unauthorized',
                ERROR_CODES.UNAUTHORIZED
            );
        }

        const vendorId = getVendorId(user);

        if (!vendorId) {
            return respondWithError(
                res,
                403,
                'Forbidden',
                ERROR_CODES.FORBIDDEN
            );
        }

        const { error, value } = productSearchSchema.validate(req.query, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            return respondWithError(
                res,
                400,
                error.details.map((err) => err.message).join(', '),
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        const result = await Product.search(vendorId, {
            ...value,
            limit: Math.min(Number(value.limit || 20), 100)
        });

        return respondWithSuccess(
            res,
            200,
            'Products fetched successfully',
            result
        );
    } catch (error) {
        console.error('Error searching products:', error);

        return respondWithError(
            res,
            500,
            'Internal Server Error',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const getFilters = async (req, res) => {
    try {
        const { params } = req;
        const { vendor_id } = params;

        const filters = await Product.getFilters(vendor_id);
        return respondWithSuccess(res, 200, 'Filters fetched successfully', filters);
    } catch (error) {
        console.error("Error fetching filters:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getRelatedProducts = async (req, res) => {
    try {
        const { params, query } = req;
        const { vendor_id, product_id } = params;
        const { limit } = query;

        const products = await Product.getRelatedProducts(
            product_id, vendor_id, parseInt(limit) || 8
        );
        return respondWithSuccess(res, 200, 'Related products fetched successfully', products);
    } catch (error) {
        console.error("Error fetching related products:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getFeaturedProducts = async (req, res) => {
    try {
        const { params, query } = req;
        const { vendor_id } = params;
        const { limit } = query;

        const products = await Product.getFeaturedProducts(
            vendor_id, parseInt(limit) || 10
        );
        return respondWithSuccess(res, 200, 'Featured products fetched successfully', products);
    } catch (error) {
        console.error("Error fetching featured products:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};