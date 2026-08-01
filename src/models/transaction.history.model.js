import pool from "#services/pg_pool.js";

export class TransactionHistory {
    static async fetchTransactions(userId, { offset = 0, limit = 20 } = {}) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    p.*,
                    o.status AS order_status,
                    o.total AS order_total,
                    o.payment_status,
                    o.id AS order_id,
                    o.vendor_id,
                    u.firstname,
                    u.lastname
                FROM payments p
                LEFT JOIN orders o ON o.id = p.order_id
                LEFT JOIN users u ON u.id = p.user_id
                WHERE p.user_id = $1
                ORDER BY p.created_at DESC
                OFFSET $2 LIMIT $3`,
                [userId, offset, limit]
            );
            return rows;
        } catch (error) {
            console.error("Error fetching transaction history:", error);
            throw error;
        }
    }

    static async getTransactionById(transactionId, userId) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    p.*,
                    o.status AS order_status,
                    o.total AS order_total,
                    o.payment_status,
                    o.id AS order_id,
                    o.vendor_id
                FROM payments p
                LEFT JOIN orders o ON o.id = p.order_id
                WHERE p.id = $1
                AND p.user_id = $2
                LIMIT 1`,
                [transactionId, userId]
            );
            return rows[0];
        } catch (error) {
            console.error("Error fetching transaction by id:", error);
            throw error;
        }
    }

    static async fetchVendorTransactions(vendorId, { offset = 0, limit = 20, status, payment_status } = {}) {
        try {
            let query = `SELECT
                    p.*,
                    o.status AS order_status,
                    o.total AS order_total,
                    o.payment_status,
                    o.id AS order_id,
                    o.vendor_id,
                    u.firstname,
                    u.lastname
                FROM payments p
                LEFT JOIN orders o ON o.id = p.order_id
                LEFT JOIN users u ON u.id = p.user_id
                WHERE o.vendor_id = $1`;

            const params = [vendorId];
            let paramIndex = 2;

            if (status) {
                query += ` AND p.status = $${paramIndex}`;
                params.push(status);
                paramIndex++;
            }

            if (payment_status) {
                query += ` AND o.payment_status = $${paramIndex}`;
                params.push(payment_status);
                paramIndex++;
            }

            query += ` ORDER BY p.created_at DESC OFFSET $${paramIndex} LIMIT $${paramIndex + 1}`;
            params.push(offset, limit);

            const { rows } = await pool.query(query, params);
            return rows;
        } catch (error) {
            console.error("Error fetching vendor transactions:", error);
            throw error;
        }
    }

    static async fetchAllTransactions({ offset = 0, limit = 20, status, payment_status, vendor_id } = {}) {
        try {
            let query = `SELECT
                    p.*,
                    o.status AS order_status,
                    o.total AS order_total,
                    o.payment_status,
                    o.id AS order_id,
                    o.vendor_id,
                    u.firstname,
                    u.lastname,
                    v.business_name AS vendor_name
                FROM payments p
                LEFT JOIN orders o ON o.id = p.order_id
                LEFT JOIN users u ON u.id = p.user_id
                LEFT JOIN vendors v ON v.id = o.vendor_id`;

            const params = [];
            let paramIndex = 1;

            if (status) {
                query += ` WHERE p.status = $${paramIndex}`;
                params.push(status);
                paramIndex++;
            }

            if (payment_status) {
                query += `${params.length ? ' AND' : ' WHERE'} o.payment_status = $${paramIndex}`;
                params.push(payment_status);
                paramIndex++;
            }

            if (vendor_id) {
                query += `${params.length ? ' AND' : ' WHERE'} o.vendor_id = $${paramIndex}`;
                params.push(vendor_id);
                paramIndex++;
            }

            query += ` ORDER BY p.created_at DESC OFFSET $${paramIndex} LIMIT $${paramIndex + 1}`;
            params.push(offset, limit);

            const { rows } = await pool.query(query, params);
            return rows;
        } catch (error) {
            console.error("Error fetching all transactions:", error);
            throw error;
        }
    }
};

export default TransactionHistory;