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
