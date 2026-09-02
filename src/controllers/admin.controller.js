import crypto from 'crypto';
import AdminModel from '#models/admins.model.js';
import { sendAdminRegistrationEmail } from '#models/mail.model.js';
import {
    acceptAdminInvitationSchema,
    createAdminSchema,
    updateAdminSchema,
} from '#schemas/admins.schema.js';
import { revokeUserSessions } from '#services/session.service.js';
import {
    ADMIN_SCOPES,
    ROLES,
    isVendorActor,
} from '#utils/access-control.js';
import {
    buildAdminInvitationUrl,
    createAdminInvitation,
    hashAdminInvitationToken,
} from '#utils/admin-invitation.js';
import AppError, { forbiddenError } from '#utils/app.error.js';
import ERROR_CODES from '#utils/error.codes.js';
import { passwordHash } from '#utils/helpers.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';

const auditContext = (req) => ({
    requestId: req.get('x-request-id') ?? null,
    ipAddress: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
});

const parseAdminId = (req) => {
    const adminId = Number(req.params.adminId ?? req.params.id);
    if (!Number.isInteger(adminId) || adminId <= 0) {
        throw new AppError(
            'A valid admin ID is required.',
            400,
            ERROR_CODES.VALIDATION_ERROR
        );
    }
    return adminId;
};

const handleControllerError = (res, error, operation) => {
    if (error instanceof AppError) {
        return respondWithError(res, error.status, error.message, error.code);
    }

    if (error.code === '23503') {
        return respondWithError(
            res,
            422,
            'A referenced resource does not exist.',
            ERROR_CODES.VALIDATION_ERROR
        );
    }

    console.error(`Admin ${operation} failed:`, error);
    return respondWithError(
        res,
        500,
        'Internal server error.',
        ERROR_CODES.INTERNAL_SERVER_ERROR
    );
};

const revokeSessionsBestEffort = async (userId) => {
    try {
        await revokeUserSessions(userId);
    } catch (error) {
        // Database authorization is revalidated on every request, so access is
        // already revoked even if Redis cleanup temporarily fails.
        console.error('Unable to clean up revoked admin sessions:', error);
    }
};

const getCreationScope = (auth) => {
    if (auth.role === ROLES.SUPER_ADMIN) {
        return { scope: ADMIN_SCOPES.PLATFORM, vendorId: null };
    }

    if (isVendorActor(auth.role) && auth.vendorId) {
        return { scope: ADMIN_SCOPES.VENDOR, vendorId: auth.vendorId };
    }

    throw forbiddenError('You cannot invite administrators in this scope.');
};

export const createAdmin = async (req, res) => {
    try {
        const { error, value } = createAdminSchema.validate(req.body, {
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

        const { scope, vendorId } = getCreationScope(req.auth);
        const invitation = createAdminInvitation();
        const invitationUrl = buildAdminInvitationUrl(invitation.token);

        // The required users.password column receives an unguessable bootstrap
        // value. It is never disclosed and is replaced when the invite is used.
        const bootstrapPasswordHash = await passwordHash(
            crypto.randomBytes(48).toString('base64url')
        );

        const admin = await AdminModel.createAdmin({
            actor: req.auth,
            scope,
            vendorId,
            user: value,
            passwordHash: bootstrapPasswordHash,
            invitationTokenHash: invitation.tokenHash,
            invitationExpiresAt: invitation.expiresAt,
            audit: auditContext(req),
        });

        const invitationSent = await sendAdminRegistrationEmail(admin, invitationUrl);

        return respondWithSuccess(res, 201, 'Admin invitation created.', {
            ...admin,
            invitation_sent: invitationSent,
        });
    } catch (error) {
        return handleControllerError(res, error, 'creation');
    }
};

export const acceptAdminInvitation = async (req, res) => {
    try {
        const { error, value } = acceptAdminInvitationSchema.validate(req.body, {
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

        const admin = await AdminModel.acceptInvitation({
            invitationTokenHash: hashAdminInvitationToken(value.token),
            passwordHash: await passwordHash(value.password),
            audit: auditContext(req),
        });

        return respondWithSuccess(
            res,
            200,
            'Invitation accepted. You can now sign in.',
            admin
        );
    } catch (error) {
        return handleControllerError(res, error, 'invitation acceptance');
    }
};

export const resendAdminInvitation = async (req, res) => {
    try {
        const adminId = parseAdminId(req);
        const invitation = createAdminInvitation();
        const invitationUrl = buildAdminInvitationUrl(invitation.token);
        const admin = await AdminModel.rotateInvitation(
            req.auth,
            adminId,
            {
                invitationTokenHash: invitation.tokenHash,
                invitationExpiresAt: invitation.expiresAt,
            },
            auditContext(req)
        );

        const invitationSent = await sendAdminRegistrationEmail(admin, invitationUrl);
        return respondWithSuccess(res, 200, 'Admin invitation renewed.', {
            admin_id: admin.admin_id,
            invitation_expires_at: admin.invitation_expires_at,
            invitation_sent: invitationSent,
        });
    } catch (error) {
        return handleControllerError(res, error, 'invitation resend');
    }
};

export const updateAdmin = async (req, res) => {
    try {
        const adminId = parseAdminId(req);
        const { error, value } = updateAdminSchema.validate(req.body, {
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

        const admin = await AdminModel.updateAdmin(
            req.auth,
            adminId,
            value,
            auditContext(req)
        );

        if (value.status) {
            await revokeSessionsBestEffort(admin.user_id);
        }

        return respondWithSuccess(res, 200, 'Admin updated successfully.', admin);
    } catch (error) {
        return handleControllerError(res, error, 'update');
    }
};

export const fetchAdmins = async (req, res) => {
    try {
        const { offset = 0, limit = 40 } = req.pagination ?? {};
        const admins = await AdminModel.fetchAdmins(req.auth, {
            offset,
            limit,
            filters: {
                search: req.query.search,
                status: req.query.status,
                scope: req.query.scope,
                vendor_id: req.query.vendor_id
                    ? Number(req.query.vendor_id)
                    : undefined,
            },
        });

        return respondWithSuccess(res, 200, 'Admins retrieved successfully.', admins);
    } catch (error) {
        return handleControllerError(res, error, 'listing');
    }
};

export const fetchAdminById = async (req, res) => {
    try {
        const admin = await AdminModel.fetchAdminById(req.auth, parseAdminId(req));
        return respondWithSuccess(res, 200, 'Admin retrieved successfully.', admin);
    } catch (error) {
        return handleControllerError(res, error, 'lookup');
    }
};

export const deleteAdmin = async (req, res) => {
    try {
        const revoked = await AdminModel.revokeAdmin(
            req.auth,
            parseAdminId(req),
            auditContext(req)
        );
        await revokeSessionsBestEffort(revoked.userId);

        return respondWithSuccess(res, 200, 'Admin access revoked successfully.', {
            admin_id: revoked.adminId,
        });
    } catch (error) {
        return handleControllerError(res, error, 'revocation');
    }
};

export default {
    createAdmin,
    acceptAdminInvitation,
    resendAdminInvitation,
    updateAdmin,
    fetchAdmins,
    fetchAdminById,
    deleteAdmin,
};
