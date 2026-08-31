import pool from '#services/pg_pool.js';

export class ChildSubcategory {

    static async create({ name, description, image, subcategory_id }) {
        const slug = name.toLowerCase().replace(/\s+/g, '-');
        const result = await pool.query(`
            INSERT INTO child_subcategories
                (name, slug, subcategory_id, description, image, status)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [name, slug, subcategory_id, description ?? null, image ?? null, true]
        );
        return result;
    }

    static async update(childsubcategoryId, value) {
        const allowed = ['name', 'subcategory_id', 'description', 'image', 'status'];
        const fields = [];
        const values = [];

        for (const key of allowed) {
            if (value[key] !== undefined) {
                fields.push(`${key} = $${fields.length + 1}`);
                values.push(value[key]);
            }
        }

        if (fields.length === 0) {
            throw new Error('No fields to update');
        }

        // categoryId and vendorId appended after dynamic fields
        const idIdx = fields.length + 1;

        const { rows } = await pool.query(`
            UPDATE child_subcategories
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE id = $${idIdx}
            RETURNING *`,
            [...values, childsubcategoryId]
        );

        return rows[0] ?? null; // null = not found or already deleted
    }

    static async fetch({ limit = 20, offset = 0 } = {}) {
        const result = await pool.query(`
            SELECT * FROM child_subcategories
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return result;
    }

    static async fetchById(childsubcategoryId) {
        const { rows } = await pool.query(`
            SELECT * FROM child_subcategories
            WHERE id = $1 
            LIMIT 1`,
            [childsubcategoryId]
        );
        return rows[0] ?? null;
    }

    static async delete(childsubcategoryId) {
        const { rows } = await pool.query(`
            DELETE FROM child_subcategories
            WHERE id = $1
            RETURNING id`,
            [childsubcategoryId]
        );
        return rows[0] ?? null;
    }
}

export default ChildSubcategory;