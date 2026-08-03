import pool from "#services/pg_pool.js";
import { ROLES } from "#utils/helpers.js";
import { select_column_by_key } from "./query.model.js";
import { config } from "dotenv";

config();

const TABLE_NAME = "users";

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

    static async phoneExists(phone) {
        try {
            const queryResult = await select_column_by_key(TABLE_NAME, "*", "phone", phone);
            return queryResult.rowCount > 0;
        } catch (error) {
            console.error(error);
            throw new Error("Error fetching phone");
        }
    }

    static async assignAdminPermissions(adminId, adminRoles, permissions) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            await client.query(
                `UPDATE users 
                SET admin_role = $1::integer[], updated_at = NOW()
                WHERE id = $2 AND deleted_at IS NULL`,
                [adminRoles, adminId]
            );

            for (const [adminTypeId, perms] of Object.entries(permissions)) {
                console.log("Inserting permission for adminTypeId:", parseInt(adminTypeId), "perms:", perms);
                const result = await client.query(
                    `INSERT INTO admin_permissions (admin_id, admin_type_id, can_create, can_read, can_update, can_delete)
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (admin_id, admin_type_id)
                    DO UPDATE SET
                        can_create  = EXCLUDED.can_create,
                        can_read    = EXCLUDED.can_read,
                        can_update  = EXCLUDED.can_update,
                        can_delete  = EXCLUDED.can_delete,
                        updated_at  = NOW()`,
                    [
                        adminId,
                        parseInt(adminTypeId),
                        perms.can_create ?? false,
                        perms.can_read ?? false,
                        perms.can_update ?? false,
                        perms.can_delete ?? false
                    ]
                );
                console.log("Permission upsert result:", result.rows[0]);
            }

            await client.query('COMMIT');

            const { rows } = await client.query(
                `SELECT u.id, u.firstname, u.lastname, u.email, u.role, u.admin_role, u.status,
            json_agg(json_build_object(
                'admin_type_id', ap.admin_type_id,
                'admin_type_name', at.admin_type,
                'admin_type_status', at.status,
                'can_create', ap.can_create,
                'can_read', ap.can_read,
                'can_update', ap.can_update,
                'can_delete', ap.can_delete
            )) FILTER (WHERE ap.id IS NOT NULL) AS permissions
            FROM users u
            LEFT JOIN admin_permissions ap ON ap.admin_id = u.id
            LEFT JOIN admin_types at ON at.id = ap.admin_type_id
            WHERE u.id = $1
            GROUP BY u.id`,
                [adminId]
            );

            return rows[0] ?? null;
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async createUser(data, vendorId = null) {
        console.log("Creating user with data:", data, "and vendorId:", vendorId);
        const client = await pool.connect();

        try {
            await client.query('BEGIN');

            const requestBodyKeys = Object.keys(data);
            const requestBodyValues = Object.values(data);

            const insertUserQuery = `
                INSERT INTO users (${requestBodyKeys.join(', ')})
                VALUES (${requestBodyValues.map((_, i) => `$${i + 1}`).join(', ')})
                RETURNING *
            `;

            const userResult = await client.query(insertUserQuery, requestBodyValues);
            if (userResult.rowCount === 0) throw new Error('Error while creating user.');

            const user = userResult.rows[0];
            const userId = user.id;

            if (data.role === ROLES.ADMIN) {
                await client.query(
                    `INSERT INTO admins (user_id) VALUES ($1)`,
                    [userId]
                );
                // await 

            }

            await client.query('COMMIT');

            const { password_hash, ...safeUser } = user;
            return safeUser;

        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async updateAdmin(id, data) {
        const setClauses = [];
        const values = [];
        let i = 1;
        for (const [key, value] of Object.entries(data)) {
            setClauses.push(`${key} = $${i}`);
            values.push(value);
            i++;
        }
        values.push(id);

        const query = `
            UPDATE users
            SET ${setClauses.join(', ')}
            WHERE id = $${i} AND vendor_id IS NULL AND deleted_at IS NULL
            RETURNING *
        `;
        const result = await pool.query(query, values);
        return result.rows[0] ?? null;

    }

    static async fetchAdminPermissions(adminId, vendorId = null) {
        try {
            const query = `
            SELECT 
                u.id AS admin_id,
                u.firstname,
                u.lastname,
                u.email,
                u.role,
                u.admin_role,
                u.status,
                json_agg(
                    json_build_object(
                        'admin_type_id', ap.admin_type_id,
                        'admin_type_name', at.name,
                        'can_create', ap.can_create,
                        'can_read', ap.can_read,
                        'can_update', ap.can_update,
                        'can_delete', ap.can_delete,
                        'status', ap.status
                    )
                ) FILTER (WHERE ap.id IS NOT NULL) AS permissions
            FROM users u
            LEFT JOIN admin_permissions ap ON ap.admin_id = u.id
            LEFT JOIN admin_types at ON at.id = ap.admin_type_id
            LEFT JOIN users_info ui ON ui.user_id = u.id
            WHERE u.id = $1
            AND u.deleted_at IS NULL
            AND ($2::integer IS NULL OR ui.vendor_id = $2)
            GROUP BY u.id
        `;

            const { rows } = await pool.query(query, [adminId, vendorId]);
            return rows[0] ?? null;
        } catch (error) {
            console.error("Error fetching admin permissions:", error);
            throw error;
        }
    }

    static async getCurrencyById (currencyId) {
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