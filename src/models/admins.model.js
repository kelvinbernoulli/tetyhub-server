import pool from "#services/pg_pool.js";
import { ROLES } from "#utils/helpers.js";
import { query } from "express-validator";

export class AdminModel {
    static async fetchAdmins(vendorId, offset = 0, limit = 40, filters = {}) {
        try {
            const values = [ROLES.ADMIN, ROLES.VENDOR_ADMIN];

            const whereClauses = [
                `u.role IN ($1, $2)`,
                `u.deleted_at IS NULL`
            ];

            let index = values.length + 1;

            if (vendorId) {
                whereClauses.push(`u.vendor_id = $${index++}`);
                values.push(vendorId);
            }

            if (filters.search?.trim()) {
                whereClauses.push(`(
                u.firstname ILIKE $${index}
                OR u.lastname ILIKE $${index}
                OR u.email ILIKE $${index}
                OR u.phone ILIKE $${index}
            )`);
                values.push(`%${filters.search.trim()}%`);
                index++;
            }

            if (filters.status !== undefined) {
                whereClauses.push(`u.status = $${index++}`);
                values.push(filters.status);
            }

            const safeLimit = Math.min(Math.max(Number(limit) || 40, 1), 100);
            const safeOffset = Math.max(Number(offset) || 0, 0);

            const whereSQL = whereClauses.join(' AND ');

            const query = `
            SELECT
                u.id,
                u.firstname,
                u.lastname,
                u.email,
                u.phone,
                u.country_id,
                u.role,
                u.status,
                u.admin_role,
                u.vendor_id,
                u.created_at,
                a.id AS admin_id,

                COALESCE(
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'admin_type_id',      at.id,
                            'admin_type',         at.admin_type,
                            'can_create',         ap.can_create,
                            'can_read',           ap.can_read,
                            'can_update',         ap.can_update,
                            'can_delete',         ap.can_delete,
                            'permission_status',  ap.status
                        )
                    ) FILTER (WHERE at.id IS NOT NULL),
                    '[]'::json
                ) AS permissions

            FROM users u
            JOIN admins a ON a.user_id = u.id

            LEFT JOIN LATERAL (
                SELECT UNNEST(u.admin_role) AS admin_type_id
            ) ar ON true

            LEFT JOIN admin_types at
                ON at.id = ar.admin_type_id

            LEFT JOIN admin_permissions ap
                ON ap.admin_type_id = at.id

            WHERE ${whereSQL}

            GROUP BY
                u.id, u.firstname, u.lastname, u.email,
                u.phone, u.country_id, u.role, u.status,
                u.admin_role, u.vendor_id, u.created_at,
                a.id

            ORDER BY u.created_at DESC
            LIMIT $${index++}
            OFFSET $${index++}
        `;

            values.push(safeLimit, safeOffset);

            const countQuery = `
            SELECT COUNT(DISTINCT u.id)::INTEGER AS total
            FROM users u
            JOIN admins a ON a.user_id = u.id
            WHERE ${whereSQL}
        `;

            const [adminsResult, countResult] = await Promise.all([
                pool.query(query, values),
                pool.query(countQuery, values.slice(0, -2))
            ]);

            return {
                total: countResult.rows[0]?.total || 0,
                limit: safeLimit,
                offset: safeOffset,
                rows: adminsResult.rows
            };

        } catch (error) {
            console.error('Error fetching admins:', error);
            throw error;
        }
    }

    // More explicit vendor validation
    static async fetchAdminById(adminId, vendorId = null) {
    try {
        if (!adminId) {
            throw new Error("Admin ID is required");
        }

        const values = [ROLES.ADMIN, ROLES.VENDOR_ADMIN, adminId];

        const whereClauses = [
            `u.role IN ($1, $2)`,
            `u.deleted_at IS NULL`,
            `a.id = $3`
        ];

        let index = values.length + 1;

        if (vendorId) {
            whereClauses.push(`u.vendor_id = $${index++}`);
            values.push(vendorId);
        }

        const whereSQL = whereClauses.join(' AND ');

        const query = `
            SELECT
                u.id,
                u.firstname,
                u.lastname,
                u.email,
                u.phone,
                u.country_id,
                u.role,
                u.status,
                u.admin_role,
                u.vendor_id,
                u.created_at,
                a.id AS admin_id,

                COALESCE(
                    JSON_AGG(
                        JSON_BUILD_OBJECT(
                            'admin_type_id',      at.id,
                            'admin_type',         at.admin_type,
                            'can_create',         ap.can_create,
                            'can_read',           ap.can_read,
                            'can_update',         ap.can_update,
                            'can_delete',         ap.can_delete,
                            'permission_status',  ap.status
                        )
                    ) FILTER (WHERE at.id IS NOT NULL),
                    '[]'::json
                ) AS permissions

            FROM users u
            JOIN admins a ON a.user_id = u.id

            LEFT JOIN LATERAL (
                SELECT UNNEST(u.admin_role) AS admin_type_id
            ) ar ON true

            LEFT JOIN admin_types at
                ON at.id = ar.admin_type_id

            LEFT JOIN admin_permissions ap
                ON ap.admin_type_id = at.id

            WHERE ${whereSQL}

            GROUP BY
                u.id, u.firstname, u.lastname, u.email,
                u.phone, u.country_id, u.role, u.status,
                u.admin_role, u.vendor_id, u.created_at,
                a.id

            ORDER BY u.created_at DESC
            LIMIT 1
        `;

        const { rows } = await pool.query(query, values);

        if (!rows.length) return null;

        return rows[0];

    } catch (error) {
        console.error("Error fetching admin by ID:", error);
        throw error;
    }
}

    static async deleteAdmin(adminId, vendorId) {
        try {
            if (!adminId) {
                throw new Error("Admin ID is required");
            }

            const adminQuery = `
            SELECT u.* FROM users u
            WHERE u.id = $1
            AND u.role IN ($2, $3, $4)
            AND u.deleted_at IS NULL
        `;

            const { rows } = await pool.query(adminQuery, [
                adminId,
                ROLES.SUPER_ADMIN,
                ROLES.ADMIN,
                ROLES.VENDOR_ADMIN
            ]);

            if (rows.length === 0) {
                return null;
            }

            const admin = rows[0];

            // If vendorId provided, validate vendor membership
            if (vendorId) {
                const { rows: memberRows } = await pool.query(
                    `SELECT id FROM vendor_members WHERE user_id = $1 AND vendor_id = $2`,
                    [adminId, vendorId]
                );
                if (memberRows.length === 0) {
                    console.warn(`Unauthorized delete attempt on admin ${adminId}`);
                    return null;
                }
            }

            const { rows: deleted } = await pool.query(
                `UPDATE users SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, firstname, lastname, email, role`,
                [adminId]
            );

            return deleted[0] ?? null;
        } catch (error) {
            console.error("Error deleting admin:", error);
            throw error;
        }
    }
}

export default AdminModel;