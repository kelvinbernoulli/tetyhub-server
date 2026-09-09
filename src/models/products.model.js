import pool from '#services/pg_pool.js';
import { S3upload, S3delete } from '#services/s3bucket.js';
import { randomUUID } from 'node:crypto';
import slugify from 'slugify';
import { productObjectKey } from '#utils/product-media.js';
const PRODUCT_FIELDS = [
    'category_id',
    'subcategory_id',
    'childcategory_id',
    'name',
    'sku',
    'barcode',
    'description',
    'short_description',
    'brand',
    'tags',
    'price',
    'compare_at_price',
    'cost_price',
    'discount',
    'stock',
    'low_stock_threshold',
    'track_inventory',
    'weight',
    'length',
    'width',
    'height',
    'free_shipping',
    'status',
    'is_featured',
    'is_digital',
    'meta_title',
    'meta_description',
    'currency_id',
];
const VARIANT_FIELDS = [
    'sku',
    'barcode',
    'price',
    'compare_at_price',
    'cost_price',
    'stock',
    'low_stock_threshold',
    'weight',
];
const PUBLIC_FIELDS = [
    'id',
    'vendor_id',
    'category_id',
    'subcategory_id',
    'childcategory_id',
    'name',
    'slug',
    'sku',
    'barcode',
    'description',
    'short_description',
    'brand',
    'tags',
    'price',
    'currency_id',
    'compare_at_price',
    'discount',
    'stock',
    'track_inventory',
    'has_variants',
    'thumbnail',
    'weight',
    'length',
    'width',
    'height',
    'free_shipping',
    'status',
    'is_featured',
    'is_digital',
    'meta_title',
    'meta_description',
    'created_at',
    'updated_at',
];
const pick = (data, fields) =>
    Object.fromEntries(
        fields.filter((k) => data[k] !== undefined).map((k) => [k, data[k]])
    );
export const productError = (message, status = 422) =>
    Object.assign(new Error(message), { status });
