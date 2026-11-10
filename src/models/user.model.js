import Notification from '#models/notification.model.js';
import pool from "#services/pg_pool.js";
import { passwordHash, ROLES } from "#utils/helpers.js";
import { select_column_by_key } from "./query.model.js";
import { config } from "dotenv";
import crypto from 'node:crypto';

config();

const TABLE_NAME = "users";

const isGoogleAccountEligible = async (client, user) => {
    if (
        !user ||
        ![ROLES.CUSTOMER, ROLES.VENDOR].includes(user.role) ||
        user.status !== 'active'
    ) {
        return false;
    }
    if (user.role === ROLES.VENDOR) {
        const { rowCount } = await client.query(
            "SELECT 1 FROM vendors WHERE user_id = $1 AND status = 'active' LIMIT 1",
            [user.id]
        );
        return rowCount > 0;
    }
    return true;
};

export class UserModel {
    static async emailExists(email) {
        const data = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
        if (data.rowCount === 0) {
            return false;
        } else {
            return true;
        }
    };

    static async getUserByEmail(email) {
        const queryText = `SELECT * FROM users WHERE email = $1 LIMIT 1`;
        const queryValues = [email];
        const queryResult = await pool.query(queryText, queryValues);
        return queryResult.rows[0] ?? null;
    };

    static async getUserByPhone(phone) {
        const queryText = `SELECT * FROM users WHERE phone = $1 LIMIT 1`;
        const queryValues = [phone];
        const queryResult = await pool.query(queryText, queryValues);
        return queryResult.rows[0] ?? null;
    };

    static async getUserById(id) {
        const queryResult = await select_column_by_key("users", "*", "id", id);
        const user = queryResult.rows[0] ? queryResult.rows[0] : null;
        if (user) {
            return user;
        } else {
            return null;
        }
    };

