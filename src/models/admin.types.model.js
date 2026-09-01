import pool from "#services/pg_pool.js";

class AdminType {
    static async fetchAdminTypes({offset = 0, limit = 20}) {
        try {
            const query = `
                SELECT *
                FROM admin_types
                ORDER BY created_at DESC
                LIMIT $1
                OFFSET $2
            `;

            const result = await pool.query(query, [limit, offset]);

            return result;
        } catch (error) {
            console.error("Error fetching admin types:", error);
            throw error;
        }
    }

    static async getAdminTypesByIds(ids) {
        const { rows } = await pool.query(
            `SELECT * FROM admin_types 
            WHERE id = ANY($1::integer[])
            AND deleted_at IS NULL`,
            [ids]
        );
        console.log("Fetched admin types:", rows);
        return rows;
    }
}

export default AdminType;