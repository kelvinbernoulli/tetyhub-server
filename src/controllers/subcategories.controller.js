import queryModel from "#models/query.model.js";
import Subcategory from "#models/subcategories.model.js";
import { createSubcategorySchema, updateSubcategorySchema } from "#schemas/subcategories.schema.js";
import { getBase64Extension, S3delete, S3upload } from "#services/s3bucket.js";
import ERROR_CODES from "#utils/error.codes.js";
import { ROLES } from "#utils/helpers.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const createSubcategory = async (req, res) => {
    try {
        const { body, session } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { error, value } = createSubcategorySchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }
        
        const { name, category_id, image, description } = value;

        const duplicateCheck = await queryModel.duplicate_check_by_columns('subcategories', ['name'], [name]);
        if (duplicateCheck) {
            return respondWithError(res, 409, 'Subcategory already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        let filename = null;
        if (image) {
            filename = `images/subcategory-images/${name}.${getBase64Extension(image)}`;
            await S3upload(image, filename);
        }

        const result = await Subcategory.create({ name, category_id, image: filename, description });
        if (result.rowCount === 0) {
            return respondWithError(res, 400, 'Failed to create subcategory', ERROR_CODES.RESOURCE_CREATE_FAILED);
        }

        return respondWithSuccess(res, 200, 'Subcategory added successfully', result.rows);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateSubcategory = async (req, res) => {
    try {
        const { session, body, params } = req;

        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { subcategoryId } = params;

        const { error, value } = updateSubcategorySchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details(err=>err.message).join(', '), ERROR_CODES.VALIDATION_ERROR);
        }

        const { name, category_id, status, image, description } = value;

        const existingSubcategory = await Subcategory.fetchById(subcategoryId);
        if (!existingSubcategory) {
            return respondWithError(res, 404, 'Subcategory not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const duplicateCheck = await queryModel.duplicate_check_by_columns('subcategories', ['name'], [name]);
        if (name && name !== existingSubcategory.name) {
            return respondWithError(res, 409, 'Subcategory already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        let imageUrl = existingSubcategory.image;

        if (image) {
            const [uploadedUrl] = await Promise.all([
                S3upload(image, `images/subcategory-images/${name ?? existingSubcategory.name}.${getBase64Extension(image)}`),
                imageUrl ? S3delete(imageUrl) : Promise.resolve()
            ]);
            imageUrl = uploadedUrl;
        }

        value.image = imageUrl;

        const result = await Subcategory.update(subcategoryId, value);
        if (!result) {
            return respondWithError(res, 404, 'Failed to update subcategory', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Subcategory updated successfully', result);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchSubcategories = async (req, res) => {
    try {
        const { session, pagination } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { limit, offset } = pagination;

        const result = await Subcategory.fetch({ limit, offset });
        if (result.rowCount === 0) {
            return respondWithError(res, 404, 'No subcategories found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'Subcategories fetched successfully', result.rows);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchSubcategoryById = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { subcategoryId } = params;

        const result = await Subcategory.fetchById(subcategoryId);
        if (!result) {
            return respondWithError(res, 404, 'Subcategory not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Subcategory fetched successfully', result);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const deleteSubcategory = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }
        
        const { subcategoryId } = params;

        const result = await Subcategory.delete(subcategoryId);
        if (!result) {
            return respondWithError(res, 404, 'Subcategory not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Subcategory deleted successfully', result);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};