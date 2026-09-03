import AdminType from '#models/admin.types.model.js';
import {
    createAdminTypeSchema,
    updateAdminTypeSchema,
} from '#schemas/admin.types.schema.js';
import {
    ADMIN_SCOPES,
    PERMISSION_SCOPES,
    ROLES,
} from '#utils/access-control.js';
import AppError from '#utils/app.error.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

const parseId = (value) => {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0) {
        throw new AppError(
            'A valid permission resource ID is required.',
            400,
            ERROR_CODES.VALIDATION_ERROR
        );
    }
    return id;
};

const handleError = (res, error, operation) => {
    if (error instanceof AppError) {
        return respondWithError(res, error.status, error.message, error.code);
    }
    console.error(`Permission resource ${operation} failed:`, error);
    return respondWithError(
        res,
        500,
        'Internal server error.',
        ERROR_CODES.INTERNAL_SERVER_ERROR
    );
};

const canViewType = (auth, type) => {
    if ([ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(auth.role)) return true;
    return [PERMISSION_SCOPES.VENDOR, PERMISSION_SCOPES.BOTH].includes(type.scope);
};

export const createAdminTypes = async (req, res) => {
    try {
        const { error, value } = createAdminTypeSchema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true,
        });
        if (error) {
            return respondWithError(
                res,
                400,
                error.details.map((detail) => detail.message).join(', '),
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        const type = await AdminType.create(value);
        return respondWithSuccess(res, 201, 'Permission resource created.', type);
    } catch (error) {
        console.error('Permission resource creation failed:', error);
        return handleError(res, error, 'creation');
    }
};

export const updateAdminTypes = async (req, res) => {
    try {
        const { error, value } = updateAdminTypeSchema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true,
        });
        if (error) {
            return respondWithError(
                res,
                400,
                error.details.map((detail) => detail.message).join(', '),
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        const type = await AdminType.update(parseId(req.params.id), value);
        return respondWithSuccess(res, 200, 'Permission resource updated.', type);
    } catch (error) {
        return handleError(res, error, 'update');
    }
};

export const fetchAdminTypes = async (req, res) => {
    try {
        const { limit = 20, offset = 0 } = req.pagination ?? {};
        const types = await AdminType.fetchAdminTypes({
            actor: req.auth,
            limit,
            offset,
            includeInactive:
                req.auth.role === ROLES.SUPER_ADMIN
                && req.query.include_inactive === 'true',
        });
        return respondWithSuccess(res, 200, 'Permission resources fetched.', types);
    } catch (error) {
        return handleError(res, error, 'listing');
    }
};

export const viewAdminType = async (req, res) => {
    try {
        const type = await AdminType.getById(parseId(req.params.id));
        if (!type || !canViewType(req.auth, type)) {
            return respondWithError(
                res,
                404,
                'Permission resource not found.',
                ERROR_CODES.RESOURCE_NOT_FOUND
            );
        }
        return respondWithSuccess(res, 200, 'Permission resource fetched.', type);
    } catch (error) {
        return handleError(res, error, 'lookup');
    }
};

export const deleteAdminType = async (req, res) => {
    try {
        const type = await AdminType.getById(parseId(req.params.id));
        if (!type) {
            return respondWithError(
                res,
                404,
                'Permission resource not found.',
                ERROR_CODES.RESOURCE_NOT_FOUND
            );
        }
        const deleted = await AdminType.delete(type.id);
        return respondWithSuccess(res, 200, 'Permission resource deleted.', deleted);
    } catch (error) {
        return handleError(res, error, 'deletion');
    }
};

export default {
    createAdminTypes,
    updateAdminTypes,
    fetchAdminTypes,
    viewAdminType,
    deleteAdminType,
};
