import pool from "#services/pg_pool.js";

export class Activity {
    static async logActivity(userId, action, details = {}) {
        try {
            const { rows } = await pool.query(
                `INSERT INTO activity_logs (user_id, action, details) 
                 VALUES ($1, $2, $3) 
                 RETURNING *`,
                [userId, action, JSON.stringify(details)]
            );
            console.log('Activity logged:', action);
            return rows[0];
        } catch (error) {
            console.error('Error logging activity:', error);
            throw error;
        }
    }

    static async getAllActivities(userId, offset = 0, limit = 20) {
        try {
            const { rows } = await pool.query(
                `SELECT * FROM activity_logs 
                 WHERE user_id = $1 
                 ORDER BY created_at DESC 
                 LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            );
            return rows;
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    static async searchActivities(userId = null, query, offset = 0, limit = 20) {
        try {
            const { rows } = await pool.query(
                `SELECT * FROM activity_logs
                WHERE ($1::int IS NULL OR user_id = $1) 
                AND (
                    action ILIKE $2 
                    OR details::text ILIKE $2
                )
                ORDER BY created_at DESC 
                LIMIT $3 OFFSET $4`,
                [userId, `%${query}%`, limit, offset]
            );
            return rows;
        } catch (error) {
            console.error(error);
            throw error;
        }
    }


    static async viewLog(logId) {
        try {
            const { rows } = await pool.query(
                `SELECT * FROM activity_logs WHERE id = $1`,
                [logId]
            );
            return rows;
        } catch (error) {
            console.error(error);
            throw error;
        }
    }

    static async getUserLogs(userId, offset = 0, limit = 20) {
        try {
            const { rows } = await pool.query(
                `SELECT * FROM activity_logs
                    WHERE user_id = $1
                    ORDER BY created_at DESC
                    LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            );
            return rows;
        } catch (error) {
            console.error(error);
            throw error;
        }

    }
}

export default Activity;