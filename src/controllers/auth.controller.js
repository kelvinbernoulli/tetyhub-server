import Auth from "#models/auth.model.js";
import UserModel from "#models/user.model.js";
import VendorModel from "#models/vendor.model.js";
import { customerRegisterSchema, loginSchema, registerSchema } from "#schemas/auth.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { buildRedisKey, normalizePhone, passwordHash, ROLES, validatePassword, verifyPassword } from "#utils/helpers.js";
import CustomerModel from "#models/customer.model.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";
import redisClient from "#config/redis.js";
import { decrypt } from "#utils/encryption.js";
import pool from "#services/pg_pool.js";

export const vendorSignup = async (req, res) => {
    try {
        const { body } = req;

        const { error, value } = registerSchema.validate(body, { abortEarly: true, stripUnknown: true});
        if (error) {
            return respondWithError(res, 400, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        const { email, password, country_id, phone } = value;

        if (!validatePassword(password)) {
            return respondWithError(res, 422, "Password does not meet the required criteria!", ERROR_CODES.VALIDATION_ERROR);
        }

        const userData = await VendorModel.getVendorByEmail(email);
        if (userData) {
            return respondWithError(res, 409, `Email ${email} already exists!`, ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const countryData = await UserModel.getCountryById(country_id);
        if (!countryData) {
            return respondWithError(res, 422, "Invalid country ID!", ERROR_CODES.VALIDATION_ERROR);
        }
        const normalizedphone = normalizePhone(phone, countryData.country_code);

        const phoneData = await VendorModel.getVendorByPhone(normalizedphone);
        if (phoneData) {
            return respondWithError(res, 409, `Phone ${normalizedphone} already exists!`, ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const hashpassword = await passwordHash(password)

        const role = parseInt(3);

        const newUser = {
            ...body,
            password: hashpassword,
            phone: normalizedphone,
            role
        };

        const createUser = await UserModel.createUser(newUser);
        if (!createUser) {
            return respondWithError(res, 400, 'Failed to create user', ERROR_CODES.RESOURCE_CREATE_FAILED);
        }
        delete body.password;
        await Auth.activateAccount(createUser.id);

        return respondWithSuccess(res, 200, "Verification email sent, please check your email.", body);
    } catch (error) {
        console.error("Error during vendor registration:", error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const customerSignup = async (req, res) => {
    try {
        const { body } = req;

        const { error, value } = customerRegisterSchema.validate(body);
        if (error) {
            return respondWithError(res, 422, error.details[0].message, ERROR_CODES.VALIDATION_ERROR);
        }

        if (!validatePassword(value.password)) {
            return respondWithError(res, 422, "Password does not meet the required criteria!", ERROR_CODES.VALIDATION_ERROR);
        }

        const vendorData = await VendorModel.getVendorById(value.vendor_id);
        if (!vendorData) {
            return respondWithError(res, 404, 'Vendor not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const userData = await CustomerModel.getCustomerByEmail(value.email, value.vendor_id);
        if (userData) {
            return respondWithError(res, 409, `Email ${value.email} already exists!`, ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const countryData = await UserModel.getCountryById(value.country_id);
        if (!countryData) {
            return respondWithError(res, 422, "Invalid country ID!", ERROR_CODES.VALIDATION_ERROR);
        }
        const normalizedphone = normalizePhone(value.phone, countryData.country_code);

        const phoneData = await CustomerModel.getCustomerByPhone(normalizedphone, value.vendor_id);
        if (phoneData) {
            return respondWithError(res, 409, `Phone ${normalizedphone} already exists!`, ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const hashpassword = await passwordHash(value.password);

        const role = ROLES.CUSTOMER;

        const newUser = {
            ...value,
            password: hashpassword,
            phone: normalizedphone,
            role
        };

        const createUser = await UserModel.createUser(newUser, value.vendor_id);
        if (!createUser) {
            return respondWithError(res, 400, "Failed to create user", ERROR_CODES.RESOURCE_CREATE_FAILED);
        }

        delete value.password;
        await Auth.activateAccount(createUser.id, createUser.vendor_id);

        return respondWithSuccess(res, 200, "Verification email sent, please check your email", value);

    } catch (error) {
        console.error("Error during user registration:", error);
        return respondWithError(res, 500, error.message || error, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const verifyEmail = async (req, res) => {
    try {
        const { token, userId, email, vendorId } = req.query;

        const decryptedToken = decrypt(token);
        const decryptedUserId = decrypt(userId);
        const decryptedVendorId = vendorId ? decrypt(vendorId) : null;

        const redisKey = buildRedisKey(email, 'email_verification', decryptedVendorId, decryptedUserId);

        const stored = await redisClient.get(redisKey);

        if (!stored) {
            return respondWithError(res, 400, 'Verification link expired', ERROR_CODES.OTP_EXPIRED);
        }

        if (stored !== decryptedToken) {
            return respondWithError(res, 400, 'Invalid verification link', ERROR_CODES.OTP_INVALID);
        }

        await pool.query(
            `UPDATE users
            SET email_verified = true,
                email_verified_at = NOW(),
                status = 'active'
            WHERE id = $1`,
            [decryptedUserId]
        );

        await redisClient.del(redisKey);

        return respondWithSuccess(res, 200, 'Email verified successfully');
    } catch (error) {
        console.error('Error verifying email:', error);
        return respondWithError(res, 500, error.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const resendVerification = async (req, res) => {
    try {
        const { email, vendor_id } = req.body;

        let user;
        if (vendor_id) {
            user = await CustomerModel.getCustomerByEmail(email, vendor_id)
                || await VendorModel.getVendorAdminByEmail(email, vendor_id);
        } else {
            user = await UserModel.getUserByEmail(email);
        }

        if (!user) {
            return respondWithError(res, 404, 'User not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const resend = await Auth.activateAccount(user.id, vendor_id);
        if (!resend.success) {
            return respondWithError(res, 400, resend.message, resend.code);
        }
        return respondWithSuccess(res, 200, 'Verification link resent successfully');
    } catch (err) {
        console.error('Error resending verification link:', err);
        return respondWithError(res, 500, err.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const adminSignIn = async (req, res) => {
    try {
        const { body } = req;
        const { error, value } = loginSchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details.map((d) => d.message).join(', '), ERROR_CODES.VALIDATION_ERROR);
        }

        const { email, password, vendor_id } = value;

        let user;
        if (vendor_id) {
            const vendorData = await UserModel.getVendorById(vendor_id);
            if (!vendorData) {
                return respondWithError(res, 404, 'Vendor not found', ERROR_CODES.RESOURCE_NOT_FOUND);
            }
            user = await VendorModel.getUserByEmailAndVendorId(email, vendor_id);
        } else {
            user = await UserModel.getUserByEmailAndRole(email, [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.VENDOR]);
        }

        if (!user) {
            return respondWithError(res, 404, 'User not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        if (!user.email_verified && user.role !== ROLES.SUPER_ADMIN) {
            return respondWithError(res, 403, 'Email not verified', ERROR_CODES.EMAIL_NOT_VERIFIED);
        }

        if (user.status !== 'active' && user.role !== ROLES.SUPER_ADMIN) {
            return respondWithError(res, 403, 'Account is inactive', ERROR_CODES.ACCOUNT_INACTIVE);
        }

        const passwordValid = await verifyPassword(password, user.password);
        if (!passwordValid) {
            return respondWithError(res, 401, 'Invalid credentials', ERROR_CODES.INVALID_CREDENTIALS);
        }

        await new Promise((resolve, reject) => {
            req.session.regenerate((err) => (err ? reject(err) : resolve()));
        });

        req.session.user = {
            id: Number(user.id),
            ...user
        };

        return respondWithSuccess(res, 200, 'Login successful', user);

    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const customerSignin = async (req, res) => {
    try {
        const { body } = req;
        const { error, value } = loginSchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details.map((d) => d.message).join(', '), ERROR_CODES.VALIDATION_ERROR);
        }

        const { email, password, vendor_id } = value;

        const vendorData = await VendorModel.getVendorById(vendor_id);
        if (!vendorData) {
            return respondWithError(res, 404, 'Vendor not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const user = await CustomerModel.getCustomerByEmail(email, vendor_id);
        if (!user) {
            return respondWithError(res, 404, 'User not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        if (!user.email_verified) {
            return respondWithError(res, 403, 'Email not verified', ERROR_CODES.EMAIL_NOT_VERIFIED);
        }

        if (user.status !== 'active') {
            return respondWithError(res, 403, 'Account is not active', ERROR_CODES.ACCOUNT_INACTIVE);
        }

        const passwordValid = await verifyPassword(password, user.password);
        if (!passwordValid) {
            return respondWithError(res, 401, 'Invalid credentials', ERROR_CODES.INVALID_CREDENTIALS);
        }

        await new Promise((resolve, reject) => {
            req.session.regenerate((err) => (err ? reject(err) : resolve()));
        });

        req.session.user = {
            ...user
        };

        return respondWithSuccess(res, 200, 'Login successful', user);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const signOut = async (req, res) => {
    try {
        await new Promise((resolve, reject) => {
            req.session.destroy((err) => (err ? reject(err) : resolve()));
        });

        res.clearCookie('connect.sid');

        return respondWithSuccess(res, 200, 'Logged out successfully');
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const requestPasswordReset = async (req, res) => {
    try {
        const { email, vendor_id } = req.body;

        let user;
        if (vendor_id) {
            const vendorData = await UserModel.getVendorById(vendor_id);
            if (!vendorData) {
                return respondWithError(res, 404, 'Vendor not found', ERROR_CODES.RESOURCE_NOT_FOUND);
            }
            user = await VendorModel.getUserByEmailAndVendorId(email, vendor_id);
        } else {
            user = await UserModel.getUserByEmail(email);
        }

        if (!user) {
            return respondWithError(res, 404, 'User not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const send = await Auth.forgotPassword(user?.id, vendor_id);
        if (!send.success) {
            return respondWithError(res, 400, 'Failed to send password reset email', ERROR_CODES.EMAIL_SEND_FAILED);
        }
        return respondWithSuccess(res, 200, send.message, { email: user.email });

    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const confirmPasswordReset = async (req, res) => {
    try {
        const { body, query } = req;
        const { new_password } = body;
        const { email, token, userId, vendorId } = query;

        const decryptedToken = decrypt(token);
        const decryptedUserId = decrypt(userId);
        const decryptedVendorId = vendorId ? decrypt(vendorId) : null;

        const redisKey = buildRedisKey(email, 'password_reset', decryptedVendorId, decryptedUserId);

        const stored = await redisClient.get(redisKey);

        if (!stored) {
            return respondWithError(res, 400, 'Verification link expired', ERROR_CODES.OTP_EXPIRED);
        }

        const passwordValid = validatePassword(new_password);
        if (!passwordValid) {
            return respondWithError(res, 422, "Password does not meet the requirements; it must be at least 8 characters long and contain a mix of uppercase, lowercase, numbers, and special characters.", ERROR_CODES.VALIDATION_ERROR);
        }

        if (stored !== decryptedToken) {
            return respondWithError(res, 400, 'Invalid verification link', ERROR_CODES.OTP_INVALID);
        }

        const comparePassword = await verifyPassword(new_password, stored);
        if (comparePassword) {
            return respondWithError(res, 400, 'New password cannot be the same as the old password', ERROR_CODES.VALIDATION_ERROR);
        }

        const hashpassword = await passwordHash(new_password);

        await pool.query(
            `UPDATE users
            SET password = $1,
                status = 'active'
            WHERE id = $2`,
            [hashpassword, decryptedUserId]
        );

        await redisClient.del(redisKey);

        return respondWithSuccess(res, 200, 'Password reset successfully');
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const refreshSession = async (req, res) => {
    try {
        if (!req.session?.user) {
            return respondWithError(res, 401, 'No active session found.', ERROR_CODES.UNAUTHORIZED);
        }

        req.session._garbage = Date();
        req.session.touch();

        return respondWithSuccess(res, 200, 'Session refreshed', {
            expiresAt: new Date(Date.now() + req.session.cookie.maxAge)
        });
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getAllSessions = async (req, res) => {
    try {
        const keys = [];
        for await (const key of redisClient.scanIterator({ MATCH: 'sess:*' })) {
            keys.push(String(key)); // ensure keys are plain strings
        }

        if (!keys.length) {
            return respondWithSuccess(res, 200, 'No active sessions', []);
        }

        const values = await redisClient.mGet(keys);

        const activeSessions = values
            .map((data, index) => {
                try {
                    const parsed = JSON.parse(data);
                    if (!parsed?.user) return null;
                    return {
                        sessionId: keys[index].replace('sess:', ''),
                        user: parsed.user,
                        expiresAt: parsed?.cookie?.expires || null
                    };
                } catch {
                    return null;
                }
            })
            .filter(Boolean);

        return respondWithSuccess(res, 200, 'Active sessions retrieved', activeSessions);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const revokeSession = async (req, res) => {
    try {
        const { sessionId } = req.params;

        const deleted = await redisClient.del(`sess:${sessionId}`);
        if (!deleted) {
            return respondWithError(res, 404, 'Session not found', ERROR_CODES.NOT_FOUND);
        }

        return respondWithSuccess(res, 200, 'Session terminated successfully');
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, error.message || 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};