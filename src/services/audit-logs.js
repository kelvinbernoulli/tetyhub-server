import pool from '#services/pg_pool.js';

const isPlainObject = (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export class ActivityLog {
    static async record({ userId, action, details = {} }) {
        if (userId == null || !Number.isSafeInteger(Number(userId)) || !action) return;

        await pool.query(
            `INSERT INTO activity_logs (user_id, action, details)
             VALUES ($1, $2, $3)`,
            [Number(userId), String(action).slice(0, 200), JSON.stringify(details)]
        );
    }

    static async listForUser(userId, offset, limit) {
        const [rowsResult, countResult] = await Promise.all([
            pool.query(
                `SELECT id, action, details, created_at
                 FROM activity_logs
                 WHERE user_id = $1
                 ORDER BY created_at DESC, id DESC
                 LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            ),
            pool.query('SELECT COUNT(*)::int AS total FROM activity_logs WHERE user_id = $1', [userId]),
        ]);

        return { rows: rowsResult.rows, total: countResult.rows[0].total };
    }

    static async getUserById(userId, id) {
        const result = await pool.query(
            `SELECT id, action, details, created_at
             FROM activity_logs
             WHERE id = $1 AND user_id = $2`,
            [id, userId]
        );

        return result.rows[0] ?? null;
    }

    static async listForAdmin({ offset, limit, source, userId, level, search }) {
        const filters = [source || null, userId || null, level || null, search ? `%${search}%` : null];
        const where = `($1::text IS NULL OR source = $1)
            AND ($2::int IS NULL OR user_id = $2)
            AND ($3::text IS NULL OR level = $3)
            AND ($4::text IS NULL OR event ILIKE $4 OR message ILIKE $4)`;
        const query = `WITH audit_entries AS (
                SELECT id::text AS id, 'activity'::text AS source, 'info'::text AS level,
                    action AS event, action AS message,
                    jsonb_build_object('details', details) AS details,
                    user_id, created_at, NULL::int AS status_code, NULL::text AS request_id
                FROM activity_logs
                UNION ALL
                SELECT id::text, 'system'::text, level, event, message, details,
                    user_id, created_at, status_code, request_id
                FROM system_logs
            )
            SELECT id, source, level, event, message, details, user_id,
                created_at, status_code, request_id
            FROM audit_entries
            WHERE ${where}
            ORDER BY created_at DESC
            LIMIT $5 OFFSET $6`;
        const countQuery = `WITH audit_entries AS (
                SELECT 'activity'::text AS source, 'info'::text AS level,
                    action AS event, action AS message, user_id FROM activity_logs
                UNION ALL
                SELECT 'system'::text, level, event, message, user_id FROM system_logs
            )
            SELECT COUNT(*)::int AS total FROM audit_entries WHERE ${where}`;

        const [rowsResult, countResult] = await Promise.all([
            pool.query(query, [...filters, limit, offset]),
            pool.query(countQuery, filters),
        ]);

        return { rows: rowsResult.rows, total: countResult.rows[0].total };
    }

    static async getAdminById(source, id) {
        const query = source === 'activity'
            ? `SELECT id::text AS id, 'activity'::text AS source, 'info'::text AS level,
                    action AS event, action AS message,
                    jsonb_build_object('details', details) AS details,
                    user_id, created_at, NULL::int AS status_code, NULL::text AS request_id
               FROM activity_logs
               WHERE id = $1`
            : `SELECT id::text AS id, 'system'::text AS source, level, event, message,
                    details, user_id, created_at, status_code, request_id
               FROM system_logs
               WHERE id = $1`;
        const result = await pool.query(query, [id]);

        return result.rows[0] ?? null;
    }
}

export class SystemLog {
    static async record({
        level = 'error', event, message, details = {}, userId = null,
        requestId = null, method = null, path = null, statusCode = null,
    }) {
        if (!event || !['info', 'warn', 'error', 'fatal'].includes(level)) return;

        const safeDetails = isPlainObject(details) ? details : {};
        try {
            await pool.query(
                `INSERT INTO system_logs
                    (level, event, message, details, user_id, request_id, method, path, status_code)
                 VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)`,
                [
                    level,
                    String(event).slice(0, 120),
                    message ? String(message).slice(0, 500) : null,
                    JSON.stringify(safeDetails),
                    userId != null && Number.isSafeInteger(Number(userId)) ? Number(userId) : null,
                    requestId ? String(requestId).slice(0, 100) : null,
                    method ? String(method).slice(0, 10) : null,
                    path ? String(path).slice(0, 300) : null,
                    Number.isInteger(statusCode) ? statusCode : null,
                ]
            );
        } catch (error) {
            console.error('Unable to persist system log', {
                errorName: error?.name ?? 'Error',
                errorCode: error?.code ?? null,
            });
        }
    }
}
