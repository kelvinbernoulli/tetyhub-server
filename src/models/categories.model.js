import pool from '#services/pg_pool.js';

export class Category {

    static async create({ name, description, image, vendorId }) {
        const slug = name.toLowerCase().replace(/\s+/g, '-');
        const result = await pool.query(`
            INSERT INTO categories
                (name, slug, description, image, status, vendor_id)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [name, slug, description ?? null, image ?? null, true, vendorId]
        );
        return result;
    }

    static async update(categoryId, vendorId, body) {
        const allowed = ['name', 'description', 'image', 'status'];
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

        // categoryId and vendorId appended after dynamic fields
        const idIdx = fields.length + 1;
        const vendorIdx = fields.length + 2;

        const { rows } = await pool.query(`
            UPDATE categories
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE id = $${idIdx} AND vendor_id = $${vendorIdx} AND deleted_at IS NULL
            RETURNING *`,
            [...values, categoryId, vendorId]
        );

        return rows[0] ?? null; // null = not found or already deleted
    }

    static async fetchByVendorId(vendorId, { limit = 20, offset = 0 } = {}) {
        const result = await pool.query(`
            SELECT * FROM categories
            WHERE vendor_id = $1 AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3`,
            [vendorId, limit, offset]
        );
        return result;
    }

    static async duplicateCheck(categoryName, vendorId) {
        const { rows } = await pool.query(`
            SELECT * FROM categories
            WHERE name = $1 AND vendor_id = $2 AND deleted_at IS NULL
            LIMIT 1`,
            [categoryName, vendorId]
        );
        return rows[0] ?? null;
    }


    static async fetchById(categoryId, vendorId) {
        const { rows } = await pool.query(`
            SELECT * FROM categories
            WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL
            LIMIT 1`,
            [categoryId, vendorId]
        );
        return rows[0] ?? null;
    }

    static async delete(categoryId, vendorId) {
        const { rows } = await pool.query(`
            UPDATE categories
            SET deleted_at = NOW()
            WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL
            RETURNING id`,
            [categoryId, vendorId]
        );
        return rows[0] ?? null;
    }
}

export default Category;