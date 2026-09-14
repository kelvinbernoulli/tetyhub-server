import pool from '#services/pg_pool.js';
import { randomUUID } from 'node:crypto';
import slugify from 'slugify';
import { normalizeServiceState, serviceError } from '#utils/service-state.js';
import { S3upload, S3delete } from '#services/s3bucket.js';

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
    const uploaded = [];
    try {
        await client.query('BEGIN');
        const result = await work(client, uploaded);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        for (const key of uploaded) {
            try {
                const result = await Services.storage.delete(key);
                if (result?.error)
                    console.error('Service image cleanup failed:', key);
            } catch {
                console.error('Service image cleanup failed:', key);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}
async function uploadMedia(fields, vendorId, uploaded) {
    const upload = async (image) => {
        const key = `services/${vendorId}/${randomUUID()}`;
        uploaded.push(key);
        const result = await Services.storage.upload(image, key);
        if (result?.error || !result?.url)
            throw serviceError('Unable to upload service image', 502);
        return result.url;
    };
    if (fields.thumbnail != null)
        fields.thumbnail = await upload(fields.thumbnail);
    if (fields.images !== undefined) {
        const urls = [];
        for (const image of fields.images) urls.push(await upload(image));
        fields.images = urls;
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
const RELATED_FIELDS = `v.store_name AS vendor_name, c.name AS category_name,
    sc.name AS subcategory_name, cc.name AS childcategory_name,
    cur.code AS currency, cur.code AS currency_code, cur.name AS currency_name`;
const SELECT = `SELECT s.*, ${RELATED_FIELDS}
    FROM services s LEFT JOIN vendors v ON v.id = s.vendor_id
    LEFT JOIN currencies cur ON cur.id = s.currency_id
    LEFT JOIN categories c ON c.id = s.category_id
    LEFT JOIN subcategories sc ON sc.id = s.subcategory_id
    LEFT JOIN childcategories cc ON cc.id = s.childcategory_id`;

const PUBLIC_FROM = `services s JOIN vendors v ON v.id = s.vendor_id
    JOIN currencies cur ON cur.id = s.currency_id
    LEFT JOIN categories c ON c.id = s.category_id
    LEFT JOIN subcategories sc ON sc.id = s.subcategory_id
    LEFT JOIN childcategories cc ON cc.id = s.childcategory_id`;
const PUBLIC_SELECT = `SELECT s.id, s.vendor_id, s.slug,
    ${FIELDS.map((field) => `s.${field}`).join(', ')}, s.created_at, s.updated_at,
    ${RELATED_FIELDS} FROM ${PUBLIC_FROM}`;
const PUBLIC_WHERE = [
    "s.status = 'active'",
    's.deleted_at IS NULL',
    "v.status = 'active'",
    'cur.status = true',
];

export class Services {
    static storage = { upload: S3upload, delete: S3delete };
    static async create(vendorId, data) {
        requireVendor(vendorId);
        return transaction(async (client, uploaded) => {
            const fields = normalizeServiceState(pick(data), {}, true);
            if (!fields.category_id) throw serviceError('Category is required');
            await validateRelations(client, fields);
            await uploadMedia(fields, vendorId, uploaded);
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
        return transaction(async (client, uploaded) => {
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
            await uploadMedia(fields, vendorId, uploaded);
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
        return this.#list(
            filters,
            ['s.vendor_id = $1', 's.deleted_at IS NULL'],
            [vendorId]
        );
    }
    static async readPublic(filters = {}) {
        return this.#list(
            filters,
            [...PUBLIC_WHERE],
            [],
            PUBLIC_SELECT,
            PUBLIC_FROM
        );
    }
    static async viewPublic(id) {
        const { rows } = await pool.query(
            `${PUBLIC_SELECT} WHERE ${PUBLIC_WHERE.join(' AND ')} AND s.id = $1 LIMIT 1`,
            [id]
        );
        return rows[0] ?? null;
    }
    static async #list(
        filters,
        where,
        values,
        select = SELECT,
        from = 'services s'
    ) {
        const limit = Math.min(
            50,
            Math.max(1, Math.trunc(Number(filters.limit) || 20))
        );
        const offset = Math.max(0, Math.trunc(Number(filters.offset) || 0));
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
                `${select} ${clause} ORDER BY s.${column} ${direction}, s.id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
                [...values, limit, offset]
            ),
            pool.query(
                `SELECT COUNT(*)::int AS total FROM ${from} ${clause}`,
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
