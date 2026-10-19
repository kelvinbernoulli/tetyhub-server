import redisClient from "#config/redis.js";
import { createHash } from 'node:crypto';
import pool from "#services/pg_pool.js";
import { createAuthToken, hashAuthToken } from "#utils/auth-token.js";
import { buildRedisKey, frontendBase, generateOTP, ROLES } from "#utils/helpers.js";
import { sendAdminRegistrationEmail, sendEmailVerificationLink, sendLoginOTP, sendPasswordResetLink } from "./mail.model.js";
import { select_by_keys } from "./query.model.js";
import { config } from "dotenv";
config();

const otpAttemptKey = (identity, type) =>
    `otp-attempts:${createHash('sha256')
        .update(`${String(identity).trim().toLowerCase()}:${type}`, 'utf8')
        .digest('hex')}`;

const registerOtpAttempt = async (identity, type) => {
    const key = otpAttemptKey(identity, type);
    const attempts = await redisClient.incr(key);
    if (attempts === 1) await redisClient.expire(key, 10 * 60);
    return { key, allowed: attempts <= 5 };
};
const otpExpirationSeconds = () => {
    const configured = Number(process.env.OTP_EXPIRATION ?? 600);
    return Number.isFinite(configured) && configured > 0 ? configured : 600;
};

export class Auth {
    static async activateAccount(id) {
        const { rows } = await pool.query(
            `SELECT u.id, u.firstname, u.lastname, u.email, u.role, u.email_verified
            FROM users u
            WHERE u.id = $1
            LIMIT 1`,
            [id]
        );

        const user = rows[0];
        if (!user) throw Object.assign(
            new Error('User not found'),
            { status: 404, code: 'USER_NOT_FOUND' }
        );

        if (user.email_verified) throw Object.assign(
            new Error('Email is already verified'),
            { status: 409, code: 'ALREADY_VERIFIED' }
        );

        const token = createAuthToken();

        // Match buildRedisKey format
        const redisKey = buildRedisKey(user.email, 'email_verification');
        await redisClient.set(redisKey, hashAuthToken(token), { EX: 30 * 60 });

        const link = new URL('/verify-email', frontendBase);
        link.searchParams.set('token', token);
        link.searchParams.set('email', user.email);

        await sendEmailVerificationLink(user, link.toString());
        return { success: true, message: 'Verification email sent' };
    }

    static async forgotPassword(email) {
        const { rows } = await pool.query(
            `SELECT u.id, u.firstname, u.lastname, u.email, u.role, u.email_verified
            FROM users u
            WHERE u.email = $1
            LIMIT 1`,
            [email]
        );

        const user = rows[0];

        if (!user) throw Object.assign(
            new Error('User not found'),
            { status: 404, code: 'USER_NOT_FOUND' }
        );

        const token = createAuthToken();

        // Match buildRedisKey format
        const redisKey = buildRedisKey(user.email, 'password_reset');
        await redisClient.set(redisKey, hashAuthToken(token), { EX: 600 });
        
        const link = new URL('/forgot-password', frontendBase);
        link.searchParams.set('token', token);
        link.searchParams.set('email', user.email);

        await sendPasswordResetLink(user, link.toString());
        return { success: true, message: 'Password reset email sent' };
    }

    static async sendOTP(user, medium, type) {
        if (medium === "email" || medium === "sms") {
            const result = await Auth.saveOTP(user, type, medium);
            return result;
        } else if (medium === "authenticator") {
            return {
                success: user.authenticator_enabled,
                status: user.authenticator_enabled ? 200 : 400,
                message: user.authenticator_enabled
                    ? "Please enter authenticator code to continue!"
                    : "Authenticator is not enabled",
                result: user,
                code: user.authenticator_enabled ? 2 : 3,
            };
        } else {
            return { success: false, message: "Invalid OTP medium", code: 1 };
        }
    };

    static async saveOTP(user, type, medium = "email") {
        if (medium === "sms") {
            throw new Error("SMS OTP delivery is not configured.");
        }
        if (medium !== "email") {
            throw new Error("Invalid OTP medium");
        }
        const { code, now } = await generateOTP();
        const otpExists = await select_by_keys("otp", {
            user_id: user.id,
            otp_type: type
        });

        let column;
        if (medium === "email") {
            column = "email";
        } else if (medium === "sms") {
            column = "phone";
        } else {
            throw new Error("Invalid OTP medium");
        }
        const identity = column === "email" ? user.email : user.phone;
        await redisClient.del(otpAttemptKey(identity, type));

        const currentOtp = {
            user_id: user.id,
            otp: code,
            [column]: user[column],
            otp_type: type,
            created_at: now
        };

        if (otpExists.rowCount === 0) {
            const insertQuery = `
                INSERT INTO otp (user_id, otp, ${column}, otp_type, created_at)
                VALUES ($1, $2, $3, $4, $5)
            `;
            await pool.query(insertQuery, Object.values(currentOtp));
        } else {
            const updateQuery = `
                UPDATE otp 
                SET otp = $1, ${column} = $2, created_at = $3 
                WHERE user_id = $4 AND otp_type = $5
            `;
            await pool.query(updateQuery, [code, user[column], now, user.id, type]);
        }

        // Handle delivery method
        if (medium === "email" && type === "login") {
            if (!(await sendLoginOTP(user, code))) {
                throw new Error("Unable to deliver login OTP email.");
            }
        } else if (medium === "sms") {
            throw new Error("SMS OTP delivery is not configured.");
        }

        return { success: true };
    }

