import ChildSubcategory from "#models/childsubcategories.model.js";
import queryModel from "#models/query.model.js";
import { createChildsubcategorySchema } from "#schemas/sub-subcategories.schema.js";
import { getBase64Extension, S3delete, S3upload } from "#services/s3bucket.js";
import ERROR_CODES from "#utils/error.codes.js";
import { ROLES } from "#utils/helpers.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const createChildsubcategory = async (req, res) => {
    try {
        const { body, session } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { error, value } = createChildsubcategorySchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const { name, subcategory_id, image, description } = value;

        const duplicateCheck = await queryModel.duplicate_check_by_columns('child_subcategories', ['name'], [name]);
        if (duplicateCheck.length > 0) {
            return respondWithError(res, 409, 'Child-subcategory already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const existingSubcategory = await queryModel.fetch_one_by_key('subcategories', 'id', subcategory_id);
        if (!existingSubcategory || existingSubcategory.length === 0) {
            return respondWithError(res, 404, 'Subcategory not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        let upload = null;
        if (image) {
            const filename = `images/child-subcategory-images/${name}.${getBase64Extension(image)}`;
            upload = await S3upload(image, filename);
        }

        const result = await ChildSubcategory.create({ name, subcategory_id, image: upload.url, description });
        if (result.rowCount === 0) {
            return respondWithError(res, 400, 'Failed to create subcategory', ERROR_CODES.RESOURCE_CREATE_FAILED);
        }

        return respondWithSuccess(res, 200, 'Child-subcategory added successfully', result.rows);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateChildsubcategory = async (req, res) => {
    try {
        const { session, body, params } = req;

        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { childSubcategoryId } = params;

        const { error, value } = updateSubcategorySchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details(err => err.message).join(', '), ERROR_CODES.VALIDATION_ERROR);
        }

        const { name, subcategory_id, status, image, description } = value;

        if (subcategory_id) {
            const existingSubcategory = await ChildSubcategory.fetchById(childSubcategoryId);
            if (!existingSubcategory) {
                return respondWithError(res, 404, 'Child-subcategory not found', ERROR_CODES.RESOURCE_NOT_FOUND);
            }
        }

        const duplicateCheck = await queryModel.duplicate_check_by_columns('child_subcategories', ['name'], [name]);
        if (name && name === existingSubcategory.name) {
            return respondWithError(res, 409, 'Child-subcategory already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        let imageUrl = existingSubcategory.image;

        if (image) {
            const [uploadedUrl] = await Promise.all([
                S3upload(image, `images/subcategory-images/${name ?? existingSubcategory.name}.${getBase64Extension(image)}`),
                imageUrl ? S3delete(imageUrl) : Promise.resolve()
            ]);
            imageUrl = uploadedUrl.url;
        }

        value.image = imageUrl;

        const result = await ChildSubcategory.update(childSubcategoryId, value);
        if (!result) {
            return respondWithError(res, 404, 'Failed to update child-subcategory', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Child-subcategory updated successfully', result);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchChildsubcategories = async (req, res) => {
    try {
        const { session, pagination } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { limit, offset } = pagination;

        const result = await ChildSubcategory.fetch({ limit, offset });
        if (result === null) {
            return respondWithError(res, 404, 'No child-subcategories found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'Child-subcategories fetched successfully', result);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchChildsubcategoryById = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { childSubcategoryId } = params;

        const result = await ChildSubcategory.fetchById(childSubcategoryId);
        if (!result) {
            return respondWithError(res, 404, 'Child-subcategory not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Child-subcategory fetched successfully', result);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const deleteChildsubcategory = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { childSubcategoryId } = params;

        const result = await ChildSubcategory.delete(childSubcategoryId);
        if (!result) {
            return respondWithError(res, 404, 'Child-subcategory not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Child-subcategory deleted successfully', result);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};