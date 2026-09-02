import pool from '#services/pg_pool.js';
import ERROR_CODES from '#utils/error.codes.js';
import {
    ADMIN_SCOPES,
    ADMIN_STATUSES,
    PERMISSION_ACTIONS,
    PERMISSION_SCOPES,
    ROLES,
    USER_STATUSES,
} from '#utils/access-control.js';
import { respondWithError } from '#utils/response.js';
import { csrfTokensMatch } from '#utils/csrf.js';

class AuthenticationError extends Error {
    constructor(message, status = 401, code = ERROR_CODES.UNAUTHORIZED) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

const fetchPrincipal = async (userId) => {
    const { rows } = await pool.query(
        `SELECT
            u.id AS user_id,
            u.email,
            u.firstname,
            u.lastname,
            u.role::text AS role,
            u.status::text AS user_status,
            u.email_verified,
            u.auth_version,
            a.id AS admin_id,
            a.scope::text AS admin_scope,
            a.status::text AS admin_status,
            a.vendor_id AS admin_vendor_id,
            a.authz_version,
            owned_vendor.id AS owned_vendor_id,
            owned_vendor.status AS owned_vendor_status,
            assigned_vendor.status AS assigned_vendor_status
        FROM users u
        LEFT JOIN admins a ON a.user_id = u.id
        LEFT JOIN vendors owned_vendor ON owned_vendor.user_id = u.id
        LEFT JOIN vendors assigned_vendor ON assigned_vendor.id = a.vendor_id
        WHERE u.id = $1
        LIMIT 1`,
        [userId]
    );

    return rows[0] ?? null;
};

export const hydrateAuthContext = async (req) => {
    if (req.auth) return req.auth;

    const sessionUserId = Number(req.session?.user?.id);
    if (!Number.isInteger(sessionUserId) || sessionUserId <= 0) {
        throw new AuthenticationError('Authentication required. Please log in to continue.');
    }

    const principal = await fetchPrincipal(sessionUserId);
    if (!principal) {
        throw new AuthenticationError('Session is no longer valid.');
    }

    if (principal.user_status !== USER_STATUSES.ACTIVE) {
        throw new AuthenticationError(
            'This account is not active.',
            403,
            ERROR_CODES.ACCOUNT_DEACTIVATED
        );
    }

    let vendorId = null;

    if (principal.role === ROLES.SUPER_ADMIN || principal.role === ROLES.ADMIN) {
        if (
            !principal.admin_id
            || principal.admin_scope !== ADMIN_SCOPES.PLATFORM
            || principal.admin_status !== ADMIN_STATUSES.ACTIVE
        ) {
            throw new AuthenticationError(
                'Administrative access is not active.',
                403,
                ERROR_CODES.ACCOUNT_SUSPENDED
            );
        }
    } else if (principal.role === ROLES.VENDOR) {
        if (!principal.owned_vendor_id || principal.owned_vendor_status !== USER_STATUSES.ACTIVE) {
            throw new AuthenticationError(
                'Vendor access is not active.',
                403,
                ERROR_CODES.ACCOUNT_SUSPENDED
            );
        }
        vendorId = Number(principal.owned_vendor_id);
    } else if (principal.role === ROLES.VENDOR_ADMIN) {
        if (
            !principal.admin_id
            || principal.admin_scope !== ADMIN_SCOPES.VENDOR
            || principal.admin_status !== ADMIN_STATUSES.ACTIVE
            || principal.assigned_vendor_status !== USER_STATUSES.ACTIVE
        ) {
            throw new AuthenticationError(
                'Vendor administrator access is not active.',
                403,
                ERROR_CODES.ACCOUNT_SUSPENDED
            );
        }
        vendorId = Number(principal.admin_vendor_id);
    }

    req.auth = Object.freeze({
        userId: Number(principal.user_id),
        email: principal.email,
        role: principal.role,
        userStatus: principal.user_status,
        authVersion: principal.auth_version,
        adminId: principal.admin_id ? Number(principal.admin_id) : null,
        adminScope: principal.admin_scope ?? null,
        adminStatus: principal.admin_status ?? null,
        authzVersion: principal.authz_version ?? null,
        vendorId,
    });

    // Keep legacy controllers functional while ensuring these values come from
    // the database rather than stale or client-controlled session data.
    req.session.user = {
        id: req.auth.userId,
        email: principal.email,
        firstname: principal.firstname,
        lastname: principal.lastname,
        role: req.auth.role,
        status: req.auth.userStatus,
        email_verified: principal.email_verified,
        auth_version: req.auth.authVersion,
        admin_id: req.auth.adminId,
        vendor_id: req.auth.vendorId,
    };

    return req.auth;
};

const handleAuthenticationError = (res, error) => {
    if (error instanceof AuthenticationError) {
        return respondWithError(res, error.status, error.message, error.code);
    }

    console.error('Unable to resolve authorization context:', error);
    return respondWithError(
        res,
        500,
        'Unable to verify authorization.',
        ERROR_CODES.INTERNAL_SERVER_ERROR
    );
};

export const authenticated = async (req, res, next) => {
    try {
        await hydrateAuthContext(req);
        return next();
    } catch (error) {
        return handleAuthenticationError(res, error);
    }
};

export const requireRoles = (...expectedRoles) => async (req, res, next) => {
    try {
        const auth = await hydrateAuthContext(req);
        if (!expectedRoles.includes(auth.role)) {
            return respondWithError(
                res,
                403,
                'You are not authorized to perform this action.',
                ERROR_CODES.FORBIDDEN
            );
        }
        return next();
    } catch (error) {
        return handleAuthenticationError(res, error);
    }
};

export const requireRecentAuthentication = (maxAgeMs = 15 * 60 * 1000) => (
    async (req, res, next) => {
        try {
            await hydrateAuthContext(req);
            const authenticatedAt = Number(req.session?.authenticated_at);
            if (
                !Number.isFinite(authenticatedAt)
                || Date.now() - authenticatedAt > maxAgeMs
            ) {
                return respondWithError(
                    res,
                    403,
                    'Please sign in again before performing this sensitive action.',
                    ERROR_CODES.AUTHENTICATION_FAILED
                );
            }
            return next();
        } catch (error) {
            return handleAuthenticationError(res, error);
        }
    }
);

export const requireCsrfProtection = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    const providedToken = req.get('x-csrf-token');
    if (!csrfTokensMatch(req.session?.csrf_token, providedToken)) {
        return respondWithError(
            res,
            403,
            'Invalid or missing CSRF token.',
            ERROR_CODES.FORBIDDEN
        );
    }