    static async validateOTP(user, medium, type, otp) {
        if (medium === "email") {
            return await Auth.verifyEmailOTP(user.email, otp, type);
        } else if (medium === "authenticator") {
            return await Auth.verify2FA_OTP(user.email, otp);
        } else if (medium === "sms") {
            return await Auth.verifySMS_OTP(user.phone, otp, type);
        }
        return { success: false, message: "Invalid OTP medium" };
    };

    static async verifyEmailOTP(email, otp, otp_type, cleanup = true) {
        try {
            const { key: attemptKey, allowed } = await registerOtpAttempt(email, otp_type);
            if (!allowed) {
                return { success: false, message: 'Too many OTP attempts; request a new code.' };
            }
            const queryText = `SELECT otp, created_at FROM otp WHERE email = $1 AND otp_type = $2 LIMIT 1`;

            const result = await pool.query(queryText, [email, otp_type]);
            if (result.rowCount === 0) {
                return { success: false, message: 'OTP not found; resend!', code: 1 };
            }

            const { otp: storedOtp, created_at } = result.rows[0];
            const now = new Date();
            const createdAt = new Date(created_at);
            const timeDifference = (now - createdAt) / 1000;

            if (storedOtp !== otp) {
                return { success: false, message: 'Invalid OTP; Check inputed or Resend!' };
            }

            if (timeDifference > otpExpirationSeconds()) {
                return { success: false, message: 'OTP expired; Resend!' };
            }

            // Delete OTP
            await redisClient.del(attemptKey);
            if (cleanup === true) {
                const deleteQueryText = `DELETE FROM otp WHERE email = $1 AND otp_type = $2`;
                await pool.query(deleteQueryText, [email, otp_type]);
            }

            return { success: true, message: 'OTP verified', email };
        } catch (err) {
            console.error('Error during Email OTP verification:', err);
            throw new Error('Error during Email OTP verification: ' + (err?.message || err));
        }
    };

    static async verifySMS_OTP(phone, otp, otp_type) {
        const { key: attemptKey, allowed } = await registerOtpAttempt(phone, otp_type);
        if (!allowed) {
            return { success: false, message: 'Too many OTP attempts; request a new code.' };
        }
        const queryText = `SELECT otp, created_at FROM otp WHERE phone = $1 AND otp_type = $2 LIMIT 1`;
        try {
            const result = await pool.query(queryText, [phone, otp_type]);

            if (result.rowCount === 0) {
                return { success: false, message: 'OTP not found; Resend!' };
            }

            const { otp: storedOtp, created_at } = result.rows[0];
            const now = new Date();
            const createdAt = new Date(created_at);
            const timeDifference = (now - createdAt) / 1000;

            if (storedOtp !== otp) {
                return { success: false, message: 'Invalid OTP; Check inputed or Resend!' };
            }

            if (timeDifference > otpExpirationSeconds()) {
                return { success: false, message: 'OTP expired; Resend!' };
            }

            await redisClient.del(attemptKey);
            // Delete OTP
            const deleteQueryText = `DELETE FROM otp WHERE phone = $1 AND otp_type = $2`;
            await pool.query(deleteQueryText, [phone, otp_type]);

            return { success: true, message: 'OTP verified' };
        } catch (err) {
            console.error('Error during SMS OTP verification:', err);
            throw new Error(err?.message || err);
        }
    };

    static async verify2FA_OTP(email, otp) {
        try {
            const query = `SELECT * FROM users WHERE email = $1`;
            const result = await pool.query(query, [email]);
            if (result.rowCount === 0) {
                return { success: false, message: "User not found", code: 1 };
            }
            const user = result.rows[0];
            if (!user.authenticator_secret) {
                return {
                    success: false,
                    message: "Authenticator is not enabled for this user",
                    code: 2
                };
            }
            // Decode the stored Base32 secret
            const secret = OTPAuth.Secret.fromBase32(user.authenticator_secret);
            const totp = new OTPAuth.TOTP({
                issuer: "vpay.app",
                label: "VPAY",
                secret,
                algorithm: "SHA1",
                digits: 6,
                period: 30
            });
            const delta = totp.validate({ token: otp });
            if (delta === null) {
                return { success: false, message: "OTP is invalid or has expired", code: 2 };
            }
            return { success: true, message: "2FA OTP verified successfully!", code: 0 };
        } catch (error) {
            console.error("Error during 2FA OTP verification:", error);
            throw error;
        }
    }

    static async logout(session) {
        return new Promise((resolve, reject) => {
            const userId = session.user?.id;

            session.destroy(async (err) => {
                if (err) return reject(err);

                // Decrement session count — floor at 0
                if (userId) {
                    const count = parseInt(await redisClient.get(keys.sessionCount(userId)) || '0');
                    if (count > 0) await redisClient.decr(keys.sessionCount(userId));
                }

                resolve();
            });
        });
    };

}

export default Auth;