import pool from '#services/pg_pool.js';

class PayoutModel {
    static async listForVendor(vendorId, { status, limit = 20, offset = 0 } = {}) {
        const safeVendorId = Number(vendorId);
        const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
        const safeOffset = Math.max(0, Number(offset) || 0);

        if (!Number.isInteger(safeVendorId) || safeVendorId < 1) {
            const error = new Error('Vendor ID is required.');
            error.status = 400;
            throw error;
        }

        const params = [safeVendorId];
        let query = 'SELECT * FROM vendor_payouts WHERE vendor_id = $1';

        if (status) {
            query += ` AND status = $${params.length + 1}`;
            params.push(String(status).trim());
        }

        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(safeLimit, safeOffset);

        const { rows } = await pool.query(query, params);
        return rows;
    }

    static async findForVendor(vendorId, payoutId) {
        const safeVendorId = Number(vendorId);
        const safePayoutId = Number(payoutId);

        if (!Number.isInteger(safeVendorId) || safeVendorId < 1) {
            const error = new Error('Vendor ID is required.');
            error.status = 400;
            throw error;
        }

        if (!Number.isInteger(safePayoutId) || safePayoutId < 1) {
            const error = new Error('Invalid payout ID.');
            error.status = 400;
            throw error;
        }

        const { rows } = await pool.query(
            'SELECT * FROM vendor_payouts WHERE id = $1 AND vendor_id = $2',
            [safePayoutId, safeVendorId]
        );

        return rows[0] ?? null;
    }

    static async processPending(vendorId, payoutId) {
        const existing = await this.findForVendor(vendorId, payoutId);
        if (!existing) {
            const error = new Error('Payout not found.');
            error.status = 404;
            throw error;
        }

        if (existing.status !== 'pending') {
            const error = new Error('Only pending payouts can be processed.');
            error.status = 409;
            throw error;
        }

        const { rows } = await pool.query(
            `UPDATE vendor_payouts
             SET status = 'processing', processed_at = NOW()
             WHERE id = $1 AND vendor_id = $2
             RETURNING *`,
            [Number(payoutId), Number(vendorId)]
        );

        return rows[0];
    }

    static async settlePaid(vendorId, payoutId) {
        const existing = await this.findForVendor(vendorId, payoutId);
        if (!existing) {
            const error = new Error('Payout not found.');
            error.status = 404;
            throw error;
        }

        if (existing.status !== 'processing') {
            const error = new Error('Only processing payouts can be settled as paid.');
            error.status = 409;
            throw error;
        }

        const { rows } = await pool.query(
            `UPDATE vendor_payouts
             SET status = 'paid', paid_at = NOW(), processed_at = COALESCE(processed_at, NOW())
             WHERE id = $1 AND vendor_id = $2
             RETURNING *`,
            [Number(payoutId), Number(vendorId)]
        );

        return rows[0];
    }

    static async summaryForVendor(vendorId) {
        const safeVendorId = Number(vendorId);

        if (!Number.isInteger(safeVendorId) || safeVendorId < 1) {
            const error = new Error('Vendor ID is required.');
            error.status = 400;
            throw error;
        }

        const { rows } = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'pending') AS pending_count,
                COUNT(*) FILTER (WHERE status = 'processing') AS processing_count,
                COUNT(*) FILTER (WHERE status = 'paid') AS paid_count,
                COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) AS pending_total,
                COALESCE(SUM(amount) FILTER (WHERE status = 'processing'), 0) AS processing_total,
                COALESCE(SUM(amount) FILTER (WHERE status = 'paid'), 0) AS paid_total
             FROM vendor_payouts
             WHERE vendor_id = $1`,
            [safeVendorId]
        );

        return rows[0] ?? {
            pending_count: 0,
            processing_count: 0,
            paid_count: 0,
            pending_total: '0',
            processing_total: '0',
            paid_total: '0',
        };
    }
}

export default PayoutModel;
