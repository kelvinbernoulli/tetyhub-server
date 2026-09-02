import AdminModel from '#models/admins.model.js';
import { replaceAdminPermissionsSchema } from '#schemas/permissions.schema.js';
import { revokeUserSessions } from '#services/session.service.js';
import AppError from '#utils/app.error.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

const auditContext = (req) => ({
    requestId: req.get('x-request-id') ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
});

const parseAdminId = (value) => {
    const adminId = Number(value);
    if (!Number.isInteger(adminId) || adminId <= 0) {
        throw new AppError(
            'A valid admin ID is required.',
            400,
            ERROR_CODES.VALIDATION_ERROR
        );
    }
    return adminId;
};

const handleError = (res, error, operation) => {
    if (error instanceof AppError) {
        return respondWithError(res, error.status, error.message, error.code);
    }

    console.error(`Admin permission ${operation} failed:`, error);
    return respondWithError(
        res,
        500,
        'Internal server error.',
        ERROR_CODES.INTERNAL_SERVER_ERROR
    );
};

export const replaceAdminPermissions = async (req, res) => {
    try {
        const adminId = parseAdminId(req.params.adminId);
        const { error, value } = replaceAdminPermissionsSchema.validate(req.body, {
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

        const permissions = await AdminModel.replaceAdminPermissions(
            req.auth,
            adminId,
            value.version,
            value.grants,
            auditContext(req)
        );

        try {
            await revokeUserSessions(permissions.admin.user_id);
        } catch (sessionError) {
            // Permission checks query the current database grant on every request;
            // Redis cleanup is an additional defense, not the enforcement layer.
            console.error('Unable to clean up changed admin sessions:', sessionError);
        }

        return respondWithSuccess(
            res,
            200,
            'Permissions replaced successfully.',
            permissions
        );
    } catch (error) {
        return handleError(res, error, 'replacement');
    }
};

export const fetchAdminPermissions = async (req, res) => {
    try {
        const permissions = await AdminModel.fetchAdminPermissions(
            req.auth,
            parseAdminId(req.params.adminId)
        );
        return respondWithSuccess(
            res,
            200,
            'Permissions fetched successfully.',
            permissions
        );
    } catch (error) {
        return handleError(res, error, 'lookup');
    }
};

// Compatibility export for imports that used the previous controller name.
export const assignAdminPermissions = replaceAdminPermissions;

export default {
    replaceAdminPermissions,
    assignAdminPermissions,
    fetchAdminPermissions,
};
