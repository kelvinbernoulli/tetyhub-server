import pool from "#services/pg_pool.js";

export class Subcategory {
    static async create(data) {
        const { name, category_id, image, description } = data;
        const slug = name.toLowerCase().replace(/\s+/g, '-');
        const result = await pool.query(`
            INSERT INTO subcategories
                (name, slug, category_id, image, status, description)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [name, slug, category_id, image ?? null, true, description ?? null]
        );
        return result;
    }

    static async update(subcategoryId, data) {
        const allowed = ['name', 'category_id', 'description', 'image', 'status'];
        const fields = [];
        const values = [];

        for (const key of allowed) {
            if (data[key] !== undefined) {
                fields.push(`${key} = $${fields.length + 1}`);
                values.push(data[key]);
            }
        }

        if (fields.length === 0) {
            throw new Error('No fields to update');
        }

        // subcategoryId and vendorId appended after dynamic fields
        const idIdx = fields.length + 1;

        const { rows } = await pool.query(`
                UPDATE subcategories
                SET ${fields.join(', ')}, updated_at = NOW()
                WHERE id = $${idIdx}
                RETURNING *`,
            [...values, subcategoryId]
        );

        return rows[0] ?? null; 
    }

    static async fetch(limit = 10, offset = 0) {
        const { rows } = await pool.query(`
            SELECT * FROM subcategories
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return rows[0] ?? null;
    }

    static async fetchById(subcategoryId) {
        const { rows } = await pool.query(`
            SELECT * FROM subcategories
            WHERE id = $1
            LIMIT 1`,
            [subcategoryId]
        );
        return rows[0] ?? null;
    }

    static async delete(subcategoryId) {
        const { rows } = await pool.query(`
            UPDATE subcategories
            SET deleted_at = NOW()
            WHERE id = $1
            RETURNING id`,
            [subcategoryId]
        );
        return rows[0] ?? null; // null = not found or already deleted
    }
}

export default Subcategory;