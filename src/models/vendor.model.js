import pool from "#services/pg_pool.js";
import { ROLES } from "#utils/helpers.js";

class VendorModel {
    static async createVendorUser({ vendor_id, email, password, firstname, lastname, phone, role }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { rows: userRows } = await client.query(
                `INSERT INTO users (email, password, firstname, lastname, phone, role)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id, email, firstname, lastname, role, status, email_verified, created_at`,
                [email, password, firstname, lastname, phone ?? null, role]
            );
            const user = userRows[0];

            await client.query(
                `INSERT INTO vendor_users (user_id, vendor_id) VALUES ($1, $2)`,
                [user.id, vendor_id]
            );

            await client.query('COMMIT');
            return { ...user, vendor_id };
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    }

    static async updateVendorUser(user_id, fields) {
        const keys = Object.keys(fields);
        const values = Object.values(fields);
        const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
        const { rows } = await pool.query(
            `UPDATE users
            SET ${setClause}, updated_at = NOW()
            WHERE id = $${keys.length + 1}
            RETURNING id, email, firstname, lastname, role, status, email_verified, updated_at`,
            [...values, user_id]
        );
        return rows[0] ?? null;
    }

    static async getVendorByEmail(email) {
        const { rows } = await pool.query(
            `SELECT u.*, v.*
                FROM users u
                JOIN vendors v ON v.user_id = u.id
                WHERE u.email = $1
                AND u.role = $2
                AND u.deleted_at IS NULL`,
            [email, ROLES.VENDOR]
        );
        return rows[0] ?? null;
    }

    static async getVendorByPhone(phone) {
        const { rows } = await pool.query(
            `SELECT u.*, v.*
            FROM users u
            JOIN vendors v ON v.user_id = u.id
            WHERE u.phone = $1
            AND u.role = $2
            AND u.deleted_at IS NULL`,
            [phone, ROLES.VENDOR]
        );
        return rows[0] ?? null;
    }

    static async getVendorById(id) {
        const { rows } = await pool.query(
            `SELECT u.*, v.*
            FROM users u
            JOIN vendors v ON v.user_id = u.id
            WHERE u.id = $1
            AND u.role = $2
            AND u.deleted_at IS NULL`,
            [id, ROLES.VENDOR]
        );
        return rows[0] ?? null;
    }

    static async getVendorAdminByEmail(email, vendorId) {
        const { rows } = await pool.query(
            `SELECT u.id, u.email, u.password, u.firstname, u.lastname,
                u.phone, u.role, u.status, u.email_verified,
                v.vendor_id
            FROM users u
            JOIN admins v ON v.user_id = u.id
            WHERE u.email = $1
            AND u.role = $2
            AND v.vendor_id = $3
            AND u.deleted_at IS NULL
            LIMIT 1`,
            [email, ROLES.VENDOR_ADMIN, vendorId]
        );
        return rows[0] ?? null;
    }

    static async getVendorAdminByPhone(phone, vendorId) {
        const { rows } = await pool.query(
            `SELECT u.id, u.email, u.password, u.firstname, u.lastname,
                u.phone, u.role, u.status, u.email_verified,
                v.vendor_id
            FROM users u
            JOIN admins v ON v.user_id = u.id
            WHERE u.phone = $1
            AND u.role = $2
            AND v.vendor_id = $3
            AND u.deleted_at IS NULL
            LIMIT 1`,
            [phone, ROLES.VENDOR_ADMIN, vendorId]
        );
        return rows[0] ?? null;
    }

    static async getVendorAdminById(id, vendorId) {
        const { rows } = await pool.query(
            `SELECT u.id, u.email, u.password, u.firstname, u.lastname,
                u.phone, u.role, u.status, u.email_verified,
                v.vendor_id
            FROM users u
            JOIN admins v ON v.user_id = u.id
            WHERE u.id = $1
            AND u.role = $2
            AND v.vendor_id = $3
            AND u.deleted_at IS NULL
            LIMIT 1`,
            [id, ROLES.VENDOR_ADMIN, vendorId]
        );
        return rows[0] ?? null;
    }