    return next();
};

const checkPermission = (resource, action) => async (req, res, next) => {
    try {
        const auth = await hydrateAuthContext(req);

        if (auth.role === ROLES.SUPER_ADMIN || auth.role === ROLES.VENDOR) {
            return next();
        }

        if (!auth.adminId || ![ROLES.ADMIN, ROLES.VENDOR_ADMIN].includes(auth.role)) {
            return respondWithError(
                res,
                403,
                'You do not have permission to perform this action.',
                ERROR_CODES.INSUFFICIENT_PERMISSIONS
            );
        }

        const permissionColumn = PERMISSION_ACTIONS[action.toUpperCase()];
        if (!permissionColumn) {
            throw new Error(`Unsupported permission action: ${action}`);
        }

        const permittedScopes = auth.adminScope === ADMIN_SCOPES.PLATFORM
            ? [PERMISSION_SCOPES.PLATFORM, PERMISSION_SCOPES.BOTH]
            : [PERMISSION_SCOPES.VENDOR, PERMISSION_SCOPES.BOTH];

        const { rowCount } = await pool.query(
            `SELECT 1
            FROM admin_permissions ap
            JOIN admin_types at ON at.id = ap.admin_type_id
            WHERE ap.admin_id = $1
              AND at.slug = $2
              AND at.scope::text = ANY($3::text[])
              AND at.status = true
              AND ap.status = true
              AND (ap.expires_at IS NULL OR ap.expires_at > NOW())
              AND CASE $4
                    WHEN 'can_create' THEN ap.can_create
                    WHEN 'can_read' THEN ap.can_read
                    WHEN 'can_update' THEN ap.can_update
                    WHEN 'can_delete' THEN ap.can_delete
                    ELSE false
                  END = true
            LIMIT 1`,
            [auth.adminId, resource, permittedScopes, permissionColumn]
        );

        if (rowCount === 0) {
            return respondWithError(
                res,
                403,
                'You do not have permission to perform this action.',
                ERROR_CODES.INSUFFICIENT_PERMISSIONS
            );
        }

        return next();
    } catch (error) {
        return handleAuthenticationError(res, error);
    }
};

export const canCreate = (resource) => checkPermission(resource, 'create');
export const canRead = (resource) => checkPermission(resource, 'read');
export const canUpdate = (resource) => checkPermission(resource, 'update');
export const canDelete = (resource) => checkPermission(resource, 'delete');

export const isSuperAdmin = requireRoles(ROLES.SUPER_ADMIN);
export const isAdmin = requireRoles(ROLES.ADMIN);
export const isVendor = requireRoles(ROLES.VENDOR);
export const isVendorAdmin = requireRoles(ROLES.VENDOR_ADMIN);
export const isVendorAndVendorAdmin = requireRoles(ROLES.VENDOR, ROLES.VENDOR_ADMIN);
export const isAllAdmin = requireRoles(ROLES.SUPER_ADMIN, ROLES.ADMIN);
export const isAllUsers = requireRoles(...Object.values(ROLES));
export const isCustomer = requireRoles(ROLES.CUSTOMER);

export default {
    authenticated,
    hydrateAuthContext,
    requireRoles,
    requireRecentAuthentication,
    requireCsrfProtection,
    canCreate,
    canRead,
    canUpdate,
    canDelete,
    isSuperAdmin,
    isAdmin,
    isVendor,
    isVendorAdmin,
    isVendorAndVendorAdmin,
    isAllAdmin,
    isAllUsers,
    isCustomer,
};
