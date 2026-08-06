import AdminModel from "#models/admins.model.js";
import Auth from "#models/auth.model.js";
import CustomerModel from "#models/customer.model.js";
import { sendAdminRegistrationEmail } from "#models/mail.model.js";
import UserModel from "#models/user.model.js";
import VendorModel from "#models/vendor.model.js";
import { createAdminSchema, updateAdminSchema } from "#schemas/admins.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { adminDefaultPassword, isValidEmail, normalizePhone, passwordHash, ROLES } from "#utils/helpers.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";
import { config } from "dotenv";
config();

export const createAdmin = async (req, res) => {
    try {
        const { body, session } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { error, value } = createAdminSchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details.map((d) => d.message).join(", "), ERROR_CODES.VALIDATION_ERROR);
        }

        const { email, phone } = value;

        const validEmail = isValidEmail(email);
        if (!validEmail) {
            return respondWithError(res, 400, "Invalid email format", ERROR_CODES.INVALID_FORMAT);
        }

        duplicateUser = await UserModel.getUserByEmail(email);
        if (duplicateUser) {
            return respondWithError(res, 409, "Email already exists", ERROR_CODES.DUPLICATE_RESOURCE);
        }

        duplicatePhone = await UserModel.getUserByPhone(phone);
        if (duplicatePhone) {
            return respondWithError(res, 409, "Phone number already exists", ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const password = adminDefaultPassword();
        value.password = await passwordHash(password);
        value.role = "admin";

        const newAdmin = await UserModel.createUser(value);
        if (!newAdmin) {
            return respondWithError(res, 400, "Failed to create admin", ERROR_CODES.RESOURCE_CREATE_FAILED);
        }

        await sendAdminRegistrationEmail(newAdmin, password)

        await Auth.activateAccount(newAdmin.id);

        return respondWithSuccess(res, 201, "Admin added successfully", newAdmin);
    } catch (error) {
        console.error("Error creating admin:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateAdmin = async (req, res) => {
    try {
        const { body, params, session } = req;
        const user = session?.user;
        const { id } = params;

        const { error } = updateAdminSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        let phone = null;
        if (body.phone) {
            phone = normalizePhone(body.phone);
            body.phone = phone;
        }

        let adminData;

        if (vendorId) {
            adminData = await VendorModel.getVendorAdminById(id, vendorId);

            if (!adminData) {
                return respondWithError(res, 404, "Admin not found", ERROR_CODES.RESOURCE_NOT_FOUND);
            }

            if (phone && phone !== adminData.phone) {
                const duplicatePhone = await VendorModel.getVendorAdminByPhone(phone, vendorId);

                if (duplicatePhone) {
                    return respondWithError(res, 409, "Phone number already exists", ERROR_CODES.RESOURCE_CONFLICT);
                }
            }

        } else {
            adminData = await UserModel.getAdminUserById(id);

            if (!adminData) {
                return respondWithError(res, 404, "Admin not found", ERROR_CODES.RESOURCE_NOT_FOUND);
            }

            if (phone && phone !== adminData.phone) {
                const duplicatePhone = await UserModel.getAdminUserByPhone(phone);

                if (duplicatePhone) {
                    return respondWithError(res, 409, "Phone number already exists", ERROR_CODES.RESOURCE_CONFLICT);
                }
            }
        }

        const result = await UserModel.updateAdmin(id, body);

        if (!result) {
            return respondWithError(res, 500, "Failed to update admin", ERROR_CODES.RESOURCE_UPDATE_FAILED);
        }

        return respondWithSuccess(res, 200, "Admin updated successfully", result);

    } catch (error) {
        console.error("Error updating admin:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchAdmins = async (req, res) => {
    try {
        const { query, session, pagination } = req;
        const user = session?.user;
        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { offset, limit } = pagination;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        const admins = await AdminModel.fetchAdmins(vendorId, offset, limit);
        if (!admins) {
            return respondWithError(res, 404, "No admins found", ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, "Admin retrieved successfully", admins);

    } catch (error) {
        console.error("Error fetching admins:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const fetchAdminById = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        const { id } = params;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        const admin = await AdminModel.fetchAdminById(id, vendorId);
        if (!admin) {
            return respondWithError(res, 404, "Admin not found");
        }
        return respondWithSuccess(res, 200, "Admin retrieved successfully", admin);

    } catch (error) {
        console.error("Error fetching admin by ID:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const deleteAdmin = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        const { id } = params;

        let vendorId = null;
        if (user.role === ROLES.VENDOR) {
            vendorId = user.id;
        } else if (user.role === ROLES.VENDOR_ADMIN) {
            vendorId = user.vendor_id;
        }

        const result = await AdminModel.deleteAdmin(id, vendorId);
        if (!result) {
            return respondWithError(res, 400, "Failed to delete admin");
        }
        return respondWithSuccess(res, 200, "Admin deleted successfully");

    } catch (error) {
        console.error("Error deleting admin:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};