import AdminType from "#models/admin.types.model.js";
import UserModel from "#models/user.model.js";
import VendorModel from "#models/vendor.model.js";
import { adminPermissionsSchema } from "#schemas/permissions.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { ROLES } from "#utils/helpers.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";


export const assignAdminPermissions = async (req, res) => {
    try {
        const { body, session } = req;
        const user = session?.user;

        const { error } = adminPermissionsSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.BAD_REQUEST);
        }

        if (!user) {
            return respondWithError(res, 401, "Unauthorized", ERROR_CODES.UNAUTHORIZED);
        }
        const { admin_id, permissions, admin_roles } = body;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        // Validate admin roles exist
        const validRoles = await AdminType.getAdminTypesByIds(admin_roles, vendorId);
        console.log("Valid admin roles:", validRoles);
        if (validRoles.length !== admin_roles.length) {
            const invalidIds = admin_roles.filter(id =>
                !validRoles.find(r => r.id === parseInt(id))
            );
            return respondWithError(
                res, 422,
                `Invalid admin role IDs: ${invalidIds.join(', ')}`,
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        // Check permission keys match admin_roles
        const permissionKeys = Object.keys(permissions).map(Number);
        const unmatchedKeys = permissionKeys.filter(key => !admin_roles.includes(key));
        if (unmatchedKeys.length > 0) {
            return respondWithError(
                res, 422,
                `Permission keys don't match admin roles: ${unmatchedKeys.join(', ')}`,
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        // Verify admin exists and belongs to right scope
        let adminData;
        if (vendorId) {
            adminData = await VendorModel.getVendorAdminById(admin_id, vendorId);
        } else {
            adminData = await UserModel.getAdminUserById(admin_id);
        }

        if (!adminData) {
            return respondWithError(res, 404, "Admin not found", ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        // Prevent assigning permissions to Super Admin
        if (adminData.role === ROLES.SUPER_ADMIN) {
            return respondWithError(res, 403, "Cannot assign permissions to a Super Admin", ERROR_CODES.FORBIDDEN);
        }

        const result = await UserModel.assignAdminPermissions(admin_id, admin_roles, permissions, vendorId);
        console.log("Permissions assignment result:", result);
        if (!result) {
            return respondWithError(res, 500, "Failed to assign permissions", ERROR_CODES.RESOURCE_UPDATE_FAILED);
        }

        return respondWithSuccess(res, 200, "Permissions assigned successfully", result);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchAdminPermissions = async (req, res) => {
    try {
        const { params, session } = req;
        const user = session?.user;
        const { adminId } = params;

        if (!adminId) {
            return respondWithError(res, 400, "Admin ID is required", ERROR_CODES.VALIDATION_ERROR);
        }

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        // Verify admin exists first
        let adminData;
        if (vendorId) {
            adminData = await VendorModel.getVendorAdminById(adminId, vendorId);
        } else {
            adminData = await UserModel.getAdminUserById(adminId);
        }

        if (!adminData) {
            return respondWithError(res, 404, "Admin not found", ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const permissions = await UserModel.fetchAdminPermissions(adminId, vendorId);

        return respondWithSuccess(res, 200, "Permissions fetched successfully", permissions ?? []);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}


export default {
    assignAdminPermissions,
    fetchAdminPermissions
};