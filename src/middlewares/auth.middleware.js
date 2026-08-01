import redisClient from "#config/redis.js";
import pool from "#services/pg_pool.js";
import ERROR_CODES from "#utils/error.codes.js";
import { ROLES } from "#utils/helpers.js";
import { respondWithError } from "#utils/response.js";

export const authenticated = (req, res, next) => {
    if (!req.session?.user) {
        return respondWithError(res, 401, 'Authentication required. Please log in to continue.', ERROR_CODES.UNAUTHORIZED);
    }
    req.session.user.id = parseInt(req.session.user.id, 10);
    next();
};

const checkPermission = (routeType, permissionType) => {
    return async (req, res, next) => {
        try {
            const user = req.session?.user;
            if (!user) {
                throw new Error('User not authenticated');
            }

            // Super Admin bypass
            if (user.role === ROLES.SUPER_ADMIN) return next();

            // Find the route's admin type (query only what's needed)
            const { rows: adminTypes } = await pool.query(
                `SELECT * FROM admin_types WHERE admin_type = $1`, [routeType]
            );
            const adminType = adminTypes[0];
            if (!adminType) {
                throw new Error(`Invalid admin type: ${routeType}`);
            }

            // Find admin record for the user
            const adminResult = await pool.query(
                `SELECT * FROM admins WHERE user_id = $1`, [user.id]
            );
            if (adminResult.rowCount === 0) {
                throw new Error('Admin record not found for user');
            }
            const adminId = adminResult.rows[0].id;

            // Check sub_role match
            const roleMatch = await RolePermissions.getAdminByRole(user.id);
            const subRoles = Array.isArray(roleMatch.sub_role) ? roleMatch.sub_role : JSON.parse(roleMatch.sub_role);
            if (!subRoles.includes(adminType.id)) {
                throw new Error(`Forbidden! Only ${routeType} Admins allowed.`);
            }

            // Fetch permissions
            const permissions = await RolePermissions.getPermissionsByAdminId(adminId);
            const permission = permissions.find(p => p.admin_type_id === adminType.id);
            if (!permission) {
                throw new Error(`Forbidden! You do not have any permission for ${routeType}.`);
            }

            // Check suspension before permission type
            if (permission.status === 0) {
                throw new Error(`Sorry, your role as a ${routeType} Admin has been suspended; contact Super Admin for details!`);
            }

            // Permission type check
            if (!permission[permissionType]) {
                throw new Error(`Forbidden! You do not have ${permissionType} permission for ${routeType}.`);
            }

            return next();
        } catch (error) {
            console.error(error);
            return respondWithError(res, 500, error.message, ERROR_CODES.INTERNAL_SERVER_ERROR);
        }
    };
};

const checkRole = (expectedRoles) => async (req, res, next) => {
    try {
        const user = req.session?.user;
        if (!user) {
            throw new Error('User not authenticated');
        }

        if (!expectedRoles.includes(user.role)) {
            const roleMessages = expectedRoles.map(role => {
                switch (role) {
                    case ROLES.SUPER_ADMIN: return 'Super Admin';
                    case ROLES.ADMIN: return 'Admin';
                    case ROLES.VENDOR: return 'Vendor';
                    case ROLES.VENDOR_ADMIN: return 'Vendor Admin';
                    case ROLES.CUSTOMER: return 'Customer';
                    default: return 'Unknown';
                }
            });

            throw new Error(`Forbidden! You are not authorized. Expected roles: ${roleMessages.join(', ')}.`);
        }

        next();
    } catch (error) {
        return respondWithError(res, 500, error.message, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

// Define specific permission checkers
export const canCreate = (routeType) => checkPermission(routeType, 'can_create');
export const canRead   = (routeType) => checkPermission(routeType, 'can_read');
export const canUpdate = (routeType) => checkPermission(routeType, 'can_update');
export const canDelete = (routeType) => checkPermission(routeType, 'can_delete');

export const isSuperAdmin = checkRole([ROLES.SUPER_ADMIN]);
export const isAdmin = checkRole([ROLES.ADMIN]);
export const isVendor = checkRole([ROLES.VENDOR]);
export const isVendorAdmin = checkRole([ROLES.VENDOR_ADMIN]);
export const isVendorAndVendorAdmin = checkRole([ROLES.VENDOR, ROLES.VENDOR_ADMIN]);
export const isAllAdmin = checkRole([ROLES.SUPER_ADMIN, ROLES.ADMIN]);
export const isAllUsers = checkRole([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.VENDOR_ADMIN, ROLES.VENDOR, ROLES.CUSTOMER]);
export const isCustomer = checkRole([ROLES.CUSTOMER]);


export default {
    authenticated,
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
    isCustomer
}