const requireVendor = (id) => {
    if (!Number.isInteger(Number(id)) || Number(id) < 1)
        throw productError('Vendor authentication required', 403);
};
const checkPrices = (data) => {
    if (
        data.compare_at_price != null &&
        Number(data.compare_at_price) < Number(data.price)
    )
        throw productError(
            'Compare At Price must be greater than or equal to Price'
        );
};
async function insert(client, table, data) {
    const keys = Object.keys(data);
    const { rows } = await client.query(
        'INSERT INTO ' +
            table +
            ' (' +
            keys.join(', ') +
            ') VALUES (' +
            keys.map((_, i) => '$' + (i + 1)).join(', ') +
            ') RETURNING *',
        Object.values(data)
    );
    return rows[0];
}
async function updateRow(client, table, id, data) {
    const keys = Object.keys(data);
    await client.query(
        'UPDATE ' +
            table +
            ' SET ' +
            keys.map((k, i) => k + ' = $' + (i + 1)).join(', ') +
            ', updated_at = NOW() WHERE id = $' +
            (keys.length + 1),
        [...Object.values(data), id]
    );
}
async function cleanup(files) {
    for (const file of new Set(files.filter(Boolean))) {
        try {
            const key = productObjectKey(file);
            for (let attempt = 0; attempt < 3; attempt++) {
                const result = await Product.storage.delete(key);
                if (!result?.error) break;
                if (attempt === 2)
                    console.error(
                        'Product file cleanup failed:',
                        key,
                        result.message
                    );
            }
        } catch (error) {
            console.error('Product file cleanup failed:', error.message);
        }
    }
}
async function upload(data, folder, state) {
    if (!data) return null;
    const key = 'products/' + folder + '/' + randomUUID();
    state.uploaded.push(key);
    const result = await Product.storage.upload(data, key);
    if (result.error) throw productError('Unable to upload product image', 502);
    return result.url;
}
async function transaction(work) {
    const client = await pool.connect();
    const state = { uploaded: [], obsolete: [] };
    let result;
    try {
        await client.query('BEGIN');
        result = await work(client, state);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        await cleanup(state.uploaded);
        throw error;
    } finally {
        client.release();
    }
    await cleanup(state.obsolete);
    return result;
}
async function validateRelations(client, data) {
    const category = await client.query(
        "SELECT id FROM categories WHERE id = $1 AND status = true AND type IN ('product', 'both')",
        [data.category_id]
    );
    if (!category.rows.length) throw productError('Invalid product category');
    if (data.subcategory_id != null) {
        const sub = await client.query(
            'SELECT id FROM subcategories WHERE id = $1 AND category_id = $2 AND status = true',
            [data.subcategory_id, data.category_id]
        );
        if (!sub.rows.length)
            throw productError(
                'Subcategory must belong to the selected category'
            );
    }
    if (data.childcategory_id != null) {
        if (data.subcategory_id == null)
            throw productError(
                'A subcategory is required for a child category'
            );
        const child = await client.query(
            'SELECT id FROM childcategories WHERE id = $1 AND subcategory_id = $2 AND status = true',
            [data.childcategory_id, data.subcategory_id]
        );
        if (!child.rows.length)
            throw productError(
                'Child category must belong to the selected subcategory'
            );
    }
    const currency = await client.query(
        'SELECT id FROM currencies WHERE id = $1',
        [data.currency_id]
    );
    if (!currency.rows.length) throw productError('Invalid currency');
}
async function saveCollections(client, productId, vendorId, data, state) {
    if (data.images !== undefined) {
        const old = await client.query(
            'SELECT url FROM product_images WHERE product_id = $1',
            [productId]
        );
        state.obsolete.push(...old.rows.map((r) => r.url));
        await client.query('DELETE FROM product_images WHERE product_id = $1', [
            productId,
        ]);
        for (const [position, image] of data.images.entries()) {
            const url = await upload(image, 'images', state);
            await insert(client, 'product_images', {
                product_id: productId,
                vendor_id: vendorId,
                url,
                position,
                is_primary: position === 0,
            });
        }
    }
    if (data.attributes !== undefined) {
        await client.query(
            'DELETE FROM product_attributes WHERE product_id = $1',
            [productId]
        );
        for (const [position, attr] of data.attributes.entries())
            await insert(client, 'product_attributes', {
                product_id: productId,
                name: attr.name,
                value: attr.value,
                position,
            });
    }
    // Preserve option IDs referenced by historical variants.
    for (const [position, option] of (data.options ?? []).entries()) {
        const old = await client.query(
            'SELECT id FROM product_options WHERE product_id = $1 AND name = $2',
            [productId, option.name]
        );
        const row =
            old.rows[0] ??
            (await insert(client, 'product_options', {
                product_id: productId,
                name: option.name,
                position,
            }));
        for (const [valuePosition, value] of option.values.entries()) {
            const found = await client.query(
                'SELECT id FROM product_option_values WHERE option_id = $1 AND value = $2',
                [row.id, value]
            );
            if (!found.rows.length)
                await insert(client, 'product_option_values', {
                    option_id: row.id,
                    value,
                    position: valuePosition,
                });
        }
    }
}
async function optionIds(client, productId, variant) {
    if (variant.option_values === undefined && variant.options === undefined)
        return undefined;
    const ids = [...(variant.option_values ?? [])];
    for (const [name, value] of Object.entries(variant.options ?? {})) {
        const found = await client.query(
            'SELECT pov.id FROM product_option_values pov JOIN product_options po ON po.id = pov.option_id WHERE po.product_id = $1 AND po.name = $2 AND pov.value = $3',
            [productId, name, value]
        );
        if (found.rows.length !== 1)
            throw productError('Invalid variant option mapping');
        ids.push(found.rows[0].id);
    }
    if (!ids.length) return [];
    const found = await client.query(
        'SELECT pov.id, pov.option_id FROM product_option_values pov JOIN product_options po ON po.id = pov.option_id WHERE po.product_id = $1 AND pov.id = ANY($2::int[])',
        [productId, ids]
    );
    if (
        found.rows.length !== ids.length ||
        new Set(found.rows.map((r) => r.option_id)).size !== ids.length
    )
        throw productError(
            'Variant options must belong to this product, with one value per option'
        );
    return ids;
}
async function saveVariants(client, productId, vendorId, data, state) {
    if (data.variants === undefined && data.has_variants !== false)
        return undefined;
    const variants = data.has_variants === false ? [] : (data.variants ?? []);
    if (data.has_variants === false && data.variants?.length)
        throw productError('Variants must be empty when has_variants is false');
    if (data.has_variants === true && !variants.length)
        throw productError('Add at least one variant');
    const old = await client.query(
        'SELECT * FROM product_variants WHERE product_id = $1 AND vendor_id = $2 FOR UPDATE',
        [productId, vendorId]
    );
    const byId = new Map(old.rows.map((r) => [Number(r.id), r]));
    const retained = [];
    for (const variant of variants) {
        const existing =
            variant.id == null ? null : byId.get(Number(variant.id));
        if (variant.id != null && !existing)
            throw productError('Variant does not belong to this product');
        if (retained.includes(Number(variant.id)))
            throw productError('Duplicate variant ID');
        const fields = pick(variant, VARIANT_FIELDS);
        checkPrices({ ...existing, ...fields });
        if (variant.image !== undefined) {
            fields.image = await upload(variant.image, 'variants', state);
            if (existing?.image) state.obsolete.push(existing.image);
        }
        let id;
        if (existing) {
            id = existing.id;
            await updateRow(client, 'product_variants', id, {
                ...fields,
                status: 'active',
            });
        } else {
            const row = await insert(client, 'product_variants', {
                product_id: productId,
                vendor_id: vendorId,
                ...fields,
                status: 'active',
            });
            id = row.id;
        }
        retained.push(Number(id));
        const ids = await optionIds(client, productId, variant);
        if (ids !== undefined) {
            await client.query(
                'DELETE FROM variant_option_values WHERE variant_id = $1',
                [id]
            );
            for (const option_value_id of ids)
                await insert(client, 'variant_option_values', {
                    variant_id: id,
                    option_value_id,
                });
        }
    }
    // Keep IDs used by carts and orders.
    await client.query(
        "UPDATE product_variants SET status = 'archived', updated_at = NOW() WHERE product_id = $1 AND vendor_id = $2 AND NOT (id = ANY($3::int[]))",
        [productId, vendorId, retained]
    );
    return retained.length > 0;
}
function selection(vendorView = false) {
    const variantFields = vendorView
        ? 'to_jsonb(pv)'
        : "to_jsonb(pv) - 'cost_price' - 'low_stock_threshold'";
    return (
        (vendorView ? 'p.*' : PUBLIC_FIELDS.map((k) => 'p.' + k).join(', ')) +
        `
 , c.name AS category_name, sc.name AS subcategory_name,
 COALESCE((SELECT jsonb_agg(to_jsonb(pi) ORDER BY pi.position,pi.id) FROM product_images pi WHERE pi.product_id=p.id),'[]'::jsonb) AS images,
 COALESCE((SELECT jsonb_agg(to_jsonb(pa) ORDER BY pa.position,pa.id) FROM product_attributes pa WHERE pa.product_id=p.id),'[]'::jsonb) AS attributes,
 COALESCE((SELECT jsonb_agg(to_jsonb(po) || jsonb_build_object('values',COALESCE((SELECT jsonb_agg(to_jsonb(pov) ORDER BY pov.position,pov.id) FROM product_option_values pov WHERE pov.option_id=po.id),'[]'::jsonb)) ORDER BY po.position,po.id) FROM product_options po WHERE po.product_id=p.id),'[]'::jsonb) AS options,
 COALESCE((SELECT jsonb_agg(` +
        variantFields +
        ` || jsonb_build_object('option_values',COALESCE((SELECT jsonb_agg(vov.option_value_id ORDER BY vov.option_value_id) FROM variant_option_values vov WHERE vov.variant_id=pv.id),'[]'::jsonb)) ORDER BY pv.id) FROM product_variants pv WHERE pv.product_id=p.id AND pv.status='active'),'[]'::jsonb) AS variants,
 (SELECT ROUND(AVG(r.rating),1) FROM reviews r WHERE r.product_id=p.id AND r.status='approved') AS avg_rating,
 (SELECT COUNT(*)::int FROM reviews r WHERE r.product_id=p.id AND r.status='approved') AS review_count,
 (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi WHERE oi.product_id=p.id) AS total_sold`
    );
}
const joins =
    'LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN subcategories sc ON sc.id = p.subcategory_id';
