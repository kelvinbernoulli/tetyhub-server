import pool from "#services/pg_pool.js";
import { ROLES } from "#utils/helpers.js";

class CustomerModel {
    static async getProfile(userId) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    u.id, u.firstname, u.lastname, u.email,
                    u.phone, u.role, u.status,
                    ui.avatar, ui.gender, ui.dob,
                    ui.city, ui.state, ui.country,
                    u.created_at,
                    json_agg(DISTINCT jsonb_build_object(
                        'id', sa.id,
                        'firstname', sa.firstname,
                        'lastname', sa.lastname,
                        'phone_one', sa.phone_one,
                        'phone_two', sa.phone_two,
                        'address', sa.address,
                        'city', sa.city,
                        'state', sa.state,
                        'country', sa.country,
                        'zip_code', sa.zip_code,
                        'is_default', sa.is_default
                    )) FILTER (WHERE sa.id IS NOT NULL) AS addresses
                FROM users u
                LEFT JOIN users_info ui ON ui.user_id = u.id
                LEFT JOIN shipping_addresses sa ON sa.user_id = u.id
                WHERE u.id = $1
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

            const { firstname, lastname, phone, gender, dob, avatar } = data;

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
                    WHERE id = $4`,
                    [firstname ?? null, lastname ?? null, phone ?? null, userId]
                );
            }

            // Upsert users_info table
            await client.query(
                `INSERT INTO users_info (user_id, avatar, gender, dob)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (user_id) DO UPDATE SET
                    avatar          = COALESCE(EXCLUDED.avatar, users_info.avatar),
                    gender          = COALESCE(EXCLUDED.gender, users_info.gender),
                    dob   = COALESCE(EXCLUDED.dob, users_info.dob),
                    updated_at      = NOW()`,
                [userId, avatarUrl, gender ?? null, dob ?? null]
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

    static async addAddress(userId, data) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { firstname, lastname, phone_one, phone_two, address, city, state, country_id, country, zip_code, is_default } = data;

            // If new address is default unset others
            if (is_default) {
                await client.query(
                    `UPDATE shipping_addresses SET is_default = false WHERE user_id = $1`,
                    [userId]
                );
            }

            // Check if this is first address — auto set as default
            const { rows: existing } = await client.query(
                `SELECT id FROM shipping_addresses WHERE user_id = $1`,
                [userId]
            );

            // Max 5 addresses per user
            if (existing.length >= 5) {
                return { error: 'Maximum of 5 addresses allowed', code: 422 };
            }

            const setDefault = is_default || existing.length === 0;

            const { rows } = await client.query(
                `INSERT INTO shipping_addresses
                (user_id, firstname, lastname, phone_one, phone_two, address, city, state, country_id, country, zip_code, is_default)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                RETURNING *`,
                [userId, firstname, lastname, phone_one, phone_two, address, city, state, country_id, country, zip_code ?? null, setDefault]
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

    static async updateAddress(userId, addressId, data) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verify address belongs to user
            const { rows: existing } = await client.query(
                `SELECT id FROM shipping_addresses WHERE id = $1 AND user_id = $2`,
                [addressId, userId]
            );

            if (existing.length === 0) {
                return { error: 'Address not found', code: 404 };
            }

            // If updating to default unset others
            if (data.is_default) {
                await client.query(
                    `UPDATE shipping_addresses SET is_default = false WHERE user_id = $1`,
                    [userId]
                );
            }

            const { rows } = await client.query(
                `UPDATE shipping_addresses SET
                firstname   = COALESCE($1, firstname),
                lastname    = COALESCE($2, lastname),
                phone_one   = COALESCE($3, phone_one),
                phone_two   = COALESCE($4, phone_two),
                address     = COALESCE($5, address),
                city        = COALESCE($6, city),
                state       = COALESCE($7, state),
                country_id  = COALESCE($8, country_id),
                country     = COALESCE($9, country),
                zip_code    = COALESCE($10, zip_code),
                is_default  = COALESCE($11, is_default),
                updated_at  = NOW()
            WHERE id = $12
            AND user_id = $13
            RETURNING *`,
                [
                    data.firstname ?? null,       // $1
                    data.lastname ?? null,        // $2
                    data.phone ?? null,           // $3
                    data.phone_two ?? null,       // $4
                    data.address ?? null,         // $5
                    data.city ?? null,            // $6
                    data.state ?? null,           // $7
                    data.country_id ?? null,      // $8
                    data.country ?? null,         // $9
                    data.zip_code ?? null,        // $10
                    data.is_default ?? null,      // $11
                    addressId,                    // $12
                    userId                        // $13
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

    static async deleteAddress(userId, addressId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verify address belongs to user
            const { rows: existing } = await client.query(
                `SELECT * FROM shipping_addresses WHERE id = $1 AND user_id = $2`,
                [addressId, userId]
            );

            if (existing.length === 0) {
                return { error: 'Address not found', code: 404 };
            }

            const address = existing[0];

            await client.query(
                `DELETE FROM shipping_addresses WHERE id = $1 AND user_id = $2`,
                [addressId, userId]
            );

            // If deleted address was default set another as default
            if (address.is_default) {
                await client.query(
                    `UPDATE shipping_addresses SET is_default = true
                    WHERE user_id = $1 AND id != $2
                    ORDER BY created_at DESC
                    LIMIT 1`,
                    [userId, addressId]
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

    static async getAddresses(userId) {
        try {
            const { rows } = await pool.query(
                `SELECT * FROM shipping_addresses
                WHERE user_id = $1
                ORDER BY is_default DESC, created_at DESC`,
                [userId]
            );
            return rows;
        } catch (error) {
            console.error("Error fetching addresses:", error);
            throw error;
        }
    }

    static async setDefaultAddress(userId, addressId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // Verify address belongs to user
            const { rows: existing } = await client.query(
                `SELECT id FROM shipping_addresses WHERE id = $1 AND user_id = $2`,
                [addressId, userId]
            );

            if (existing.length === 0) {
                return { error: 'Address not found', code: 404 };
            }

            // Unset all defaults
            await client.query(
                `UPDATE shipping_addresses SET is_default = false WHERE user_id = $1`,
                [userId]
            );

            // Set new default
            const { rows } = await client.query(
                `UPDATE shipping_addresses SET is_default = true
                WHERE id = $1 AND user_id = $2
                RETURNING *`,
                [addressId, userId]
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