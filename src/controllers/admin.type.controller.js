import { config } from "dotenv";
config();
import AdminType from "#models/admin.types.model.js";
import queryModel, { fetch_all_by_key, fetch_all_by_keys, fetch_one_by_key, insert, update_by_id } from "#models/query.model.js";
import { createAdminTypeSchema, updateAdminTypeSchema } from "#schemas/admin.types.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { ROLES } from "#utils/helpers.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const createAdminTypes = async (req, res) => {
    try {
        const { body, session } = req;

        const user = session?.user;
        const { error, value } = createAdminTypeSchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details.map((d) => d.message), ERROR_CODES.VALIDATION_ERROR);
        }

        const checkDuplicate = await queryModel.duplicate_check_by_columns("admin_types", ["admin_type"], [value.admin_type]);
        if (checkDuplicate.rowCount > 0) {
            return respondWithError(res, 400, 'Admin type already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const result = await insert("admin_types", keys, values);
        if (result.rowCount === 0) {
            return respondWithError(res, 500, 'Failed to add admin type', ERROR_CODES.INTERNAL_SERVER_ERROR);
        }
        return respondWithSuccess(res, 201, 'Admin type created successfully', result.rows);
    } catch (error) {
        console.error("Error creating admin type:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.RESOURCE_CREATE_FAILED);
    }
};

export const updateAdminTypes = async (req, res) => {
    try {
        const { body, params, session } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { id } = params;

        const { error, value } = updateAdminTypeSchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details.map((d) => d.message).join(', '), ERROR_CODES.VALIDATION_ERROR);
        }
        const { admin_type, status, description } = value;

        const existCheck = await fetch_one_by_key("admin_types", "id", id);
        if (existCheck.rowCount === 0) {
            return respondWithError(res, 404, 'Admin type not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        if (admin_type) {
            const checkDuplicate = await queryModel.duplicate_check_by_columns("admin_types", ["admin_type"], [admin_type]);
            if (checkDuplicate.rowCount > 0) {
                return respondWithError(res, 400, 'Admin type already exists', ERROR_CODES.DUPLICATE_RESOURCE);
            }
        }

        const update = await update_by_id("admin_types", id, value);
        if (update.rowCount === 0) {
            return respondWithError(res, 400, 'Failed to update admin type', ERROR_CODES.RESOURCE_UPDATE_FAILED);
        }
        return respondWithSuccess(res, 200, 'Admin type updated successfully', update.rows);

    } catch (error) {
        console.error("Error updating admin types:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchAdminTypes = async (req, res) => {
    try {
        const { session, pagination, query } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }
        const { limit, offset } = pagination;

        const filters = {
            search: query.search,
            status: query.status,
            from_date: query.from_date,
            to_date: query.to_date
        };

        const result = await AdminType.fetchAdminTypes(filters, offset, limit);
        if (result.rows.length === 0) {
            return respondWithSuccess(res, 404, 'No admin types found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Admin types fetched successfully', result);

    } catch (error) {
        console.error("Error fetching admin types:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const viewAdminType = async (req, res) => {
    try {
        const { session, params } = req;
        const { id } = params;
        const user = session?.user;

        const result = await queryModel.fetch_one_by_key("admin_types", "id", id);
        if (result.rowCount === 0) {
            return respondWithError(res, 404, 'Admin type not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Admin type fetched successfully', result.rows[0]);

    } catch (error) {
        console.error("Error fetching admin type:", error);
        return respondWithError(res, 500, 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const deleteAdminType = async (req, res) => {
    try {
        const { session, params } = req;
        const { id } = params;

        const user = session?.user;

        const result = await queryModel.fetch_one_by_key("admin_types", "id", id);
        if (result.rowCount === 0) {
            return respondWithError(res, 404, 'Admin type not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const deleteResult = await queryModel.fetch_one_by_key("admin_types", "id", id);
        if (!deleteResult) {
            return respondWithError(res, 400, 'Failed to delete admin type', ERROR_CODES.RESOURCE_DELETE_FAILED);
        }

        return respondWithSuccess(res, 200, 'Admin type deleted successfully', deleteResult);
        
    } catch (error) {
        console.error("Error deleting admin type:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};