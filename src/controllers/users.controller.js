import CustomerModel from "#models/customer.model.js";
import { addAddressSchema, updateAddressSchema, updateProfileSchema } from "#schemas/auth.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";

export const getProfile = async (req, res) => {
    try {
        const { session } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const profile = await CustomerModel.getProfile(user.id);
        if (!profile) {
            return respondWithError(res, 404, 'Profile not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Profile fetched successfully', profile);
    } catch (error) {
        console.error("Error fetching profile:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateProfile = async (req, res) => {
    try {
        const { session, body } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { error } = updateProfileSchema.validate(body);
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await CustomerModel.updateProfile(user.id, body);
        return respondWithSuccess(res, 200, 'Profile updated successfully', result);
    } catch (error) {
        console.error("Error updating profile:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const addAddress = async (req, res) => {
    try {
        const { session, body } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }


        const { error, value } = addAddressSchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await CustomerModel.addAddress(user.id, user.vendor_id, value);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.RESOURCE_CREATE_FAILED);
        }
        return respondWithSuccess(res, 201, 'Address added successfully', result);
    } catch (error) {
        console.error("Error adding address:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const updateAddress = async (req, res) => {
    try {
        const { session, body, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { addressId } = params;

        const { error, value } = updateAddressSchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const result = await CustomerModel.updateAddress(user.id, user.vendor_id, addressId, value);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.RESOURCE_UPDATE_FAILED);
        }

        return respondWithSuccess(res, 200, 'Address updated successfully', result);
    } catch (error) {
        console.error("Error updating address:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const deleteAddress = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { addressId } = params;

        const result = await CustomerModel.deleteAddress(user.id, user.vendor_id, addressId);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Address deleted successfully', null);
    } catch (error) {
        console.error("Error deleting address:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const setDefaultAddress = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;

        if (!user) {
            return respondWithError(res, 401, 'Unauthorized', ERROR_CODES.UNAUTHORIZED);
        }

        const { addressId } = params;

        const result = await CustomerModel.setDefaultAddress(user.id, user.vendor_id, addressId);
        if (result?.error) {
            return respondWithError(res, result.code, result.error, ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Default address updated successfully', result);
    } catch (error) {
        console.error("Error setting default address:", error);
        return respondWithError(res, 500, error.message || 'Internal Server Error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};