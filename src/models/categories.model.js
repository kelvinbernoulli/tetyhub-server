import pool from '#services/pg_pool.js';

export class Category {

    static async create({ name, description, image }) {
        const slug = name.toLowerCase().replace(/\s+/g, '-');
        const result = await pool.query(`
            INSERT INTO categories
                (name, slug, description, image, status)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [name, slug, description ?? null, image ?? null, true]
        );
        return result;
    }

    static async update(categoryId, value) {
        const allowed = ['name', 'description', 'image', 'status'];
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
            UPDATE categories
            SET ${fields.join(', ')}, updated_at = NOW()
            WHERE id = $${idIdx}
            RETURNING *`,
            [...values, categoryId]
        );

        return rows[0] ?? null; // null = not found or already deleted
    }

    static async fetch({ limit = 20, offset = 0 } = {}) {
        const result = await pool.query(`
            SELECT * FROM categories
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3`,
            [limit, offset]
        );
        return result;
    }

    static async duplicateCheck(categoryName) {
        const { rows } = await pool.query(`
            SELECT * FROM categories
            WHERE name = $1
            LIMIT 1`,
            [categoryName]
        );
        return rows[0] ?? null;
    }


    static async fetchById(categoryId) {
        const { rows } = await pool.query(`
            SELECT * FROM categories
            WHERE id = $1 
            LIMIT 1`,
            [categoryId]
        );
        return rows[0] ?? null;
    }

    static async delete(categoryId) {
        const { rows } = await pool.query(`
            DELETE categories
            WHERE id = $1
            RETURNING id`,
            [categoryId]
        );
        return rows[0] ?? null;
    }
}

export default Category;