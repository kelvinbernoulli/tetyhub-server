import pool from "#services/pg_pool.js";
import { ROLES } from "#utils/helpers.js";

class CustomerModel {
    static async getCustomerByEmail(email, vendor_id) {
        const { rows } = await pool.query(
            `SELECT u.*
            FROM users u
            WHERE u.email = $1 AND u.vendor_id = $2 AND u.role = $3
            LIMIT 1`,
            [email, vendor_id, ROLES.CUSTOMER]
        );
        return rows[0] ?? null;
    }

    static async getCustomerByPhone(phone, vendor_id) {
        const { rows } = await pool.query(
            `SELECT u.*
            FROM users u
            WHERE u.phone = $1 AND u.vendor_id = $2 AND u.role = $3
            LIMIT 1`,
            [phone, vendor_id, ROLES.CUSTOMER]
        );
        return rows[0] ?? null;
    }

    static async getCustomerById(user_id, vendor_id) {
        const { rows } = await pool.query(
            `SELECT u.*
            FROM users u
            WHERE u.id = $1 AND u.vendor_id = $2 AND u.role = $3
            LIMIT 1`,
            [user_id, vendor_id, ROLES.CUSTOMER]
        );
        return rows[0] ?? null;
    }

    static async createCustomer({ vendor_id, email, password, firstname, lastname, phone }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // User may already exist globally (same person, different vendor)
            const { rows: existing } = await client.query(
                `SELECT id FROM users WHERE email = $1 AND role = ${ROLES.CUSTOMER} LIMIT 1`,
                [email]
            );

            let user_id;
            if (existing[0]) {
                user_id = existing[0].id;
            } else {
                const { rows: userRows } = await client.query(
                    `INSERT INTO users (email, password, firstname, lastname, phone, role)
                    VALUES ($1, $2, $3, $4, $5, ${ROLES.CUSTOMER})
                    RETURNING id`,
                    [email, password, firstname, lastname, phone ?? null]
                );
                user_id = userRows[0].id;
            }

            await client.query('COMMIT');

            const { rows } = await client.query(
                `SELECT u.id, u.email, u.firstname, u.lastname,
                u.role, u.status, u.email_verified, vc.vendor_id
                FROM users u
                INNER JOIN vendor_customers vc ON vc.user_id = u.id
                WHERE u.id = $1 AND vc.vendor_id = $2`,
                [user_id, vendor_id]
            );
            return rows[0];
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async getProfile(userId) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    u.id, u.firstname, u.lastname, u.email,
                    u.phone, u.role, u.status,
                    ui.avatar, ui.gender, ui.date_of_birth,
                    ui.city, ui.state, ui.country_id,
                    u.created_at,
                    json_agg(DISTINCT jsonb_build_object(
                        'id', ua.id,
                        'firstname', ua.firstname,
                        'lastname', ua.lastname,
                        'phone', ua.phone,
                        'address', ua.address,
                        'city', ua.city,
                        'state', ua.state,
                        'country', ua.country,
                        'zip_code', ua.zip_code,
                        'is_default', ua.is_default
                    )) FILTER (WHERE ua.id IS NOT NULL) AS addresses
                FROM users u
                LEFT JOIN users_info ui ON ui.user_id = u.id
                LEFT JOIN user_addresses ua ON ua.user_id = u.id
                WHERE u.id = $1 AND u.deleted_at IS NULL
                GROUP BY u.id, ui.id`,
                [userId]
            );

            return rows[0] ?? null;
        } catch (error) {
            console.error("Error fetching profile:", error);
            throw error;
        }
    }

    static async updateProfile(userId, data) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { firstname, lastname, phone, gender, date_of_birth, avatar } = data;

            // Upload avatar to S3 if provided
            const avatarUrl = avatar
                ? await uploadBase64ToS3(avatar, 'avatars')
                : null;

            // Update users table
            if (firstname || lastname || phone) {
                await client.query(
                    `UPDATE users SET
                        firstname   = COALESCE($1, firstname),
                        lastname    = COALESCE($2, lastname),
                        phone       = COALESCE($3, phone),
                        updated_at  = NOW()
                    WHERE id = $4 AND deleted_at IS NULL`,
                    [firstname ?? null, lastname ?? null, phone ?? null, userId]
                );
            }

            // Upsert users_info table
            await client.query(
                `INSERT INTO users_info (user_id, avatar, gender, date_of_birth)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (user_id) DO UPDATE SET
                    avatar          = COALESCE(EXCLUDED.avatar, users_info.avatar),
                    gender          = COALESCE(EXCLUDED.gender, users_info.gender),
                    date_of_birth   = COALESCE(EXCLUDED.date_of_birth, users_info.date_of_birth),
                    updated_at      = NOW()`,
                [userId, avatarUrl, gender ?? null, date_of_birth ?? null]
            );

            await client.query('COMMIT');

            return await CustomerModel.getProfile(userId);
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error updating profile:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async addAddress(userId, vendorId, data) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { firstname, lastname, phone, address, city, state, country, zip_code, is_default } = data;

            // If new address is default unset others
            if (is_default) {
                await client.query(
                    `UPDATE user_addresses SET is_default = false WHERE user_id = $1 AND vendor_id = $2`,
                    [userId, vendorId]
                );
            }

            // Check if this is first address — auto set as default
            const { rows: existing } = await client.query(
                `SELECT id FROM user_addresses WHERE user_id = $1 AND vendor_id = $2`,
                [userId, vendorId]
            );

            // Max 2 addresses per user per vendor
            if (existing.length >= 2) {
                return { error: 'Maximum of 2 addresses allowed', code: 422 };
            }

            const setDefault = is_default || existing.length === 0;

            const { rows } = await client.query(
                `INSERT INTO user_addresses
                (user_id, vendor_id, firstname, lastname, phone, address, city, state, country, zip_code, is_default)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                RETURNING *`,
                [userId, vendorId, firstname, lastname, phone, address, city, state, country, zip_code ?? null, setDefault]
            );

            await client.query('COMMIT');
            return rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error adding address:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async updateAddress(userId, vendorId, addressId, data) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verify address belongs to user
            const { rows: existing } = await client.query(
                `SELECT id FROM user_addresses WHERE id = $1 AND user_id = $2 AND vendor_id = $3`,
                [addressId, userId, vendorId]
            );

            if (existing.length === 0) {
                return { error: 'Address not found', code: 404 };
            }

            // If updating to default unset others
            if (data.is_default) {
                await client.query(
                    `UPDATE user_addresses SET is_default = false WHERE user_id = $1 AND vendor_id = $2`,
                    [userId, vendorId]
                );
            }

            const { rows } = await client.query(
                `UPDATE user_addresses SET
                    firstname   = COALESCE($1, firstname),
                    lastname    = COALESCE($2, lastname),
                    phone       = COALESCE($3, phone),
                    address     = COALESCE($4, address),
                    city        = COALESCE($5, city),
                    state       = COALESCE($6, state),
                    country     = COALESCE($7, country),
                    zip_code    = COALESCE($8, zip_code),
                    is_default  = COALESCE($9, is_default),
                    updated_at  = NOW()
                WHERE id = $10 AND user_id = $11 AND vendor_id = $12
                RETURNING *`,
                [
                    data.firstname ?? null, data.lastname ?? null,
                    data.phone ?? null, data.address ?? null,
                    data.city ?? null, data.state ?? null,
                    data.country ?? null, data.zip_code ?? null,
                    data.is_default ?? null,
                    addressId, userId, vendorId
                ]
            );

            await client.query('COMMIT');
            return rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error updating address:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async deleteAddress(userId, vendorId, addressId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verify address belongs to user
            const { rows: existing } = await client.query(
                `SELECT * FROM user_addresses WHERE id = $1 AND user_id = $2 AND vendor_id = $3`,
                [addressId, userId, vendorId]
            );

            if (existing.length === 0) {
                return { error: 'Address not found', code: 404 };
            }

            const address = existing[0];

            await client.query(
                `DELETE FROM user_addresses WHERE id = $1 AND user_id = $2 AND vendor_id = $3`,
                [addressId, userId, vendorId]
            );

            // If deleted address was default set another as default
            if (address.is_default) {
                await client.query(
                    `UPDATE user_addresses SET is_default = true
                    WHERE user_id = $1 AND vendor_id = $2 AND id != $3
                    ORDER BY created_at DESC
                    LIMIT 1`,
                    [userId, vendorId, addressId]
                );
            }

            await client.query('COMMIT');
            return { success: true };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error deleting address:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async getAddresses(userId, vendorId) {
        try {
            const { rows } = await pool.query(
                `SELECT * FROM user_addresses
                WHERE user_id = $1 AND vendor_id = $2
                ORDER BY is_default DESC, created_at DESC`,
                [userId, vendorId]
            );
            return rows;
        } catch (error) {
            console.error("Error fetching addresses:", error);
            throw error;
        }
    }

    static async setDefaultAddress(userId, vendorId, addressId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verify address belongs to user
            const { rows: existing } = await client.query(
                `SELECT id FROM user_addresses WHERE id = $1 AND user_id = $2 AND vendor_id = $3`,
                [addressId, userId, vendorId]
            );

            if (existing.length === 0) {
                return { error: 'Address not found', code: 404 };
            }

            // Unset all defaults
            await client.query(
                `UPDATE user_addresses SET is_default = false WHERE user_id = $1 AND vendor_id = $2`,
                [userId, vendorId]
            );

            // Set new default
            const { rows } = await client.query(
                `UPDATE user_addresses SET is_default = true
                WHERE id = $1 AND user_id = $2 AND vendor_id = $3
                RETURNING *`,
                [addressId, userId, vendorId]
            );

            await client.query('COMMIT');
            return rows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error setting default address:", error);
            throw error;
        } finally {
            client.release();
        }
    }
};

export default CustomerModel;