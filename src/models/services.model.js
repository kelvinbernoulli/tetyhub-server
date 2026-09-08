import pool from '#services/pg_pool.js';
import { randomUUID } from 'node:crypto';
import slugify from 'slugify';
import { normalizeServiceState, serviceError } from '#utils/service-state.js';

const FIELDS = [
    'category_id',
    'subcategory_id',
    'childcategory_id',
    'name',
    'short_description',
    'description',
    'tags',
    'status',
    'base_price',
    'compare_at_price',
    'currency_id',
    'duration_mins',
    'buffer_mins',
    'max_bookings_per_slot',
    'is_remote',
    'location_type',
    'cancellation_window_hours',
    'cancellation_fee_percent',
    'images',
    'thumbnail',
    'meta_title',
    'meta_description',
];
const pick = (data) =>
    Object.fromEntries(
        FIELDS.filter((key) => data[key] !== undefined).map((key) => [
            key,
            data[key],
        ])
    );
const requireVendor = (vendorId) => {
    if (!Number.isInteger(vendorId) || vendorId < 1 || vendorId > 2147483647)
        throw serviceError('Vendor authentication required', 403);
};
async function transaction(work) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}
async function validateRelations(client, data) {
    // Legacy rows can have no category; new service creation requires one.
    if (data.category_id != null) {
        const result = await client.query(
            "SELECT id FROM categories WHERE id = $1 AND status = true AND type IN ('service', 'both')",
            [data.category_id]
        );
        if (!result.rows.length) throw serviceError('Invalid service category');
    }
    if (data.subcategory_id != null) {
        const result = await client.query(
            'SELECT id FROM subcategories WHERE id = $1 AND category_id = $2 AND status = true',
            [data.subcategory_id, data.category_id]
        );
        if (!result.rows.length)
            throw serviceError(
                'Subcategory must belong to the selected category'
            );
    }
    if (data.childcategory_id != null) {
        const result = await client.query(
            'SELECT id FROM childcategories WHERE id = $1 AND subcategory_id = $2 AND status = true',
            [data.childcategory_id, data.subcategory_id]
        );
        if (!result.rows.length)
            throw serviceError(
                'Child category must belong to the selected subcategory'
            );
    }
    const currency = await client.query(
        'SELECT id FROM currencies WHERE id = $1',
        [data.currency_id]
    );
    if (!currency.rows.length) throw serviceError('Invalid currency');
}
const SELECT = `SELECT s.*, v.store_name AS vendor_name, c.name AS category_name,
    sc.name AS subcategory_name, cc.name AS childcategory_name
    FROM services s LEFT JOIN vendors v ON v.id = s.vendor_id
    LEFT JOIN categories c ON c.id = s.category_id
    LEFT JOIN subcategories sc ON sc.id = s.subcategory_id
    LEFT JOIN childcategories cc ON cc.id = s.childcategory_id`;

export class Services {
    static async create(vendorId, data) {
        requireVendor(vendorId);
        return transaction(async (client) => {
            const fields = normalizeServiceState(pick(data), {}, true);
            if (!fields.category_id) throw serviceError('Category is required');
            await validateRelations(client, fields);
            fields.vendor_id = vendorId;
            fields.slug = `${slugify(fields.name, { lower: true, strict: true })}-${randomUUID()}`;
            const keys = Object.keys(fields);
            const { rows } = await client.query(
                `INSERT INTO services (${keys.join(', ')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
                Object.values(fields)
            );
            return rows[0];
        });
    }
    static async update(id, vendorId, data) {
        requireVendor(vendorId);
        return transaction(async (client) => {
            const found = await client.query(
                'SELECT * FROM services WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL FOR UPDATE',
                [id, vendorId]
            );
            if (!found.rows.length) return null;
            const existing = found.rows[0];
            const fields = normalizeServiceState(pick(data), existing);
            const keys = Object.keys(fields);
            if (!keys.length)
                throw serviceError('No valid fields provided', 400);
            await validateRelations(client, { ...existing, ...fields });
            const { rows } = await client.query(
                `UPDATE services SET ${keys.map((key, i) => `${key} = $${i + 1}`).join(', ')}, updated_at = NOW()
                WHERE id = $${keys.length + 1} AND vendor_id = $${keys.length + 2} AND deleted_at IS NULL RETURNING *`,
                [...Object.values(fields), id, vendorId]
            );
            return rows[0] ?? null;
        });
    }
    static async read(vendorId, filters = {}) {
        requireVendor(vendorId);
        const limit = Math.min(
            50,
            Math.max(1, Math.trunc(Number(filters.limit) || 20))
        );
        const offset = Math.max(0, Math.trunc(Number(filters.offset) || 0));
        const where = ['s.vendor_id = $1', 's.deleted_at IS NULL'];
        const values = [vendorId];
        const bind = (clause, value) => {
            values.push(value);
            where.push(clause.replaceAll('?', `$${values.length}`));
        };
        for (const field of [
            'category_id',
            'subcategory_id',
            'childcategory_id',
            'status',
            'is_remote',
            'location_type',
        ]) {
            if (filters[field] !== undefined)
                bind(`s.${field} = ?`, filters[field]);
        }
        if (filters.search)
            bind(
                '(s.name ILIKE ? OR s.description ILIKE ?)',
                `%${filters.search}%`
            );
        if (filters.min_price !== undefined)
            bind('s.base_price >= ?', filters.min_price);
        if (filters.max_price !== undefined)
            bind('s.base_price <= ?', filters.max_price);
        const column = [
            'created_at',
            'updated_at',
            'name',
            'base_price',
            'duration_mins',
        ].includes(filters.sort_by)
            ? filters.sort_by
            : 'created_at';
        const direction = filters.sort_order === 'ASC' ? 'ASC' : 'DESC';
        const clause = `WHERE ${where.join(' AND ')}`;
        const [result, count] = await Promise.all([
            pool.query(
                `${SELECT} ${clause} ORDER BY s.${column} ${direction}, s.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
                [...values, limit, offset]
            ),
            pool.query(
                `SELECT COUNT(*)::int AS total FROM services s ${clause}`,
                values
            ),
        ]);
        const total = Number(count.rows[0].total);
        return {
            data: result.rows,
            pagination: {
                total,
                limit,
                offset,
                total_pages: Math.ceil(total / limit),
                has_more: offset + limit < total,
            },
        };
    }
    static async view(id, vendorId) {
        requireVendor(vendorId);
        const { rows } = await pool.query(
            `${SELECT} WHERE s.id = $1 AND s.vendor_id = $2 AND s.deleted_at IS NULL LIMIT 1`,
            [id, vendorId]
        );
        return rows[0] ?? null;
    }
    static async delete(id, vendorId) {
        requireVendor(vendorId);
        const { rows } = await pool.query(
            "UPDATE services SET status = 'deleted', deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL RETURNING id",
            [id, vendorId]
        );
        return rows[0] ?? null;
    }
}
export default Services;