    static async authenticateGoogleAccount({ googleId, email, firstname, lastname }) {
        const normalizedEmail = String(email ?? '').trim().toLowerCase();
        const normalizedGoogleId = String(googleId ?? '').trim();
        if (!normalizedEmail || !normalizedGoogleId) return null;

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            let user = (await client.query(
                'SELECT * FROM users WHERE google_id = $1 FOR UPDATE',
                [normalizedGoogleId]
            )).rows[0] ?? null;

            if (!user) {
                const emailMatches = (await client.query(
                    'SELECT * FROM users WHERE LOWER(email) = $1 ORDER BY id FOR UPDATE',
                    [normalizedEmail]
                )).rows;

                // Ambiguous legacy accounts must be resolved before allowing
                // Google to choose one based on a non-unique case-insensitive email.
                if (emailMatches.length > 1) {
                    await client.query('ROLLBACK');
                    return null;
                }
                user = emailMatches[0] ?? null;
            }

            if (user) {
                if (
                    !(await isGoogleAccountEligible(client, user)) ||
                    (user.google_id && user.google_id !== normalizedGoogleId)
                ) {
                    await client.query('ROLLBACK');
                    return null;
                }

                const needsLink = !user.google_id;
                const needsVerificationUpdate = !user.email_verified || !user.email_verified_at;
                if (needsLink || needsVerificationUpdate) {
                    const { rows } = await client.query(
                        `UPDATE users
                         SET google_id = COALESCE(google_id, $1),
                             email_verified = true,
                             email_verified_at = COALESCE(email_verified_at, NOW()),
                             email_verification_token = NULL,
                             auth_version = auth_version + 1,
                             updated_at = NOW()
                         WHERE id = $2
                           AND (google_id IS NULL OR google_id = $1)
                         RETURNING *`,
                        [normalizedGoogleId, user.id]
                    );
                    user = rows[0] ?? null;
                    if (!user) {
                        await client.query('ROLLBACK');
                        return null;
                    }
                }
            } else {
                const randomPassword = crypto.randomBytes(32).toString('hex');
                const hashedPassword = await passwordHash(randomPassword);
                const { rows } = await client.query(
                    `INSERT INTO users
                        (email, firstname, lastname, google_id, email_verified,
                         email_verified_at, email_verification_token, password, role, status)
                     VALUES ($1, $2, $3, $4, true, NOW(), NULL, $5, 'customer', 'active')
                     ON CONFLICT DO NOTHING
                     RETURNING *`,
                    [normalizedEmail, firstname ?? null, lastname ?? null, normalizedGoogleId, hashedPassword]
                );
                user = rows[0] ?? null;

                if (!user) {
                    // Another callback may have inserted this subject/email
                    // while this transaction was waiting on a unique index.
                    const conflicts = (await client.query(
                        `SELECT * FROM users
                         WHERE google_id = $1 OR LOWER(email) = $2
                         ORDER BY id FOR UPDATE`,
                        [normalizedGoogleId, normalizedEmail]
                    )).rows;
                    const identityMatch = conflicts.find((candidate) => candidate.google_id === normalizedGoogleId);
                    const emailMatch = conflicts.find((candidate) => candidate.email.toLowerCase() === normalizedEmail);
                    user = identityMatch ?? emailMatch ?? null;
                    if (
                        !(await isGoogleAccountEligible(client, user)) ||
                        (user.google_id && user.google_id !== normalizedGoogleId)
                    ) {
                        await client.query('ROLLBACK');
                        return null;
                    }
                    if (!user.google_id) {
                        const { rows: linkedRows } = await client.query(
                            `UPDATE users
                             SET google_id = $1, email_verified = true,
                                 email_verified_at = COALESCE(email_verified_at, NOW()),
                                 email_verification_token = NULL,
                                 auth_version = auth_version + 1, updated_at = NOW()
                             WHERE id = $2 AND google_id IS NULL
                             RETURNING *`,
                            [normalizedGoogleId, user.id]
                        );
                        user = linkedRows[0] ?? null;
                        if (!user) {
                            await client.query('ROLLBACK');
                            return null;
                        }
                    }
                } else {
                    await Notification.createNotification(
                        user.id,
                        'account',
                        'Welcome to Tetyhub',
                        'Your account has been created with Google.',
                        null,
                        client
                    );
                }
            }

            if (
                !user ||
                ![ROLES.CUSTOMER, ROLES.VENDOR].includes(user.role) ||
                user.status !== 'active' ||
                user.email_verified !== true
            ) {
                await client.query('ROLLBACK');
                return null;
            }

            await client.query('COMMIT');
            return user;
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    static async phoneExists(phone) {
        try {
            const queryResult = await select_column_by_key(TABLE_NAME, "*", "phone", phone);
            return queryResult.rowCount > 0;
        } catch (error) {
            console.error(error);
            throw new Error("Error fetching phone");
        }
    }

    static async createUser(data) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            if (![ROLES.CUSTOMER, ROLES.VENDOR].includes(data.role)) {
                throw new Error('Privileged users must be created through the admin invitation flow.');
            }

            const allowedFields = new Set([
                'firstname',
                'lastname',
                'email',
                'password',
                'phone',
                'country_id',
                'role',
                'google_id',
            ]);
            const requestEntries = Object.entries(data);
            if (requestEntries.some(([key]) => !allowedFields.has(key))) {
                throw new Error('Unsupported user field.');
            }

            const requestBodyKeys = requestEntries.map(([key]) => key);
            const requestBodyValues = requestEntries.map(([, value]) => value);

            const insertUserQuery = `
            INSERT INTO users (${requestBodyKeys.join(', ')})
            VALUES (${requestBodyValues.map((_, i) => `$${i + 1}`).join(', ')})
            RETURNING *
        `;

            const userResult = await client.query(insertUserQuery, requestBodyValues);
            if (userResult.rowCount === 0) throw new Error('Error while creating user.');

            const user = userResult.rows[0];
            
            if (data.role === ROLES.VENDOR) {
                const insertVendorQuery = `
                INSERT INTO vendors (user_id)
                VALUES ($1)
                RETURNING *
            `;

                const vendorResult = await client.query(insertVendorQuery, [user.id]);
                if (vendorResult.rowCount === 0) throw new Error('Error while creating vendor profile.');

                user.vendor = vendorResult.rows[0];
            }

            await Notification.createNotification(user.id, 'account', 'Welcome to Tetyhub', 'Your account has been created. Complete email verification to get started.', null, client);
            await client.query('COMMIT');

            const { password, ...safeUser } = user;
            return safeUser;

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async getCurrencyById(currencyId) {
        const query = `
            SELECT *
            FROM currencies
            WHERE id = $1
        `;
        const { rows } = await pool.query(query, [countryId]);
        return rows[0] ?? null;
    }

}

export default UserModel;
