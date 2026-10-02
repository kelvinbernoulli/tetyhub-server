import pool from '#services/pg_pool.js';

function vendorScope(parameter) {
    return `((p.order_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM order_items oi WHERE oi.order_id = p.order_id AND oi.vendor_id = ${parameter}
    )) OR (p.order_id IS NULL AND COALESCE(b.vendor_id, p.vendor_id) = ${parameter}))`;
}

async function fetchHistory({ userId, vendorId, id, offset = 0, limit = 20, status, payment_status, type } = {}) {
    const values = [];
    const conditions = [];
    const bind = value => { values.push(value); return `$${values.length}`; };
    if (userId !== undefined) conditions.push(`p.user_id = ${bind(userId)}`);
    const vendorParameter = vendorId !== undefined ? bind(vendorId) : null;
    if (vendorParameter) conditions.push(vendorScope(vendorParameter));
    if (id !== undefined) conditions.push(`p.id = ${bind(id)}`);
    if (status) conditions.push(`p.status = ${bind(status)}`);
    if (payment_status) conditions.push(`COALESCE(o.payment_status, b.payment_status) = ${bind(payment_status)}`);
    if (type === 'order') conditions.push('p.order_id IS NOT NULL');
    if (type === 'booking') conditions.push('p.booking_id IS NOT NULL');

    const query = `SELECT
        p.id, p.user_id, p.order_id, p.booking_id, p.gateway, p.gateway_ref,
        p.amount, p.currency_id, c.code AS currency, p.status, p.paid_at, p.created_at, p.updated_at,
        CASE WHEN p.order_id IS NOT NULL THEN 'order' WHEN p.booking_id IS NOT NULL THEN 'booking' ELSE 'payment' END AS type,
        o.order_number, o.status AS order_status, o.total AS order_total,
        b.booking_status, b.service_name, b.total AS booking_total,
        COALESCE(o.payment_status, b.payment_status) AS payment_status,
        u.firstname, u.lastname,
        ${vendorParameter ? `${vendorParameter}::integer` : 'COALESCE(b.vendor_id, p.vendor_id)'} AS vendor_id,
        ${vendorParameter ? `(SELECT SUM(oi.subtotal) FROM order_items oi WHERE oi.order_id = p.order_id AND oi.vendor_id = ${vendorParameter})` : 'NULL::numeric'} AS vendor_item_subtotal,
        COALESCE((SELECT json_agg(json_build_object('vendor_id', owners.vendor_id, 'vendor_name', vs.store_name) ORDER BY owners.vendor_id)
            FROM (
                SELECT oi.vendor_id FROM order_items oi WHERE oi.order_id = p.order_id
                UNION
                SELECT COALESCE(b.vendor_id, p.vendor_id) WHERE p.order_id IS NULL AND COALESCE(b.vendor_id, p.vendor_id) IS NOT NULL
            ) owners
            LEFT JOIN vendor_settings vs ON vs.vendor_id = owners.vendor_id
            ${vendorParameter ? `WHERE owners.vendor_id = ${vendorParameter}` : ''}
        ), '[]'::json) AS vendors
        FROM payments p
        LEFT JOIN orders o ON o.id = p.order_id
        LEFT JOIN service_bookings b ON b.id = p.booking_id
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN currencies c ON c.id = p.currency_id
        ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ${bind(limit)} OFFSET ${bind(offset)}`;
    return (await pool.query(query, values)).rows;
}

export class TransactionHistory {
    static async fetchTransactions(userId, options = {}) {
        if (!userId) return [];
        return fetchHistory({ ...options, userId, vendorId: undefined, id: undefined });
    }

    static async getTransactionById(transactionId, userId) {
        if (!userId) return null;
        const rows = await fetchHistory({ id: transactionId, userId, limit: 1 });
        return rows[0] ?? null;
    }

    static async fetchVendorTransactions(vendorId, options = {}) {
        if (!vendorId) return [];
        return fetchHistory({ ...options, vendorId, userId: undefined, id: undefined });
    }

    static async fetchAllTransactions({ vendor_id, ...options } = {}) {
        return fetchHistory({ ...options, vendorId: vendor_id, userId: undefined, id: undefined });
    }
}

export default TransactionHistory;
