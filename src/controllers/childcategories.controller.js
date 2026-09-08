import Childcategory from "#models/childcategories.model.js";
import queryModel from "#models/query.model.js";
import Subcategory from "#models/subcategories.model.js";
import { createChildcategorySchema, updateChildcategorySchema } from "#schemas/childcategories.schema.js";
import { getBase64Extension, S3delete, S3upload } from "#services/s3bucket.js";
import ERROR_CODES from "#utils/error.codes.js";
import { ROLES } from "#utils/helpers.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const createChildcategory = async (req, res) => {
    try {
        const { body, session } = req;
        const user = session?.user;
        
        const { error, value } = createChildcategorySchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details.map(err => err.message).join(', '), ERROR_CODES.VALIDATION_ERROR);
        }

        const { name, subcategory_id, image, description } = value;

        const duplicateCheck = await queryModel.duplicate_check_by_columns('childcategories', ['name'], [name]);
        if (duplicateCheck.length > 0) {
            return respondWithError(res, 409, 'childcategory already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const existingSubcategory = await queryModel.fetch_one_by_key('subcategories', 'id', subcategory_id);
        if (!existingSubcategory || existingSubcategory.length === 0) {
            return respondWithError(res, 404, 'Subcategory not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        let upload = null;
        if (image) {
            const filename = `images/childcategory-images/${name}.${getBase64Extension(image)}`;
            upload = await S3upload(image, filename);
        }

        const result = await Childcategory.create({ name, subcategory_id, image: upload.url, description });
        if (result.rowCount === 0) {
            return respondWithError(res, 400, 'Failed to create subcategory', ERROR_CODES.RESOURCE_CREATE_FAILED);
        }

        return respondWithSuccess(res, 200, 'childcategory added successfully', result.rows);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateChildcategory = async (req, res) => {
    try {
        const { session, body, params } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { ChildcategoryId } = params;

        const { error, value } = updateChildcategorySchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details.map(err => err.message).join(', '), ERROR_CODES.VALIDATION_ERROR);
        }

        const { name, subcategory_id, status, image, description } = value;

        if (subcategory_id) {
            const existingSubcategory = await Subcategory.fetchById(ChildcategoryId);
            if (existingSubcategory.rowCount === 0) {
                return respondWithError(res, 404, 'Subcategory not found', ERROR_CODES.RESOURCE_NOT_FOUND);
            }
        }

        const duplicateCheck = await queryModel.duplicate_check_by_columns('childcategories', ['name'], [name]);
        const existing = duplicateCheck[0];
        if (name && existing && existing.id !== Number(ChildcategoryId)) {
            return respondWithError(res, 409, 'child category already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const validChildcategory = await Childcategory.fetchById(ChildcategoryId);
        if (!validChildcategory) {
            return respondWithError(res, 404, 'child category not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        let imageUrl = duplicateCheck.image;

        if (image) {
            const [uploadedUrl] = await Promise.all([
                S3upload(image, `images/childcategory-images/${name ?? duplicateCheck.name}.${getBase64Extension(image)}`),
                imageUrl ? S3delete(imageUrl) : Promise.resolve()
            ]);
            imageUrl = uploadedUrl.url;
        }

        value.image = imageUrl;

        const result = await Childcategory.update(ChildcategoryId, value);
        if (result === null) {
            return respondWithError(res, 404, 'Failed to update childcategory', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'childcategory updated successfully', result);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchChildcategories = async (req, res) => {
    try {
        const { session, pagination } = req;

        const { limit, offset } = pagination;

        const result = await Childcategory.fetch({ limit, offset });
        if (result.rowCount === 0) {
            return respondWithError(res, 404, 'No child category found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'child categories fetched successfully', result.rows);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchChildcategoryById = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { ChildcategoryId } = params;

        const result = await Childcategory.fetchById(ChildcategoryId);
        if (!result) {
            return respondWithError(res, 404, 'childcategory not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'childcategory fetched successfully', result);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const deleteChildcategory = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized: Login to continue', ERROR_CODES.UNAUTHORIZED);
        }

        const { ChildcategoryId } = params;

        const result = await Childcategory.delete(ChildcategoryId);
        if (!result) {
            return respondWithError(res, 404, 'childcategory not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'childcategory deleted successfully', result);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};