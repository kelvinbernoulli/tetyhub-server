import pool from "#services/pg_pool.js";

class AdminType {
    static async duplicateType(name, vendorId = null) {
        const { rows } = await pool.query(
            `SELECT * FROM admin_types WHERE admin_type = $1 AND ($2::int IS NULL OR vendor_id = $2) AND deleted_at IS NULL`,
            [name, vendorId]
        );
        return rows[0] ?? null;
    }

    static async deleteType(id, vendorId = null) {
        const { rows } = await pool.query(
            `UPDATE admin_types SET deleted_at = NOW() WHERE id = $1 AND ($2::int IS NULL OR vendor_id = $2) AND deleted_at IS NULL RETURNING *`,
            [id, vendorId]
        );
        return rows[0] ?? null;
    }

    static async fetchAdminTypes(vendorId = null, filters = {}, offset = 0, limit = 20) {
        try {
            const values = [];
            const whereClauses = [`deleted_at IS NULL`];

            let index = 1;

            // Vendor filter
            if (vendorId) {
                whereClauses.push(`vendor_id = $${index++}`);
                values.push(vendorId);
            }

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

    static async getAdminTypesByIds(ids, vendorId = null) {
        console.log("Fetching admin types with IDs:", ids, "for vendorId:", vendorId);
        const { rows } = await pool.query(
            `SELECT * FROM admin_types 
            WHERE id = ANY($1::integer[])
            AND deleted_at IS NULL
            AND (
                $2::integer IS NULL
                OR vendor_id = $2
                OR vendor_id IS NULL
            )`,
            [ids, vendorId]
        );
        console.log("Fetched admin types:", rows);
        return rows;
    }
}

export default AdminType;