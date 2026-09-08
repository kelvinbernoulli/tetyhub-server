import pool from '#services/pg_pool.js';

export class Childcategory {

    static async create({ name, description, image, subcategory_id }) {
        const slug = name.toLowerCase().replace(/\s+/g, '-');
        const result = await pool.query(`
            INSERT INTO childcategories
                (name, slug, subcategory_id, description, image, status)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *`,
            [name, slug, subcategory_id, description ?? null, image ?? null, true]
        );
        return result;
    }

    static async update(ChildcategoryId, value) {
        // Guard: valid ID
        const id = Number(ChildcategoryId);
        if (!Number.isInteger(id) || id <= 0) {
            throw new Error('A valid ID is required');
        }

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
            throw new Error('No valid fields provided to update');
        }

        const idIdx = fields.length + 1;

        try {
            const { rows } = await pool.query(
                `
                UPDATE childcategories
                SET ${fields.join(', ')}, updated_at = NOW()
                WHERE id = $${idIdx}
                RETURNING *
                `,
                [...values, id]
            );

            // No row matched -> either it doesn't exist or was soft-deleted
            return rows[0] || null;
        } catch (error) {
            console.error(`Error updating childcategory`, error);
            throw error;
        }
    }

    static async fetch({ limit = 10, offset = 0 } = {}) {
        const result = await pool.query(`
            SELECT * FROM childcategories
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return result;
    }

    static async fetchById(ChildcategoryId) {
        const { rows } = await pool.query(`
            SELECT * FROM childcategories
            WHERE id = $1 
            LIMIT 1`,
            [ChildcategoryId]
        );
        return rows[0] ?? null;
    }

    static async delete(ChildcategoryId) {
        const { rows } = await pool.query(`
            DELETE FROM childcategories
            WHERE id = $1
            RETURNING id`,
            [ChildcategoryId]
        );
        return rows[0] ?? null;
    }
}

export default Childcategory;