export class Product {
    static storage = { upload: S3upload, delete: S3delete };
    static async create(vendorId, data) {
        requireVendor(vendorId);
        return transaction(async (client, state) => {
            checkPrices(data);
            await validateRelations(client, data);
            if (data.has_variants === true && !data.variants?.length)
                throw productError('Add at least one variant');
            if (data.has_variants === false && data.variants?.length)
                throw productError(
                    'Variants must be empty when has_variants is false'
                );
            const fields = {
                vendor_id: vendorId,
                ...pick(data, PRODUCT_FIELDS),
                slug:
                    slugify(data.name, { lower: true, strict: true }) +
                    '-' +
                    randomUUID(),
                has_variants: Boolean(data.variants?.length),
            };
            if (data.thumbnail !== undefined)
                fields.thumbnail = await upload(
                    data.thumbnail,
                    'thumbnails',
                    state
                );
            const row = await insert(client, 'products', fields);
            await saveCollections(client, row.id, vendorId, data, state);
            await saveVariants(client, row.id, vendorId, data, state);
            return Product.findByKey(
                [{ key: 'id', value: row.id }],
                vendorId,
                client
            );
        });
    }
    static async update(productId, vendorId, data) {
        requireVendor(vendorId);
        return transaction(async (client, state) => {
            const { rows } = await client.query(
                'SELECT * FROM products WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL FOR UPDATE',
                [productId, vendorId]
            );
            if (!rows.length) return null;
            const existing = rows[0];
            checkPrices({ ...existing, ...data });
            await validateRelations(client, { ...existing, ...data });
            const fields = pick(data, PRODUCT_FIELDS);
            if (data.thumbnail !== undefined) {
                fields.thumbnail = await upload(
                    data.thumbnail,
                    'thumbnails',
                    state
                );
                if (existing.thumbnail) state.obsolete.push(existing.thumbnail);
            }
            await saveCollections(client, productId, vendorId, data, state);
            const hasVariants = await saveVariants(
                client,
                productId,
                vendorId,
                data,
                state
            );
            if (hasVariants !== undefined) fields.has_variants = hasVariants;
            if (Object.keys(fields).length)
                await updateRow(client, 'products', productId, fields);
            return Product.findByKey(
                [{ key: 'id', value: productId }],
                vendorId,
                client
            );
        });
    }
    static async delete(productId, vendorId) {
        requireVendor(vendorId);
        const { rows } = await pool.query(
            "UPDATE products SET deleted_at = NOW(), status = 'archived', updated_at = NOW() WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL RETURNING id",
            [productId, vendorId]
        );
        return rows[0] ?? null;
    }
    static async findByKey(conditions, vendorId, client = pool) {
        requireVendor(vendorId);
        if (!Array.isArray(conditions) || !conditions.length)
            throw productError('Product lookup conditions are required');
        const values = [],
            where = ['p.deleted_at IS NULL'];
        for (const { key, value } of conditions) {
            if (!['id', 'slug'].includes(key))
                throw productError('Unsupported product lookup');
            values.push(value);
            where.push('p.' + key + ' = $' + values.length);
        }
        values.push(vendorId);
        where.push('p.vendor_id = $' + values.length);
        const { rows } = await client.query(
            'SELECT ' +
                selection(true) +
                ' FROM products p ' +
                joins +
                ' WHERE ' +
                where.join(' AND ') +
                ' LIMIT 1',
            values
        );
        return rows[0] ?? null;
    }
    static async findById(id, vendorId) {
        return Product.findByKey([{ key: 'id', value: id }], vendorId);
    }
    static async findPublicById(id) {
        const { rows } = await pool.query(
            'SELECT ' +
                selection() +
                ' FROM products p ' +
                joins +
                " WHERE p.id = $1 AND p.status = 'active' AND p.deleted_at IS NULL LIMIT 1",
            [id]
        );
        return rows[0] ?? null;
    }
    static async list(filters = {}, vendorId = null) {
        if (vendorId !== null) requireVendor(vendorId);
        const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20)),
            offset = Math.max(0, Number(filters.offset) || 0);
        const values = [],
            where = ['p.deleted_at IS NULL'];
        const bind = (clause, value) => {
            values.push(value);
            where.push(clause.replaceAll('?', '$' + values.length));
        };
        if (vendorId !== null) bind('p.vendor_id = ?', vendorId);
        else {
            where.push("p.status = 'active'");
            if (filters.vendor_id !== undefined)
                bind('p.vendor_id = ?', filters.vendor_id);
        }
        if (filters.status !== undefined && vendorId !== null)
            bind('p.status = ?', filters.status);
        for (const key of [
            'category_id',
            'subcategory_id',
            'childcategory_id',
            'is_featured',
            'is_digital',
        ])
            if (filters[key] !== undefined)
                bind('p.' + key + ' = ?', filters[key]);
        if (filters.q || filters.search)
            bind(
                '(p.name ILIKE ? OR p.description ILIKE ? OR p.brand ILIKE ?)',
                '%' + (filters.q || filters.search) + '%'
            );
        if (filters.brand) bind('p.brand ILIKE ?', '%' + filters.brand + '%');
        if (filters.min_price !== undefined)
            bind('p.price >= ?', filters.min_price);
        if (filters.max_price !== undefined)
            bind('p.price <= ?', filters.max_price);
        if (filters.tags?.length) bind('p.tags && ?::text[]', filters.tags);
        if (filters.in_stock !== undefined) {
            const available =
                "(NOT p.track_inventory OR (CASE WHEN p.has_variants THEN EXISTS (SELECT 1 FROM product_variants sv WHERE sv.product_id = p.id AND sv.status = 'active' AND sv.stock > 0) ELSE p.stock > 0 END))";
            where.push(filters.in_stock ? available : 'NOT ' + available);
        }
        if (filters.related) {
            bind('p.id <> ?', filters.related.id);
            values.push(
                filters.related.category_id,
                filters.related.tags ?? []
            );
            where.push(
                '(p.category_id = $' +
                    (values.length - 1) +
                    ' OR p.tags && $' +
                    values.length +
                    '::text[])'
            );
        }
        const sorting = {
            price_asc: 'p.price ASC',
            price_desc: 'p.price DESC',
            newest: 'p.created_at DESC',
            oldest: 'p.created_at ASC',
            popular: 'total_sold DESC',
            rating: 'avg_rating DESC NULLS LAST',
        };
        const column = [
            'created_at',
            'updated_at',
            'name',
            'price',
            'stock',
        ].includes(filters.sort_by)
            ? filters.sort_by
            : 'created_at';
        const direction = filters.sort_order === 'ASC' ? 'ASC' : 'DESC';
        const order =
            sorting[filters.sort_by] ?? 'p.' + column + ' ' + direction;
        const clause = where.join(' AND ');
        const count = await pool.query(
            'SELECT COUNT(*)::int AS total FROM products p WHERE ' + clause,
            values
        );
        const { rows } = await pool.query(
            'SELECT ' +
                selection(vendorId !== null) +
                ' FROM products p ' +
                joins +
                ' WHERE ' +
                clause +
                ' ORDER BY ' +
                order +
                ', p.id DESC LIMIT $' +
                (values.length + 1) +
                ' OFFSET $' +
                (values.length + 2),
            [...values, limit, offset]
        );
        const total = Number(count.rows[0].total),
            page = Math.floor(offset / limit) + 1;
        return {
            data: rows,
            pagination: {
                total,
                offset,
                page,
                limit,
                total_pages: Math.ceil(total / limit),
                has_next_page: offset + limit < total,
                has_prev_page: offset > 0,
            },
        };
    }
    static async fetchAll(offset = 0, limit = 20, filters = {}) {
        return Product.list({ ...filters, offset, limit });
    }
    static async findAllByVendor(vendorId, filters = {}) {
        requireVendor(vendorId);
        return Product.list(
            {
                ...filters,
                offset:
                    filters.offset ??
                    ((filters.page ?? 1) - 1) * (filters.limit ?? 20),
            },
            vendorId
        );
    }
    static async search(vendorId, filters = {}) {
        const result = await Product.list(filters, vendorId);
        return {
            products: result.data,
            pagination: {
                ...result.pagination,
                has_more: result.pagination.has_next_page,
            },
        };
    }
    static async getFilters(vendorId = null) {
        if (vendorId !== null) requireVendor(vendorId);
        const { rows } = await pool.query(
            `SELECT MIN(p.price) AS min_price,MAX(p.price) AS max_price,
   COALESCE(array_agg(DISTINCT p.brand) FILTER (WHERE p.brand IS NOT NULL),'{}'::text[]) AS brands,
   COALESCE(array_agg(DISTINCT tag) FILTER (WHERE tag IS NOT NULL),'{}'::text[]) AS tags,
   COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',c.id,'name',c.name)) FILTER (WHERE c.id IS NOT NULL),'[]'::jsonb) AS categories
   FROM products p LEFT JOIN categories c ON c.id=p.category_id LEFT JOIN LATERAL unnest(p.tags) tag ON true
   WHERE p.status='active' AND p.deleted_at IS NULL ` +
                (vendorId !== null ? 'AND p.vendor_id = $1' : ''),
            vendorId !== null ? [vendorId] : []
        );
        return rows[0];
    }
    static async getRelatedProducts(productId, limit = 8) {
        const source = await Product.findPublicById(productId);
        if (!source) return null;
        return (
            await Product.list({
                limit,
                vendor_id: source.vendor_id,
                related: source,
            })
        ).data;
    }
    static async getFeaturedProducts(limit = 10, vendorId = null) {
        return (
            await Product.list({
                limit,
                is_featured: true,
                ...(vendorId !== null ? { vendor_id: vendorId } : {}),
            })
        ).data;
    }
}
export default Product;
