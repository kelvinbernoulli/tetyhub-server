import { config } from "dotenv";
config();
import AdminType from "#models/admin.types.model.js";
import { fetch_all_by_key, fetch_all_by_keys, fetch_one_by_key, insert, update_by_id } from "#models/query.model.js";
import { createAdminTypeSchema, updateAdminTypeSchema } from "#schemas/admin.types.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { ROLES } from "#utils/helpers.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const createAdminTypes = async (req, res) => {
    try {
        const { body, session } = req;
        const user = session?.user;
        const { error, value } = createAdminTypeSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }
        const checkDuplicate = await AdminType.duplicateType(value.name, value.vendorId);
        if (checkDuplicate) {
            return respondWithError(res, 400, 'Admin type already exists', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        const keys = Object.keys(value).concat("vendor_id");
        const values = Object.values(value).concat(vendorId);

        const result = await insert("admin_types", keys, values);
        if (result.rowCount === 0) {
            return respondWithError(res, 500, 'Failed to create admin type', ERROR_CODES.INTERNAL_SERVER_ERROR);
        }
        return respondWithSuccess(res, 201, 'Admin type created successfully', result.rows);
    } catch (error) {
        console.error("Error creating admin type:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.RESOURCE_CREATE_FAILED);
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

        const { error, value } = updateAdminTypeSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }
        const { admin_type, status, description } = value;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        const existCheck = await fetch_one_by_key("admin_types", "id", id);
        if (existCheck.rowCount === 0) {
            return respondWithError(res, 404, 'Admin type not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        if (existCheck.rows[0].vendor_id) {
            if (user.role === ROLES.VENDOR && user.id !== existCheck.rows[0].vendor_id) {
                return respondWithError(res, 403, 'Forbidden: You do not have access to this resource', ERROR_CODES.FORBIDDEN);
            } else if (user.role === ROLES.VENDOR_ADMIN && user.vendor_id !== existCheck.rows[0].vendor_id) {
                return respondWithError(res, 403, 'Forbidden: You do not have access to this resource', ERROR_CODES.FORBIDDEN);
            } else if (user.role === ROLES.ADMIN && existCheck.rows[0].vendor_id) {
                return respondWithError(res, 403, 'Forbidden: You do not have access to this resource', ERROR_CODES.FORBIDDEN);
            }
        }

        if (admin_type) {
            const checkDuplicate = await AdminType.duplicateType(admin_type, vendorId);
            if (checkDuplicate) {
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
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
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

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        const filters = {
            search: query.search,
            status: query.status,
            from_date: query.from_date,
            to_date: query.to_date,
            vendor_id: query.vendor_id
        };

        const result = await AdminType.fetchAdminTypes(vendorId, filters, offset, limit);

        if (result.rows.length === 0) {
            return respondWithSuccess(res, 200, 'No admin types found', []);
        }

        return respondWithSuccess(res, 200, 'Admin types fetched successfully', result);

    } catch (error) {
        console.error("Error fetching admin types:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error');
    }
};

export const fetchAdminType = async (req, res) => {
    try {
        const { session, params } = req;
        const { id } = params;
        const user = session?.user;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        const result = await fetch_all_by_keys("admin_types", [{ key: "id", value: id }, { key: "vendor_id", value: vendorId ?? null }, { key: "deleted_at", value: null }]);
        if (result.rowCount === 0) {
            return respondWithError(res, 404, 'Admin type not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        return respondWithSuccess(res, 200, 'Admin type fetched successfully', result.rows[0]);
    } catch (error) {
        console.error("Error fetching admin type:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error');
    }
};

export const deleteAdminType = async (req, res) => {
    try {
        const { session, params } = req;
        const { id } = params;
        const user = session?.user;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        const result = await fetch_all_by_keys("admin_types", [{ key: "id", value: id }, { key: "vendor_id", value: vendorId ?? null }]);
        if (result.rowCount === 0) {
            return respondWithError(res, 404, 'Admin type not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const deleteResult = await AdminType.deleteType(id, vendorId);
        if (!deleteResult) {
            return respondWithError(res, 400, 'Failed to delete admin type', ERROR_CODES.RESOURCE_DELETE_FAILED);
        }

        return respondWithSuccess(res, 200, 'Admin type deleted successfully', deleteResult);
    } catch (error) {
        console.error("Error deleting admin type:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export default {
    createAdminTypes,
    updateAdminTypes,
    fetchAdminTypes,
    fetchAdminType,
    deleteAdminType
};