    // ─── OVERVIEW STATS ────────────────────────────────
    static async getOverviewStats(vendorId) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    -- Orders
                    COUNT(DISTINCT o.id)                                            AS total_orders,
                    COUNT(DISTINCT CASE WHEN o.status = 'pending' 
                        THEN o.id END)                                              AS pending_orders,
                    COUNT(DISTINCT CASE WHEN o.status = 'processing' 
                        THEN o.id END)                                              AS processing_orders,
                    COUNT(DISTINCT CASE WHEN o.status = 'shipped' 
                        THEN o.id END)                                              AS shipped_orders,
                    COUNT(DISTINCT CASE WHEN o.status = 'delivered' 
                        THEN o.id END)                                              AS delivered_orders,
                    COUNT(DISTINCT CASE WHEN o.status = 'cancelled' 
                        THEN o.id END)                                              AS cancelled_orders,

                    -- Revenue
                    COALESCE(SUM(CASE WHEN o.payment_status = 'paid' 
                        THEN o.total END), 0)                                       AS total_revenue,
                    COALESCE(SUM(CASE WHEN o.payment_status = 'paid'
                        AND o.created_at >= date_trunc('month', NOW())
                        THEN o.total END), 0)                                       AS monthly_revenue,
                    COALESCE(SUM(CASE WHEN o.payment_status = 'paid'
                        AND o.created_at >= date_trunc('week', NOW())
                        THEN o.total END), 0)                                       AS weekly_revenue,
                    COALESCE(SUM(CASE WHEN o.payment_status = 'paid'
                        AND o.created_at >= CURRENT_DATE
                        THEN o.total END), 0)                                       AS today_revenue,

                    -- Customers
                    COUNT(DISTINCT o.user_id)                                       AS total_customers,
                    COUNT(DISTINCT CASE WHEN o.created_at >= date_trunc('month', NOW())
                        THEN o.user_id END)                                         AS new_customers_this_month,

                    -- Products
                    COUNT(DISTINCT p.id)                                            AS total_products,
                    COUNT(DISTINCT CASE WHEN p.status = 'active' 
                        THEN p.id END)                                              AS active_products,
                    COUNT(DISTINCT CASE WHEN p.stock <= p.low_stock_threshold
                        THEN p.id END)                                              AS low_stock_products,
                    COUNT(DISTINCT CASE WHEN p.stock = 0 
                        THEN p.id END)                                              AS out_of_stock_products,

