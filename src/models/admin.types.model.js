import pool from "#services/pg_pool.js";

class AdminType {
    static async fetchAdminTypes(filters = {}, offset = 0, limit = 20) {
        try {
            const values = [];
            const whereClauses = [`deleted_at IS NULL`];

            let index = 1;

            // Search filter
            if (filters.search?.trim()) {
                whereClauses.push(`
                (
                    admin_type ILIKE $${index}
                    OR description ILIKE $${index}
                )
            `);

                values.push(`%${filters.search.trim()}%`);
                index++;
            }

            // Status filter
            if (filters.status !== undefined && filters.status !== null) {
                whereClauses.push(`status = $${index++}`);
                values.push(filters.status);
            }

            // Date range filters
            if (filters.from_date) {
                whereClauses.push(`created_at >= $${index++}`);
                values.push(filters.from_date);
            }

            if (filters.to_date) {
                whereClauses.push(`created_at <= $${index++}`);
                values.push(filters.to_date);
            }

            // Main query
            const query = `
            SELECT *
            FROM admin_types
            WHERE ${whereClauses.join(" AND ")}
            ORDER BY created_at DESC
            LIMIT $${index++}
            OFFSET $${index}
        `;

            values.push(limit, offset);

            // Count query
            const countQuery = `
            SELECT COUNT(*)::INTEGER AS total
            FROM admin_types
            WHERE ${whereClauses.join(" AND ")}
        `;

            const [dataResult, countResult] = await Promise.all([
                pool.query(query, values),
                pool.query(
                    countQuery,
                    values.slice(0, values.length - 2)
                )
            ]);

            return {
                total: countResult.rows[0]?.total || 0,
                limit,
                offset,
                rows: dataResult.rows
            };
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