import pool from '#services/pg_pool.js';

export class Coupon {

    static async create({ vendorId, code, type, value, max_discount = null, min_order = 0, usage_limit = null, status = 'active', expires_at = null, description = null }) {
        const { rows } = await pool.query(`
            INSERT INTO coupons
                (vendor_id, code, type, value, max_discount, min_order, usage_limit, usage_count, status, expires_at, description)
            VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10)
            RETURNING *`,
            [vendorId, code, type, value, max_discount, min_order, usage_limit, status, expires_at, description]
        );
        return rows[0];
    }

    static async update(couponId, vendorId, body) {
        const allowed = ['code', 'type', 'value', 'max_discount', 'min_order', 'usage_limit', 'status', 'expires_at', 'description'];
        const fields = [];
        const values = [];

        for (const key of allowed) {
            if (body[key] !== undefined) {
                fields.push(`${key} = $${fields.length + 1}`);
                values.push(body[key]);
            }
        }

        if (fields.length === 0) {
            throw new Error('No fields to update');
        }

        const idIdx = fields.length + 1;
        const vendorIdx = fields.length + 2;

        const { rows } = await pool.query(`
            UPDATE coupons
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE id = $${idIdx} AND vendor_id = $${vendorIdx} AND deleted_at IS NULL
            RETURNING *`,
            [...values, couponId, vendorId]
        );

        return rows[0] ?? null;
    }

    static async fetchByVendorId(vendorId, { limit = 20, offset = 0 } = {}) {
        const result = await pool.query(`
            SELECT * FROM coupons
            WHERE vendor_id = $1 AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3`,
            [vendorId, limit, offset]
        );
        return result;
    }

    static async fetchById(couponId, vendorId) {
        const { rows } = await pool.query(`
            SELECT * FROM coupons
            WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL
            LIMIT 1`,
            [couponId, vendorId]
        );
        return rows[0] ?? null;
    }

    static async duplicateCheck(code, vendorId) {
        const { rows } = await pool.query(`
            SELECT * FROM coupons
            WHERE code = $1 AND vendor_id = $2 AND deleted_at IS NULL
            LIMIT 1`,
            [code, vendorId]
        );
        return rows[0] ?? null;
    }

    static async delete(couponId, vendorId) {
        const { rows } = await pool.query(`
            UPDATE coupons
            SET deleted_at = NOW()
            WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL
            RETURNING id`,
            [couponId, vendorId]
        );
        return rows[0] ?? null;
    }

    static async incrementUsage(couponId) {
        await pool.query(`
            UPDATE coupons
            SET usage_count = COALESCE(usage_count,0) + 1
            WHERE id = $1`,
            [couponId]
        );
    }

}

export default Coupon;
