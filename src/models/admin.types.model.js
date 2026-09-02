import pool from '#services/pg_pool.js';
import {
    PERMISSION_SCOPES,
    isPlatformActor,
} from '#utils/access-control.js';
import { conflictError, notFoundError } from '#utils/app.error.js';

class AdminType {
    static async fetchAdminTypes({ actor, offset = 0, limit = 20, includeInactive = false }) {
        const values = [];
        const where = [];

        if (!includeInactive) {
            where.push('status = true');
        }

        if (!isPlatformActor(actor.role)) {
            values.push([PERMISSION_SCOPES.VENDOR, PERMISSION_SCOPES.BOTH]);
            where.push(`scope::text = ANY($${values.length}::text[])`);
        }

        const safeLimit = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const safeOffset = Math.max(Number(offset) || 0, 0);
        values.push(safeLimit, safeOffset);
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

        const { rows } = await pool.query(
            `SELECT
                id,
                admin_type,
                slug AS resource,
                description,
                scope::text AS scope,
                is_system,
                status,
                created_at,
                updated_at
            FROM admin_types
            ${whereSql}
            ORDER BY admin_type ASC
            LIMIT $${values.length - 1}
            OFFSET $${values.length}`,
            values
        );

        return rows;
    }

    static async create(data) {
        try {
            const { rows } = await pool.query(
                `INSERT INTO admin_types (
                    admin_type, slug, description, scope, status, is_system
                )
                VALUES ($1, $2, $3, $4, $5, false)
                RETURNING
                    id,
                    admin_type,
                    slug AS resource,
                    description,
                    scope::text AS scope,
                    is_system,
                    status,
                    created_at`,
                [
                    data.admin_type,
                    data.resource,
                    data.description ?? null,
                    data.scope,
                    data.status,
                ]
            );
            return rows[0];
        } catch (error) {
            if (error.code === '23505') {
                throw conflictError('A permission resource with that name or code already exists.');
            }
            throw error;
        }
    }

    static async update(id, data) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const { rows } = await client.query(
                'SELECT * FROM admin_types WHERE id = $1 FOR UPDATE',
                [id]
            );
            const existing = rows[0];
            if (!existing) throw notFoundError('Permission resource not found.');

            if (
                existing.is_system
                && (
                    (data.scope && data.scope !== existing.scope)
                    || (data.resource && data.resource !== existing.slug)
                )
            ) {
                throw conflictError('System permission codes and scopes are immutable.');
            }

            const allowedFields = {
                admin_type: 'admin_type',
                resource: 'slug',
                description: 'description',
                scope: 'scope',
                status: 'status',
            };
            const values = [];
            const setters = [];
            for (const [input, column] of Object.entries(allowedFields)) {
                if (Object.hasOwn(data, input)) {
                    values.push(data[input]);
                    setters.push(`${column} = $${values.length}`);
                }
            }
            values.push(id);

            const { rows: updatedRows } = await client.query(
                `UPDATE admin_types
                SET ${setters.join(', ')}, updated_at = NOW()
                WHERE id = $${values.length}
                RETURNING
                    id,
                    admin_type,
                    slug AS resource,
                    description,
                    scope::text AS scope,
                    is_system,
                    status,
                    updated_at`,
                values
            );
            await client.query('COMMIT');
            return updatedRows[0];
        } catch (error) {
            await client.query('ROLLBACK');
            if (error.code === '23505') {
                throw conflictError('A permission resource with that name or code already exists.');
            }
            throw error;
        } finally {
            client.release();
        }
    }

    static async getById(id) {
        const { rows } = await pool.query(
            `SELECT
                id,
                admin_type,
                slug AS resource,
                description,
                scope::text AS scope,
                is_system,
                status,
                created_at,
                updated_at
            FROM admin_types
            WHERE id = $1`,
            [id]
        );
        return rows[0] ?? null;
    }

    static async delete(id) {
        const { rows } = await pool.query(
            `DELETE FROM admin_types
            WHERE id = $1 AND is_system = false
            RETURNING id, admin_type, slug AS resource`,
            [id]
        );
        if (!rows[0]) {
            throw conflictError('System permission resources cannot be deleted.');
        }
        return rows[0];
    }

    static async getAdminTypesByIds(ids) {
        const { rows } = await pool.query(
            `SELECT id, slug, scope::text AS scope, status
            FROM admin_types
            WHERE id = ANY($1::integer[])`,
            [ids]
        );
        return rows;
    }
}

export default AdminType;