                    -- Refunds
                    COALESCE(SUM(CASE WHEN o.payment_status = 'refunded'
                        THEN o.total END), 0)                                       AS total_refunds
                FROM orders o
                LEFT JOIN products p ON p.vendor_id = $1 AND p.deleted_at IS NULL
                WHERE o.vendor_id = $1`,
                [vendorId]
            );

            return rows[0];
        } catch (error) {
            console.error("Error fetching overview stats:", error);
            throw error;
        }
    }

    // ─── REVENUE CHART ─────────────────────────────────
    static async getRevenueChart(vendorId, period = 'monthly') {
        try {
            const periodConfig = {
                daily: {
                    trunc: 'day',
                    format: 'YYYY-MM-DD',
                    limit: 30       // last 30 days
                },
                weekly: {
                    trunc: 'week',
                    format: 'YYYY-WW',
                    limit: 12       // last 12 weeks
                },
                monthly: {
                    trunc: 'month',
                    format: 'YYYY-MM',
                    limit: 12       // last 12 months
                },
                yearly: {
                    trunc: 'year',
                    format: 'YYYY',
                    limit: 5        // last 5 years
                }
            };

            const config = periodConfig[period] ?? periodConfig.monthly;

            const { rows } = await pool.query(
                `SELECT
                    to_char(date_trunc($1, o.created_at), $2)   AS period,
                    COALESCE(SUM(o.total), 0)                    AS revenue,
                    COALESCE(SUM(o.subtotal), 0)                 AS subtotal,
                    COALESCE(SUM(o.shipping_fee), 0)             AS shipping_fees,
                    COUNT(o.id)                                  AS order_count
                FROM orders o
                WHERE o.vendor_id = $3
                AND o.payment_status = 'paid'
                AND o.created_at >= NOW() - ($4 || ' ' || $1)::INTERVAL
                GROUP BY date_trunc($1, o.created_at)
                ORDER BY date_trunc($1, o.created_at) ASC`,
                [config.trunc, config.format, vendorId, config.limit]
            );

            return rows;
        } catch (error) {
            console.error("Error fetching revenue chart:", error);
            throw error;
        }
    }

    // ─── TOP SELLING PRODUCTS ──────────────────────────
    static async getTopSellingProducts(vendorId, limit = 10) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    p.id,
                    p.name,
                    p.thumbnail,
                    p.price,
                    p.stock,
                    SUM(oi.quantity)            AS total_sold,
                    SUM(oi.subtotal)            AS total_revenue,
                    COUNT(DISTINCT o.id)        AS order_count
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                JOIN products p ON p.id = oi.product_id
                WHERE o.vendor_id = $1
                AND o.payment_status = 'paid'
                AND p.deleted_at IS NULL
                GROUP BY p.id
                ORDER BY total_sold DESC
                LIMIT $2`,
                [vendorId, limit]
            );

            return rows;
        } catch (error) {
            console.error("Error fetching top selling products:", error);
            throw error;
        }
    }

    // ─── LOW STOCK ALERTS ──────────────────────────────
    static async getLowStockProducts(vendorId, limit = 10) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    p.id,
                    p.name,
                    p.thumbnail,
                    p.stock,
                    p.low_stock_threshold,
                    p.status,
                    CASE
                        WHEN p.stock = 0 THEN 'out_of_stock'
                        WHEN p.stock <= p.low_stock_threshold THEN 'low_stock'
                    END AS stock_status
                FROM products p
                WHERE p.vendor_id = $1
                AND p.stock <= p.low_stock_threshold
                AND p.deleted_at IS NULL
                ORDER BY p.stock ASC
                LIMIT $2`,
                [vendorId, limit]
            );

            return rows;
        } catch (error) {
            console.error("Error fetching low stock products:", error);
            throw error;
        }
    }

    // ─── RECENT ORDERS ─────────────────────────────────
    static async getRecentOrders(vendorId, limit = 10) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    o.id,
                    o.status,
                    o.payment_status,
                    o.total,
                    o.created_at,
                    u.firstname,
                    u.lastname,
                    u.email,
                    COUNT(oi.id) AS item_count
                FROM orders o
                JOIN users u ON u.id = o.user_id
                JOIN order_items oi ON oi.order_id = o.id
                WHERE o.vendor_id = $1
                GROUP BY o.id, u.id
                ORDER BY o.created_at DESC
                LIMIT $2`,
                [vendorId, limit]
            );

            return rows;
        } catch (error) {
            console.error("Error fetching recent orders:", error);
            throw error;
        }
    }

    // ─── TOP CUSTOMERS ─────────────────────────────────
    static async getTopCustomers(vendorId, limit = 10) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    u.id,
                    u.firstname,
                    u.lastname,
                    u.email,
                    COUNT(DISTINCT o.id)    AS total_orders,
                    SUM(o.total)            AS total_spent
                FROM orders o
                JOIN users u ON u.id = o.user_id
                WHERE o.vendor_id = $1
                AND o.payment_status = 'paid'
                GROUP BY u.id
                ORDER BY total_spent DESC
                LIMIT $2`,
                [vendorId, limit]
            );

            return rows;
        } catch (error) {
            console.error("Error fetching top customers:", error);
            throw error;
        }
    }

    // ─── SALES BY CATEGORY ─────────────────────────────
    static async getSalesByCategory(vendorId) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    c.id,
                    c.name AS category,
                    COUNT(DISTINCT o.id)    AS order_count,
                    SUM(oi.quantity)        AS total_sold,
                    SUM(oi.subtotal)        AS total_revenue
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
                JOIN products p ON p.id = oi.product_id
                JOIN categories c ON c.id = p.category_id
                WHERE o.vendor_id = $1
                AND o.payment_status = 'paid'
                GROUP BY c.id
                ORDER BY total_revenue DESC`,
                [vendorId]
            );

            return rows;
        } catch (error) {
            console.error("Error fetching sales by category:", error);
            throw error;
        }
    }

    // ─── FULL DASHBOARD ────────────────────────────────
    static async getDashboard(vendorId, period = 'monthly') {
        try {
            const [
                overview,
                revenueChart,
                topProducts,
                lowStock,
                recentOrders,
                topCustomers,
                salesByCategory
            ] = await Promise.all([
                VendorModel.getOverviewStats(vendorId),
                VendorModel.getRevenueChart(vendorId, period),
                VendorModel.getTopSellingProducts(vendorId),
                VendorModel.getLowStockProducts(vendorId),
                VendorModel.getRecentOrders(vendorId),
                VendorModel.getTopCustomers(vendorId),
                VendorModel.getSalesByCategory(vendorId)
            ]);

            return {
                overview,
                revenue_chart: revenueChart,
                top_products: topProducts,
                low_stock: lowStock,
                recent_orders: recentOrders,
                top_customers: topCustomers,
                sales_by_category: salesByCategory
            };
        } catch (error) {
            console.error("Error fetching dashboard:", error);
            throw error;
        }
    }
}

export default VendorModel;