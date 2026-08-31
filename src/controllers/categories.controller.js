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

        const { error, value } = createCategorySchema.validate(body, {abortEarly: false, stripUnknown: true});
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const { name, image, description } = value;

        const duplicateCheck = await Category.duplicateCheck(name);
        if (duplicateCheck) {
            return respondWithError(res, 409, 'Category already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        let upload = null;
        if (image) {
            const filename = `images/category-images/${name}.${getBase64Extension(image)}`;
            upload = await S3upload(image, filename);
        }

        const result = await Category.create({ name, description, image: upload.url });
        if (result.rowCount === 0) {
            return respondWithError(res, 400, 'Failed to create category', ERROR_CODES.RESOURCE_CREATE_FAILED);
        }

        return respondWithSuccess(res, 201, 'Category added successfully', result.rows[0]);
    } catch (error) {
        console.error('Error creating category:', error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateCategory = async (req, res) => {
    try {
        const { body, params, session } = req;
        const { categoryId } = params;

        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { error, value } = updateCategorySchema.validate(body, {abortEarly: false, stripUnknown: true});
        if (error) {
            return respondWithError(res, 400, error.details.map(d=>d.message).join(','), ERROR_CODES.VALIDATION_ERROR);
        }

        const { name, description, image, status } = value;

        // Check category exists
        const existingCategory = await Category.fetchById(categoryId);
        if (!existingCategory) {
            return respondWithError(res, 404, 'Category not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        // Check duplicate name — exclude current category
        if (name && name !== existingCategory.name) {
            const duplicateCheck = await Category.duplicateCheck(name);
            if (duplicateCheck) {
                return respondWithError(res, 409, 'Category name already exists', ERROR_CODES.DUPLICATE_RESOURCE);
            }
        }

        let imageUrl = existingCategory.image;

        if (image) {
            const [uploadedUrl] = await Promise.all([
                S3upload(image, `images/category-images/${name ?? existingCategory.name}.${getBase64Extension(image)}`),
                existingCategory.image ? S3delete(existingCategory.image) : Promise.resolve()
            ]);
            imageUrl = uploadedUrl.url;
        }

        value.image = imageUrl;

        const result = await Category.update(categoryId, value);
        if (!result) {
            return respondWithError(res, 400, 'Failed to update category', ERROR_CODES.RESOURCE_UPDATE_FAILED);
        }

        return respondWithSuccess(res, 200, 'Category updated successfully', result);
    } catch (error) {
        console.error('Error updating category:', error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchCategories = async (req, res) => {
    try {
        const { session, pagination } = req;
        const user = session?.user;
        if(!user) {
            return respondWithError(res, 401, "Unauthorized: Login to continue", ERROR_CODES.UNAUTHORIZED);
        }
        
        const { limit, offset } = pagination;

        const result = await Category.fetch({ limit, offset });
        if (result.rowCount === 0) {
            return respondWithError(res, 404, 'No categories found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Categories fetched successfully', result.rows);
    } catch (error) {
        console.error('Error fetching vendor categories:', error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchCategoryById = async (req, res) => {
    try {
        const { params, session } = req;
        const user = session?.user;

        const { categoryId } = params;
        
        const result = await Category.fetchById(categoryId);
        if (!result) {
            return respondWithError(res, 404, 'Category not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Category fetched successfully', result);
    } catch (error) {
        console.error('Error fetching category by ID:', error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const deleteCategory = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        const { categoryId } = params;
        
        const result = await Category.delete(categoryId);
        if (!result) {
            return respondWithError(res, 400, 'Failed to delete category', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Category deleted successfully', result);
    } catch (error) {
        console.error('Error deleting category:', error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};