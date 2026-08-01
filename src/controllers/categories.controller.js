import Category from "#models/categories.model.js";
import { createCategorySchema, updateCategorySchema } from "#schemas/categories.schema.js";
import { getBase64Extension, S3delete, S3upload } from "#services/s3bucket.js";
import ERROR_CODES from "#utils/error.codes.js";
import { ROLES } from "#utils/helpers.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const createCategory = async (req, res) => {
    try {
        const { session, body } = req;
        const user = session?.user;
        const { error } = createCategorySchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }
        const { name, image, description } = body;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        if (!vendorId) {
            return respondWithError(res, 403, 'Forbidden: Invalid user role', ERROR_CODES.FORBIDDEN);
        }

        const duplicateCheck = await Category.duplicateCheck(name, vendorId);
        if (duplicateCheck) {
            return respondWithError(res, 409, 'Category already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        let filename = null;
        if (image) {
            filename = `images/category-images/${name}.${getBase64Extension(image)}`;
            await S3upload(req, res, filename, image);
        }
        const result = await Category.create({ name, description, image: filename, vendorId });
        if (result.rowCount === 0) {
            return respondWithError(res, 400, 'Failed to create category', ERROR_CODES.RESOURCE_CREATE_FAILED);
        }
        return respondWithSuccess(res, 201, 'Category added successfully', result.rows[0]);
    } catch (error) {
        console.error('Error creating category:', error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateCategory = async (req, res) => {
    try {
        const { body, params, session } = req;
        const user = session?.user;
        const { categoryId } = params;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { error } = updateCategorySchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const { name, description, image, status } = body;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        // Check category exists
        const existingCategory = await Category.fetchById(categoryId, vendorId);
        if (!existingCategory) {
            return respondWithError(res, 404, 'Category not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        // Check duplicate name — exclude current category
        if (name && name !== existingCategory.name) {
            const duplicateCheck = await Category.duplicateCheck(name, vendorId);
            if (duplicateCheck) {
                return respondWithError(res, 409, 'Category name already exists', ERROR_CODES.DUPLICATE_RESOURCE);
            }
        }

        let imageUrl = existingCategory.image;

        if (image) {
            const [uploadedUrl] = await Promise.all([
                S3upload(req, res, `images/category-images/${name ?? existingCategory.name}.${getBase64Extension(image)}`, image),
                existingCategory.image ? S3delete(existingCategory.image) : Promise.resolve()
            ]);
            imageUrl = uploadedUrl;
        }

        body.image = imageUrl;

        const result = await Category.update(categoryId, vendorId, body);
        if (!result) {
            return respondWithError(res, 400, 'Failed to update category', ERROR_CODES.RESOURCE_UPDATE_FAILED);
        }

        return respondWithSuccess(res, 200, 'Category updated successfully', result);
    } catch (error) {
        console.error('Error updating category:', error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchVendorCategories = async (req, res) => {
    try {
        const { session, pagination } = req;
        const user = session?.user;
        if(!user) {
            return respondWithError(res, 401, "Unauthorized: Login to continue", ERROR_CODES.UNAUTHORIZED);
        }
        
        const { limit, offset } = pagination;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        } else if (user.role === ROLES.CUSTOMER) {
            vendorId = user.vendor_id;
        }

        if (!vendorId) {
            return respondWithError(res, 403, 'Forbidden: Vendor ID not found', ERROR_CODES.FORBIDDEN);
        }

        const result = await Category.fetchByVendorId(vendorId, { limit, offset });
        if (result.rowCount === 0) {
            return respondWithError(res, 404, 'No categories found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Categories fetched successfully', result.rows);
    } catch (error) {
        console.error('Error fetching vendor categories:', error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchCategoryById = async (req, res) => {
    try {
        const { params, session } = req;
        const user = session?.user;

        const { categoryId } = params;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        } else if (user.role === ROLES.CUSTOMER) {
            vendorId = user.vendor_id;
        }

        if (!vendorId) {
            return respondWithError(res, 403, 'Forbidden: Vendor ID not found', ERROR_CODES.FORBIDDEN);
        }
        
        const result = await Category.fetchById(categoryId, vendorId);
        if (!result) {
            return respondWithError(res, 404, 'Category not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'Category fetched successfully', result);
    } catch (error) {
        console.error('Error fetching category by ID:', error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const deleteCategory = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        const { categoryId } = params;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }
        if (!vendorId) {
            return respondWithError(res, 403, 'Forbidden: Vendor ID not found', ERROR_CODES.FORBIDDEN);
        }
        
        const result = await Category.delete(categoryId, vendorId);
        if (!result) {
            return respondWithError(res, 400, 'Failed to delete category', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'Category deleted successfully', result);
    } catch (error) {
        console.error('Error deleting category:', error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export default {
    createCategory,
    updateCategory,
    fetchCategoryById,
    fetchVendorCategories,
    deleteCategory
}