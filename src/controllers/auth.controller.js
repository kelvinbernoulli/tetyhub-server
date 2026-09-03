import Auth from "#models/auth.model.js";
import UserModel from "#models/user.model.js";
import { loginSchema, registerSchema } from "#schemas/auth.schema.js";
import ERROR_CODES from "#utils/error.codes.js";
import { buildRedisKey, frontendBase, normalizePhone, passwordHash, ROLES, validatePassword, verifyPassword } from "#utils/helpers.js";
import CustomerModel from "#models/customer.model.js";
import { respondWithError, respondWithSuccess } from "#utils/response.js";
import redisClient from "#config/redis.js";
import { decrypt } from "#utils/encryption.js";
import pool from "#services/pg_pool.js";
import passport from '#config/passport.js';
import { generateCsrfToken } from '#utils/csrf.js';

const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export const userSignup = async (req, res) => {
    try {
        const { body } = req;

        const { error, value } = registerSchema.validate(body, { abortEarly: true, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details.map(err => err.message).join(','), ERROR_CODES.VALIDATION_ERROR);
        }

        const { email, password, role } = value;

        if (role !== 'customer' && role !== 'vendor') {
            return respondWithError(res, 400, 'Invalid user role', ERROR_CODES.VALIDATION_ERROR);
        }

        if (!validatePassword(password)) {
            return respondWithError(res, 422, "Password does not meet the required criteria!", ERROR_CODES.VALIDATION_ERROR);
        }

        const userData = await UserModel.getUserByEmail(email);
        if (userData) {
            return respondWithError(res, 409, `Email ${email} already exists!`, ERROR_CODES.DUPLICATE_RESOURCE);
        }

        const hashpassword = await passwordHash(password)

        const newUser = {
            ...value,
            password: hashpassword
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
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const verifyEmail = async (req, res) => {
    try {
        const { token, userId, email, vendorId } = req.query;

        const decryptedToken = decrypt(token);

        const redisKey = buildRedisKey(email, 'email_verification');

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
            WHERE email = $1`,
            [email]
        );

        await redisClient.del(redisKey);

        return respondWithSuccess(res, 200, 'Email verified successfully');
    } catch (error) {
        console.error('Error verifying email:', error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const resendVerification = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await UserModel.getUserByEmail(email);
        if (!user) {
            return respondWithError(res, 404, 'User not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        if (user.email_verified) {
            return respondWithError(res, 400, 'Email already verified', ERROR_CODES.EMAIL_ALREADY_VERIFIED);
        }

        const resend = await Auth.activateAccount(user.id);
        if (!resend.success) {
            return respondWithError(res, 400, resend.message, resend.code);
        }

        return respondWithSuccess(res, 200, 'Verification link resent successfully');

    } catch (err) {
        console.error('Error resending verification link:', err);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const userSignin = async (req, res) => {
    try {
        const { body } = req;
        const { error, value } = loginSchema.validate(body, { abortEarly: false, stripUnknown: true });
        if (error) {
            return respondWithError(res, 400, error.details.map((d) => d.message).join(', '), ERROR_CODES.VALIDATION_ERROR);
        }

        const { email, password } = value;

        const user = await UserModel.getUserByEmail(email);
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
            return respondWithError(res, 401, 'Invalid password', ERROR_CODES.INVALID_CREDENTIALS);
        }

        delete user.password;

        await new Promise((resolve, reject) => {
            req.session.regenerate((err) => (err ? reject(err) : resolve()));
        });
        req.session.user = { ...user };
        req.session.authenticated_at = Date.now();
        req.session.csrf_token = generateCsrfToken();

        await new Promise((resolve, reject) => {
            req.session.save((err) => (err ? reject(err) : resolve()));
        });

        await redisClient.sAdd(`user_sessions:${user.id}`, req.sessionID);
        await redisClient.expire(`user_sessions:${user.id}`, SESSION_MAX_AGE / 1000);

        return respondWithSuccess(res, 200, 'Login successful', {
            ...user,
            sessionId: req.sessionID,
            expiresAt: req.session.cookie.expires,
            csrfToken: req.session.csrf_token
        });
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const googleAuth = (req, res, next) => {
    try {
        passport.authenticate("google", {
            scope: ["profile", "email"]
        })
            (req, res, next);
    } catch (error) {
        console.error("Error initiating Google authentication:", error);
        return respondWithError(res, 500, "Internal Server Error", ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const googleAuthCallback = (req, res, next) => {
    try {
        passport.authenticate("google", { session: true }, async (err, user, info) => {
            if (err) {
                console.error("Google authentication error:", err);
                return res.redirect(`${frontendBase}/login?error=server_error`);
            }

            if (!user) {
                return res.redirect(`${frontendBase}/login?error=google_auth_failed`);
            }

            const result = await new Promise((resolve, reject) => {
                req.session.save((err) => (err ? reject(err) : resolve()));
            });

            delete user.password;

console.log("Session save result:", result);
            req.session.user = { ...user };
            if (user.role === ROLES.CUSTOMER) {
                return res.redirect(`${frontendBase}`);
            } else {
                return res.redirect(`${frontendBase}/dashboard`);
            }
        }
        )(req, res, next);
    } catch (error) {
        console.error("Error handling Google authentication callback:", error);
        return respondWithError(res, 500, "Internal Server Error", ERROR_CODES.INTERNAL_SERVER_ERROR);
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
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const requestPasswordReset = async (req, res) => {
    try {
        const { email } = req.body;

        const user = await UserModel.getUserByEmail(email);
        if (!user) {
            return respondWithError(res, 404, 'User not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const send = await Auth.forgotPassword(email);
        if (!send.success) {
            return respondWithError(res, 400, 'Failed to send password reset email', ERROR_CODES.EMAIL_SEND_FAILED);
        }
        return respondWithSuccess(res, 200, send.message, { email: user.email });

    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const confirmPasswordReset = async (req, res) => {
    try {
        const { body, query } = req;
        const { new_password } = body;
        const { email, token } = query;
        
        const decryptedToken = decrypt(token);

        const redisKey = buildRedisKey(email, 'password_reset');

        const stored = await redisClient.get(redisKey);

        if (!stored) {
            return respondWithError(res, 400, 'Verification link expired', ERROR_CODES.OTP_EXPIRED);
        }

        if (stored !== decryptedToken) {
            return respondWithError(res, 400, 'Invalid verification link', ERROR_CODES.OTP_INVALID);
        }

        const passwordValid = validatePassword(new_password);
        if (!passwordValid) {
            return respondWithError(res, 422, "Password does not meet the requirements; it must be at least 8 characters long and contain a mix of uppercase, lowercase, numbers, and special characters.", ERROR_CODES.VALIDATION_ERROR);
        }

        const user = await UserModel.getUserByEmail(email);

        const comparePassword = await verifyPassword(new_password, user.password);
        if (comparePassword) {
            return respondWithError(res, 400, 'New password cannot be the same as the old password', ERROR_CODES.VALIDATION_ERROR);
        }

        const hashpassword = await passwordHash(new_password);

        await pool.query(
            `UPDATE users
            SET password = $1
            WHERE email = $2`,
            [hashpassword, email]
        );

        await redisClient.del(redisKey);

        return respondWithSuccess(res, 200, 'Password reset successfully');
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
}

export const refreshSession = async (req, res) => {
    try {
        if (!req.session?.user) {
            return respondWithError(res, 401, 'No active session found.', ERROR_CODES.UNAUTHORIZED);
        }

        req.session.touch();

        await new Promise((resolve, reject) => {
            req.session.save((err) => (err ? reject(err) : resolve()));
        });

        // Keep the session index TTL in sync
        await redisClient.expire(`user_sessions:${req.session.user.id}`, SESSION_MAX_AGE / 1000);

        return respondWithSuccess(res, 200, 'Session refreshed', {
            expiresAt: req.session.cookie.expires,
            csrfToken: req.session.csrf_token
        });
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getUserSessions = async (req, res) => {
    try {
        const { session } = req;
        const user = session?.user;

        const sessionIds = await redisClient.sMembers(`user_sessions:${user.id}`);
        if (!sessionIds.length) {
            return respondWithSuccess(res, 200, 'No active sessions', []);
        }

        const keys = sessionIds.map((id) => `sess:${id}`);
        const values = await redisClient.mGet(keys);

        const userSessions = [];
        const staleSessionIds = [];

        values.forEach((data, index) => {
            if (!data) {
                staleSessionIds.push(sessionIds[index]); // session expired/gone but index still had it
                return;
            }
            try {
                const parsed = JSON.parse(data);
                if (!parsed?.user) return;
                userSessions.push({
                    sessionId: sessionIds[index],
                    user: parsed.user,
                    expiresAt: parsed?.cookie?.expires || null
                });
            } catch {
                staleSessionIds.push(sessionIds[index]);
            }
        });

        // Lazily clean up any stale references so the index doesn't grow unbounded
        if (staleSessionIds.length) {
            await redisClient.sRem(`user_sessions:${user.id}`, staleSessionIds);
        }

        return respondWithSuccess(res, 200, 'User sessions retrieved', userSessions);
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const getAllSessions = async (req, res) => {
    try {
        const rawKeys = [];
        for await (const key of redisClient.scanIterator({ MATCH: 'sess:*' })) {
            rawKeys.push(key);
        }
        const keys = rawKeys.flat().map(String);

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
                        user: {
                            id: parsed.user.id,
                            email: parsed.user.email,
                            role: parsed.user.role,
                        },
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
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const revokeSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const rawSession = await redisClient.get(`sess:${sessionId}`);

        const deleted = await redisClient.del(`sess:${sessionId}`);
        if (!deleted) {
            return respondWithError(res, 404, 'Session not found', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        if (rawSession) {
            try {
                const ownerId = JSON.parse(rawSession)?.user?.id;
                if (ownerId) {
                    await redisClient.sRem(`user_sessions:${ownerId}`, sessionId);
                }
            } catch {
                // The primary session was revoked; a stale index is harmless and
                // will be removed by the user's next session listing.
            }
        }

        return respondWithSuccess(res, 200, 'Session terminated successfully');
    } catch (error) {
        console.error(error);
        return respondWithError(res, 500, 'Internal server error', ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const revokeUserSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.auth.userId;
        const ownsSession = await redisClient.sIsMember(
            `user_sessions:${userId}`,
            sessionId
        );

        if (!ownsSession) {
            return respondWithError(
                res,
                404,
                'Session not found.',
                ERROR_CODES.RESOURCE_NOT_FOUND
            );
        }

        await redisClient.multi()
            .del(`sess:${sessionId}`)
            .sRem(`user_sessions:${userId}`, sessionId)
            .exec();

        return respondWithSuccess(res, 200, 'Session terminated successfully.');
    } catch (error) {
        console.error('Unable to revoke user session:', error);
        return respondWithError(
            res,
            500,
            'Internal server error',
            ERROR_CODES.INTERNAL_SERVER_ERROR
        );
    }
};

export const getCsrfToken = async (req, res) => {
    if (!req.session.csrf_token) {
        req.session.csrf_token = generateCsrfToken();
        await new Promise((resolve, reject) => {
            req.session.save((error) => (error ? reject(error) : resolve()));
        });
    }

    return respondWithSuccess(res, 200, 'CSRF token retrieved.', {
        csrfToken: req.session.csrf_token,
    });
};
