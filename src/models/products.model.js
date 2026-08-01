import pool from "#services/pg_pool.js";
import { getBase64Extension, S3delete, S3upload } from "#services/s3bucket.js";
import crypto from "crypto";
import slugify from "slugify";

export class Product {
    static async create(vendorId, data) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const {
                name, description, short_description, brand, tags,
                category_id, subcategory_id, price, compare_at_price, cost_price, discount,
                stock, low_stock_threshold, track_inventory,
                thumbnail, images,
                weight, length, width, height, free_shipping,
                attributes, options, variants,
                status, is_featured, is_digital,
                meta_title, meta_description, slug, currency
            } = data;

            // Generate slug
            const productSlug = slug
                ? slug.toLowerCase().replace(/\s+/g, '-')
                : slugify(name, { lower: true }) + '-' + Date.now();

            // Upload thumbnail to S3
            let thumbnailUrl = null;
            if (thumbnail) {
                const filename = `images/products/thumbnails/${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const result = await S3upload(thumbnail, filename);

                if (result.error) {
                    throw new Error(`Failed to upload thumbnail: ${result.message}`);
                }

                thumbnailUrl = result.url;
            }

            const hasVariants = variants && variants.length > 0;

            // 1. Insert product
            const { rows: productRows } = await client.query(
                `INSERT INTO products (
                vendor_id, category_id, subcategory_id, name, slug, description,
                short_description, brand, tags, price, compare_at_price,
                cost_price, discount, stock, low_stock_threshold,
                track_inventory, has_variants, thumbnail, weight,
                length, width, height, free_shipping, status,
                is_featured, is_digital, meta_title, meta_description, currency
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18,
                $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29
            ) RETURNING *`,
                [
                    vendorId, category_id, subcategory_id ?? null,
                    name, productSlug, description ?? null,
                    short_description ?? null, brand ?? null,
                    tags ?? [], price, compare_at_price ?? null,
                    cost_price ?? null, discount ?? 0,
                    stock, low_stock_threshold ?? 10,
                    track_inventory ?? true, hasVariants,
                    thumbnailUrl, weight ?? null,
                    length ?? null, width ?? null,
                    height ?? null, free_shipping ?? false,
                    status ?? 'draft', is_featured ?? false,
                    is_digital ?? false, meta_title ?? null,
                    meta_description ?? null, currency
                ]
            );

            const product = productRows[0];

            // 2. Upload and insert images
            if (images && images.length > 0) {
                const imageUrls = [];

                for (let i = 0; i < images.length; i++) {
                    const image = images[i];
                    const filename = `products/images/${product.id}-${i}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

                    const result = await S3upload(image, filename);

                    if (result.error) {
                        throw new Error(`Failed to upload image ${i}: ${result.message}`);
                    }

                    imageUrls.push(result.url);
                }

                // Insert into database
                for (let i = 0; i < imageUrls.length; i++) {
                    await client.query(
                        `INSERT INTO product_images (product_id, vendor_id, url, position, is_primary)
                        VALUES ($1, $2, $3, $4, $5)`,
                        [product.id, vendorId, imageUrls[i], i, i === 0]
                    );
                }
            }

            // 3. Insert attributes
            if (attributes && attributes.length > 0) {
                for (let i = 0; i < attributes.length; i++) {
                    await client.query(
                        `INSERT INTO product_attributes (product_id, name, value, position)
                        VALUES ($1, $2, $3, $4)`,
                        [product.id, attributes[i].name, attributes[i].value, i]
                    );
                }
            }

            // 4. Insert options and option values
            const optionValueMap = {};
            if (options && options.length > 0) {
                for (let i = 0; i < options.length; i++) {
                    const option = options[i];

                    const { rows: optionRows } = await client.query(
                        `INSERT INTO product_options (product_id, name, position)
                    VALUES ($1, $2, $3) RETURNING id`,
                        [product.id, option.name, i]
                    );

                    const optionId = optionRows[0].id;

                    for (let j = 0; j < option.values.length; j++) {
                        const { rows: valueRows } = await client.query(
                            `INSERT INTO product_option_values (option_id, value, position)
                        VALUES ($1, $2, $3) RETURNING id`,
                            [optionId, option.values[j], j]
                        );
                        optionValueMap[`${option.name}:${option.values[j]}`] = valueRows[0].id;
                    }
                }
            }

            // 5. Insert variants
            if (hasVariants) {
                for (const variant of variants) {
                    let variantImageUrl = null;

                    if (variant.image) {
                        const filename = `products/variants/${product.id}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                        const result = await S3upload(variant.image, filename);

                        if (result.error) {
                            throw new Error(`Failed to upload variant image: ${result.message}`);
                        }

                        variantImageUrl = result.url;
                    }

                    const { rows: variantRows } = await client.query(
                        `INSERT INTO product_variants (
                        product_id, sku, barcode, price, compare_at_price,
                        cost_price, stock, low_stock_threshold, weight, image
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    RETURNING id`,
                        [
                            product.id, variant.sku ?? null,
                            variant.barcode ?? null, variant.price,
                            variant.compare_at_price ?? null,
                            variant.cost_price ?? null, variant.stock,
                            variant.low_stock_threshold ?? 5,
                            variant.weight ?? null, variantImageUrl
                        ]
                    );

                    const variantId = variantRows[0].id;

                    for (const optionValueId of variant.option_values) {
                        await client.query(
                            `INSERT INTO variant_option_values (variant_id, option_value_id)
                        VALUES ($1, $2)`,
                            [variantId, optionValueId]
                        );
                    }
                }
            }

            await client.query('COMMIT');

            // Return full product
            return await Product.findByKey(
                [{ key: 'id', value: product.id }],
                vendorId
            );

        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error creating product:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async findByKey(conditions, vendorId) {
        try {
            if (!vendorId) {
                throw new Error('Vendor ID is required');
            }

            if (!Array.isArray(conditions) || conditions.length === 0) {
                throw new Error('conditions must be a non-empty array');
            }

            let paramIndex = 1;
            const whereClauses = [];
            const values = [];

            // Build dynamic conditions
            for (const condition of conditions) {
                if (condition.value === null || condition.value === undefined) {
                    whereClauses.push(`p.${condition.key} IS NULL`);
                } else {
                    whereClauses.push(`p.${condition.key} = $${paramIndex++}`);
                    values.push(condition.value);
                }
            }

            // Always scope to vendor
            whereClauses.push(`p.vendor_id = $${paramIndex++}`);
            values.push(vendorId);
            whereClauses.push(`p.deleted_at IS NULL`);

            const query = `
                SELECT
                    p.*,
                    c.name                          AS category_name,
                    pc.name                         AS subcategory_name,
                    json_agg(DISTINCT jsonb_build_object(
                        'id', pi.id,
                        'url', pi.url,
                        'alt_text', pi.alt_text,
                        'position', pi.position,
                        'is_primary', pi.is_primary
                    )) FILTER (WHERE pi.id IS NOT NULL) AS images,
                    json_agg(DISTINCT jsonb_build_object(
                        'id', pa.id,
                        'name', pa.name,
                        'value', pa.value
                    )) FILTER (WHERE pa.id IS NOT NULL) AS attributes,
                    json_agg(DISTINCT jsonb_build_object(
                        'id', po.id,
                        'name', po.name,
                        'position', po.position,
                        'values', (
                            SELECT json_agg(jsonb_build_object(
                                'id', pov.id,
                                'value', pov.value
                            ) ORDER BY pov.position)
                            FROM product_option_values pov
                            WHERE pov.option_id = po.id
                        )
                    )) FILTER (WHERE po.id IS NOT NULL) AS options,
                    json_agg(DISTINCT jsonb_build_object(
                        'id', pv.id,
                        'sku', pv.sku,
                        'price', pv.price,
                        'stock', pv.stock,
                        'image', pv.image,
                        'status', pv.status
                    )) FILTER (WHERE pv.id IS NOT NULL) AS variants
                FROM products p
                LEFT JOIN categories c ON c.id = p.category_id
                LEFT JOIN categories pc ON pc.id = p.subcategory_id  -- subcategory is just a category
                LEFT JOIN product_images pi ON pi.product_id = p.id
                LEFT JOIN product_attributes pa ON pa.product_id = p.id
                LEFT JOIN product_options po ON po.product_id = p.id
                LEFT JOIN product_variants pv ON pv.product_id = p.id
                WHERE ${whereClauses.join(' AND ')}
                GROUP BY p.id, c.id, pc.id
                LIMIT 1
            `;

            const { rows } = await pool.query(query, values);
            return rows[0] ?? null;
        } catch (error) {
            console.error("Error finding product by key:", error);
            throw error;
        }
    }

    static async update(productId, vendorId, data) {
        const client = await pool.connect();

        // Files uploaded during this request
        const uploadedFiles = [];

        // Old files to delete AFTER successful commit
        const oldFilesToDelete = [];

        try {
            await client.query('BEGIN');

            const {
                name,
                description,
                short_description,
                brand,
                tags,
                category_id,
                subcategory_id,
                price,
                compare_at_price,
                cost_price,
                discount,
                stock,
                low_stock_threshold,
                track_inventory,
                thumbnail,
                images,
                weight,
                length,
                width,
                height,
                free_shipping,
                attributes,
                options,
                variants,
                status,
                is_featured,
                is_digital,
                meta_title,
                meta_description
            } = data;

            /*
            |--------------------------------------------------------------------------
            | Validate Product Ownership
            |--------------------------------------------------------------------------
            */

            const { rows: existingRows } = await client.query(
                `
            SELECT *
            FROM products
            WHERE id = $1
            AND vendor_id = $2
            AND deleted_at IS NULL
            LIMIT 1
            `,
                [productId, vendorId]
            );

            if (!existingRows.length) {
                await client.query('ROLLBACK');
                return null;
            }

            const existingProduct = existingRows[0];

            /*
            |--------------------------------------------------------------------------
            | Basic Validation
            |--------------------------------------------------------------------------
            */

            if (price !== undefined && price < 0) {
                throw new Error("Price cannot be negative");
            }

            if (stock !== undefined && stock < 0) {
                throw new Error("Stock cannot be negative");
            }

            if (
                discount !== undefined &&
                (discount < 0 || discount > 100)
            ) {
                throw new Error("Discount must be between 0 and 100");
            }

            /*
            |--------------------------------------------------------------------------
            | Generate Slug
            |--------------------------------------------------------------------------
            */

            let productSlug = existingProduct.slug;

            if (name !== undefined) {
                productSlug = `${slugify(name, {
                    lower: true,
                    strict: true
                })}-${Date.now()}`;
            }

            /*
            |--------------------------------------------------------------------------
            | Upload Thumbnail
            |--------------------------------------------------------------------------
            */

            let thumbnailUrl = existingProduct.thumbnail;

            if (thumbnail !== undefined) {
                // Upload new thumbnail
                if (thumbnail) {
                    const filename = `products/thumbnails/${vendorId}-${crypto.randomUUID()}`;

                    const upload = await S3upload(
                        thumbnail,
                        filename
                    );

                    if (upload.error) {
                        throw new Error(upload.message);
                    }

                    thumbnailUrl = upload.url;

                    uploadedFiles.push(upload.url);
                } else {
                    // Allow thumbnail removal
                    thumbnailUrl = null;
                }

                // Delete old thumbnail after commit
                if (existingProduct.thumbnail) {
                    oldFilesToDelete.push(existingProduct.thumbnail);
                }
            }

            /*
            |--------------------------------------------------------------------------
            | Variants State
            |--------------------------------------------------------------------------
            */

            const hasVariants =
                variants !== undefined
                    ? variants.length > 0
                    : existingProduct.has_variants;

            /*
            |--------------------------------------------------------------------------
            | Dynamic Product Update
            |--------------------------------------------------------------------------
            */

            const fields = [];
            const values = [];
            let index = 1;

            const addField = (field, value) => {
                fields.push(`${field} = $${index++}`);
                values.push(value);
            };

            if (category_id !== undefined) {
                addField("category_id", category_id);
            }

            if (subcategory_id !== undefined) {
                addField("subcategory_id", subcategory_id);
            }

            if (name !== undefined) {
                addField("name", name);
            }

            addField("slug", productSlug);

            if (description !== undefined) {
                addField("description", description);
            }

            if (short_description !== undefined) {
                addField("short_description", short_description);
            }

            if (brand !== undefined) {
                addField("brand", brand);
            }

            if (tags !== undefined) {
                addField("tags", tags);
            }

            if (price !== undefined) {
                addField("price", price);
            }

            if (compare_at_price !== undefined) {
                addField("compare_at_price", compare_at_price);
            }

            if (cost_price !== undefined) {
                addField("cost_price", cost_price);
            }

            if (discount !== undefined) {
                addField("discount", discount);
            }

            if (stock !== undefined) {
                addField("stock", stock);
            }

            if (low_stock_threshold !== undefined) {
                addField(
                    "low_stock_threshold",
                    low_stock_threshold
                );
            }

            if (track_inventory !== undefined) {
                addField("track_inventory", track_inventory);
            }

            addField("has_variants", hasVariants);

            if (thumbnail !== undefined) {
                addField("thumbnail", thumbnailUrl);
            }

            if (weight !== undefined) {
                addField("weight", weight);
            }

            if (length !== undefined) {
                addField("length", length);
            }

            if (width !== undefined) {
                addField("width", width);
            }

            if (height !== undefined) {
                addField("height", height);
            }

            if (free_shipping !== undefined) {
                addField("free_shipping", free_shipping);
            }

            if (status !== undefined) {
                addField("status", status);
            }

            if (is_featured !== undefined) {
                addField("is_featured", is_featured);
            }

            if (is_digital !== undefined) {
                addField("is_digital", is_digital);
            }

            if (meta_title !== undefined) {
                addField("meta_title", meta_title);
            }

            if (meta_description !== undefined) {
                addField("meta_description", meta_description);
            }

            fields.push(`updated_at = NOW()`);

            values.push(productId, vendorId);

            const updateQuery = `
            UPDATE products
            SET ${fields.join(", ")}
            WHERE id = $${index++}
            AND vendor_id = $${index++}
            AND deleted_at IS NULL
            RETURNING *
        `;

            const { rows: updatedRows } = await client.query(
                updateQuery,
                values
            );

            const updatedProduct = updatedRows[0];

            /*
            |--------------------------------------------------------------------------
            | Update Images
            |--------------------------------------------------------------------------
            */

            if (images !== undefined) {

                // Fetch old images
                const { rows: oldImages } = await client.query(
                    `
                SELECT url
                FROM product_images
                WHERE product_id = $1
                `,
                    [productId]
                );

                oldImages.forEach(img => {
                    if (img.url) {
                        oldFilesToDelete.push(img.url);
                    }
                });

                // Delete old DB records
                await client.query(
                    `
                DELETE FROM product_images
                WHERE product_id = $1
                `,
                    [productId]
                );

                // Insert new images
                if (images.length) {
                    for (let i = 0; i < images.length; i++) {

                        const filename = `products/images/${productId}-${crypto.randomUUID()}`;

                        const upload = await S3upload(
                            images[i],
                            filename
                        );

                        if (upload.error) {
                            throw new Error(upload.message);
                        }

                        uploadedFiles.push(upload.url);

                        await client.query(
                            `
                        INSERT INTO product_images (
                            product_id,
                            vendor_id,
                            url,
                            position,
                            is_primary
                        )
                        VALUES ($1, $2, $3, $4, $5)
                        `,
                            [
                                productId,
                                vendorId,
                                upload.url,
                                i,
                                i === 0
                            ]
                        );
                    }
                }
            }

            /*
            |--------------------------------------------------------------------------
            | Update Attributes
            |--------------------------------------------------------------------------
            */

            if (attributes !== undefined) {

                await client.query(
                    `
                DELETE FROM product_attributes
                WHERE product_id = $1
                `,
                    [productId]
                );

                if (attributes.length) {
                    for (let i = 0; i < attributes.length; i++) {

                        const attr = attributes[i];

                        await client.query(
                            `
                        INSERT INTO product_attributes (
                            product_id,
                            name,
                            value,
                            position
                        )
                        VALUES ($1, $2, $3, $4)
                        `,
                            [
                                productId,
                                attr.name,
                                attr.value,
                                i
                            ]
                        );
                    }
                }
            }

            /*
            |--------------------------------------------------------------------------
            | Update Options
            |--------------------------------------------------------------------------
            */

            const optionMap = {};

            if (options !== undefined) {

                await client.query(
                    `
                DELETE FROM product_options
                WHERE product_id = $1
                `,
                    [productId]
                );

                for (const option of options || []) {

                    const { rows: optionRows } = await client.query(
                        `
                    INSERT INTO product_options (
                        product_id,
                        name
                    )
                    VALUES ($1, $2)
                    RETURNING id
                    `,
                        [productId, option.name]
                    );

                    const optionId = optionRows[0].id;

                    optionMap[option.name] = {};

                    for (const value of option.values) {

                        const { rows: valueRows } = await client.query(
                            `
                        INSERT INTO product_option_values (
                            option_id,
                            value
                        )
                        VALUES ($1, $2)
                        RETURNING id
                        `,
                            [optionId, value]
                        );

                        optionMap[option.name][value] =
                            valueRows[0].id;
                    }
                }
            }

            /*
            |--------------------------------------------------------------------------
            | Update Variants
            |--------------------------------------------------------------------------
            */

            if (variants !== undefined) {

                const { rows: oldVariants } = await client.query(
                    `
                SELECT image
                FROM product_variants
                WHERE product_id = $1
                AND image IS NOT NULL
                `,
                    [productId]
                );

                oldVariants.forEach(v => {
                    if (v.image) {
                        oldFilesToDelete.push(v.image);
                    }
                });

                await client.query(
                    `
                DELETE FROM product_variants
                WHERE product_id = $1
                `,
                    [productId]
                );

                if (variants.length) {

                    for (const variant of variants) {

                        if (variant.price < 0) {
                            throw new Error(
                                "Variant price cannot be negative"
                            );
                        }

                        if (variant.stock < 0) {
                            throw new Error(
                                "Variant stock cannot be negative"
                            );
                        }

                        let variantImageUrl = null;

                        if (variant.image) {

                            const filename = `products/variants/${productId}-${crypto.randomUUID()}`;

                            const upload = await S3upload(
                                variant.image,
                                filename
                            );

                            if (upload.error) {
                                throw new Error(upload.message);
                            }

                            variantImageUrl = upload.url;

                            uploadedFiles.push(upload.url);
                        }

                        const { rows: variantRows } =
                            await client.query(
                                `
                            INSERT INTO product_variants (
                                product_id,
                                vendor_id,
                                sku,
                                barcode,
                                price,
                                compare_at_price,
                                cost_price,
                                stock,
                                low_stock_threshold,
                                weight,
                                image
                            )
                            VALUES (
                                $1, $2, $3, $4, $5,
                                $6, $7, $8, $9, $10, $11
                            )
                            RETURNING id
                            `,
                                [
                                    productId,
                                    vendorId,
                                    variant.sku ?? null,
                                    variant.barcode ?? null,
                                    variant.price,
                                    variant.compare_at_price ?? null,
                                    variant.cost_price ?? null,
                                    variant.stock,
                                    variant.low_stock_threshold ?? 5,
                                    variant.weight ?? null,
                                    variantImageUrl
                                ]
                            );

                        const variantId = variantRows[0].id;

                        if (variant.options) {

                            for (const [
                                optionName,
                                optionValue
                            ] of Object.entries(
                                variant.options
                            )) {

                                const optionValueId =
                                    optionMap?.[optionName]?.[
                                    optionValue
                                    ];

                                if (!optionValueId) {
                                    throw new Error(
                                        `Invalid option mapping: ${optionName} -> ${optionValue}`
                                    );
                                }

                                await client.query(
                                    `
                                INSERT INTO variant_option_values (
                                    variant_id,
                                    option_value_id
                                )
                                VALUES ($1, $2)
                                `,
                                    [
                                        variantId,
                                        optionValueId
                                    ]
                                );
                            }
                        }
                    }
                }
            }

            /*
            |--------------------------------------------------------------------------
            | Commit
            |--------------------------------------------------------------------------
            */

            await client.query('COMMIT');

            /*
            |--------------------------------------------------------------------------
            | Delete Old S3 Files AFTER Commit
            |--------------------------------------------------------------------------
            */

            await Promise.allSettled(
                oldFilesToDelete.map(file =>
                    S3delete(file)
                )
            );

            return await Product.findByKey(
                [{ key: 'id', value: updatedProduct.id }],
                vendorId
            );

        } catch (error) {

            await client.query('ROLLBACK');

            /*
            |--------------------------------------------------------------------------
            | Cleanup Newly Uploaded Files
            |--------------------------------------------------------------------------
            */

            await Promise.allSettled(
                uploadedFiles.map(file =>
                    S3delete(file)
                )
            );

            console.error(
                "Error updating product:",
                error
            );

            throw error;

        } finally {
            client.release();
        }
    }

    static async findAllByVendor(vendorId, filters = {}) {
        const client = await pool.connect();

        try {

            const {
                page = 1,
                limit = 20,
                search,
                category_id,
                subcategory_id,
                status,
                is_featured,
                is_digital,
                min_price,
                max_price,
                sort_by = "created_at",
                sort_order = "DESC"
            } = filters;

            const offset = (page - 1) * limit;

            /*
            |--------------------------------------------------------------------------
            | Allowed Sort Columns
            |--------------------------------------------------------------------------
            */

            const allowedSortColumns = [
                "created_at",
                "updated_at",
                "name",
                "price",
                "stock"
            ];

            const allowedSortOrders = ["ASC", "DESC"];

            const finalSortBy = allowedSortColumns.includes(sort_by)
                ? sort_by
                : "created_at";

            const finalSortOrder = allowedSortOrders.includes(
                sort_order.toUpperCase()
            )
                ? sort_order.toUpperCase()
                : "DESC";

            /*
            |--------------------------------------------------------------------------
            | Build WHERE Conditions
            |--------------------------------------------------------------------------
            */

            const conditions = [
                `p.vendor_id = $1`,
                `p.deleted_at IS NULL`
            ];

            const values = [vendorId];

            let index = 2;

            // Search
            if (search) {
                conditions.push(`
                (
                    p.name ILIKE $${index}
                    OR p.description ILIKE $${index}
                    OR p.brand ILIKE $${index}
                )
            `);

                values.push(`%${search}%`);
                index++;
            }

            // Category
            if (category_id) {
                conditions.push(`p.category_id = $${index}`);
                values.push(category_id);
                index++;
            }

            // Subcategory
            if (subcategory_id) {
                conditions.push(`p.subcategory_id = $${index}`);
                values.push(subcategory_id);
                index++;
            }

            // Status
            if (status) {
                conditions.push(`p.status = $${index}`);
                values.push(status);
                index++;
            }

            // Featured
            if (is_featured !== undefined) {
                conditions.push(`p.is_featured = $${index}`);
                values.push(is_featured);
                index++;
            }

            // Digital
            if (is_digital !== undefined) {
                conditions.push(`p.is_digital = $${index}`);
                values.push(is_digital);
                index++;
            }

            // Min Price
            if (min_price !== undefined) {
                conditions.push(`p.price >= $${index}`);
                values.push(min_price);
                index++;
            }

            // Max Price
            if (max_price !== undefined) {
                conditions.push(`p.price <= $${index}`);
                values.push(max_price);
                index++;
            }

            /*
            |--------------------------------------------------------------------------
            | Total Count Query
            |--------------------------------------------------------------------------
            */

            const countQuery = `
                SELECT COUNT(*)::INTEGER AS total
                FROM products p
                WHERE ${conditions.join(" AND ")}
            `;

            const { rows: countRows } = await client.query(
                countQuery,
                values
            );

            const total = countRows[0].total;

            /*
            |--------------------------------------------------------------------------
            | Main Query
            |--------------------------------------------------------------------------
            */

            values.push(limit, offset);

            const query = `
            SELECT
                p.id,
                p.vendor_id,
                p.category_id,
                p.subcategory_id,
                p.name,
                p.slug,
                p.description,
                p.short_description,
                p.brand,
                p.tags,
                p.price,
                p.currency,
                p.compare_at_price,
                p.cost_price,
                p.discount,
                p.stock,
                p.low_stock_threshold,
                p.track_inventory,
                p.has_variants,
                p.thumbnail,
                p.weight,
                p.length,
                p.width,
                p.height,
                p.free_shipping,
                p.status,
                p.is_featured,
                p.is_digital,
                p.meta_title,
                p.meta_description,
                p.created_at,
                p.updated_at,

                c.name AS category_name,
                sc.name AS subcategory_name,

                (
                    SELECT COUNT(*)
                    FROM product_images pi
                    WHERE pi.product_id = p.id
                )::INTEGER AS image_count,

                (
                    SELECT COALESCE(
                        JSON_AGG(
                            JSON_BUILD_OBJECT(
                                'id', pi.id,
                                'url', pi.url,
                                'position', pi.position,
                                'is_primary', pi.is_primary
                            )
                            ORDER BY pi.position ASC
                        ),
                        '[]'
                    )
                    FROM product_images pi
                    WHERE pi.product_id = p.id
                ) AS images

            FROM products p

            LEFT JOIN categories c
                ON c.id = p.category_id

            LEFT JOIN categories sc
                ON sc.id = p.subcategory_id

            WHERE ${conditions.join(" AND ")}

            ORDER BY p.${finalSortBy} ${finalSortOrder}

            LIMIT $${index}
            OFFSET $${index + 1}
        `;

            const { rows } = await client.query(query, values);

            return {
                data: rows,

                pagination: {
                    total,
                    page: Number(page),
                    limit: Number(limit),
                    total_pages: Math.ceil(total / limit),
                    has_next_page: page < Math.ceil(total / limit),
                    has_prev_page: page > 1
                }
            };

        } catch (error) {

            console.error(
                "Error fetching vendor products:",
                error
            );

            throw error;

        } finally {
            client.release();
        }
    }

    static async search(vendorId, filters = {}) {
        try {
            const {
                q, category_id, brand,
                min_price, max_price,
                in_stock, is_featured, is_digital,
                tags, status,
                sort_by = 'newest',
                offset = 0, limit = 40
            } = filters;

            let paramIndex = 1;
            const whereClauses = [`p.vendor_id = $${paramIndex++}`, `p.deleted_at IS NULL`];
            const values = [vendorId];

            // Full text search
            if (q) {
                whereClauses.push(
                    `(p.name ILIKE $${paramIndex} 
                    OR p.description ILIKE $${paramIndex} 
                    OR p.brand ILIKE $${paramIndex}
                    OR p.short_description ILIKE $${paramIndex})`
                );
                values.push(`%${q}%`);
                paramIndex++;
            }

            // Category filter
            if (category_id) {
                whereClauses.push(`p.category_id = $${paramIndex++}`);
                values.push(category_id);
            }

            // Brand filter
            if (brand) {
                whereClauses.push(`p.brand ILIKE $${paramIndex++}`);
                values.push(`%${brand}%`);
            }

            // Price range
            if (min_price) {
                whereClauses.push(`p.price >= $${paramIndex++}`);
                values.push(min_price);
            }

            if (max_price) {
                whereClauses.push(`p.price <= $${paramIndex++}`);
                values.push(max_price);
            }

            // Stock filter
            if (in_stock === true) {
                whereClauses.push(`p.stock > 0`);
            } else if (in_stock === false) {
                whereClauses.push(`p.stock = 0`);
            }

            // Featured filter
            if (is_featured !== undefined) {
                whereClauses.push(`p.is_featured = $${paramIndex++}`);
                values.push(is_featured);
            }

            // Digital filter
            if (is_digital !== undefined) {
                whereClauses.push(`p.is_digital = $${paramIndex++}`);
                values.push(is_digital);
            }

            // Tags filter
            if (tags && tags.length > 0) {
                whereClauses.push(`p.tags && $${paramIndex++}::text[]`);
                values.push(tags);
            }

            // Status filter
            if (status) {
                whereClauses.push(`p.status = $${paramIndex++}`);
                values.push(status);
            } else {
                // Default to active for customers
                whereClauses.push(`p.status = 'active'`);
            }

            // Sort
            const sortOptions = {
                price_asc: 'p.price ASC',
                price_desc: 'p.price DESC',
                newest: 'p.created_at DESC',
                oldest: 'p.created_at ASC',
                popular: 'total_sold DESC NULLS LAST',
                rating: 'avg_rating DESC NULLS LAST'
            };

            const orderBy = sortOptions[sort_by] ?? sortOptions.newest;

            const query = `
                SELECT
                    p.id, p.name, p.slug, p.thumbnail,
                    p.price, p.compare_at_price, p.discount,
                    p.stock, p.brand, p.tags,
                    p.is_featured, p.is_digital,
                    p.status, p.created_at,
                    c.name AS category,

                    -- Ratings
                    ROUND(AVG(pr.rating), 1)    AS avg_rating,
                    COUNT(DISTINCT pr.id)        AS review_count,

                    -- Sales
                    COALESCE(SUM(oi.quantity), 0) AS total_sold,

                    -- Images
                    json_agg(DISTINCT jsonb_build_object(
                        'id', pi.id,
                        'url', pi.url,
                        'is_primary', pi.is_primary
                    )) FILTER (WHERE pi.id IS NOT NULL) AS images
                FROM products p
                LEFT JOIN categories c ON c.id = p.category_id
                LEFT JOIN product_images pi ON pi.product_id = p.id
                LEFT JOIN product_reviews pr ON pr.product_id = p.id AND pr.status = 'approved'
                LEFT JOIN order_items oi ON oi.product_id = p.id
                WHERE ${whereClauses.join(' AND ')}
                GROUP BY p.id, c.id
                ORDER BY ${orderBy}
                LIMIT $${paramIndex++} OFFSET $${paramIndex++}
            `;

            values.push(limit, offset);

            const { rows } = await pool.query(query, values);

            // Get total count for pagination
            const countQuery = `
                SELECT COUNT(DISTINCT p.id) AS total
                FROM products p
                WHERE ${whereClauses.join(' AND ')}
            `;

            const { rows: countRows } = await pool.query(countQuery, values.slice(0, -2));

            return {
                products: rows,
                pagination: {
                    total: parseInt(countRows[0].total),
                    offset,
                    limit,
                    has_more: offset + limit < parseInt(countRows[0].total)
                }
            };
        } catch (error) {
            console.error("Error searching products:", error);
            throw error;
        }
    }

    static async getFilters(vendorId) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    -- Price range
                    MIN(p.price)                                    AS min_price,
                    MAX(p.price)                                    AS max_price,

                    -- Brands
                    array_agg(DISTINCT p.brand) 
                        FILTER (WHERE p.brand IS NOT NULL)          AS brands,

                    -- Tags
                    array_agg(DISTINCT tag)
                        FILTER (WHERE tag IS NOT NULL)              AS tags,

                    -- Categories
                    json_agg(DISTINCT jsonb_build_object(
                        'id', c.id,
                        'name', c.name
                    )) FILTER (WHERE c.id IS NOT NULL)              AS categories
                FROM products p
                LEFT JOIN categories c ON c.id = p.category_id
                LEFT JOIN LATERAL unnest(p.tags) AS tag ON true
                WHERE p.vendor_id = $1
                AND p.status = 'active'
                AND p.deleted_at IS NULL`,
                [vendorId]
            );

            return rows[0];
        } catch (error) {
            console.error("Error fetching filters:", error);
            throw error;
        }
    }

    static async getRelatedProducts(productId, vendorId, limit = 8) {
        try {
            // Get current product's category and tags
            const { rows: productRows } = await pool.query(
                `SELECT category_id, tags FROM products WHERE id = $1`,
                [productId]
            );

            if (productRows.length === 0) return [];

            const { category_id, tags } = productRows[0];

            const { rows } = await pool.query(
                `SELECT
                    p.id, p.name, p.slug, p.thumbnail,
                    p.price, p.compare_at_price, p.discount,
                    p.stock, p.is_featured,
                    ROUND(AVG(pr.rating), 1) AS avg_rating,
                    COUNT(DISTINCT pr.id) AS review_count
                FROM products p
                LEFT JOIN product_reviews pr ON pr.product_id = p.id AND pr.status = 'approved'
                WHERE p.vendor_id = $1
                AND p.id != $2
                AND p.status = 'active'
                AND p.deleted_at IS NULL
                AND (
                    p.category_id = $3
                    OR p.tags && $4::text[]
                )
                GROUP BY p.id
                ORDER BY
                    CASE WHEN p.category_id = $3 THEN 0 ELSE 1 END,
                    p.created_at DESC
                LIMIT $5`,
                [vendorId, productId, category_id, tags ?? [], limit]
            );

            return rows;
        } catch (error) {
            console.error("Error fetching related products:", error);
            throw error;
        }
    }

    static async getFeaturedProducts(vendorId, limit = 10) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    p.id, p.name, p.slug, p.thumbnail,
                    p.price, p.compare_at_price, p.discount,
                    p.stock, p.is_featured,
                    ROUND(AVG(pr.rating), 1) AS avg_rating,
                    COUNT(DISTINCT pr.id) AS review_count,
                    json_agg(DISTINCT jsonb_build_object(
                        'url', pi.url,
                        'is_primary', pi.is_primary
                    )) FILTER (WHERE pi.id IS NOT NULL) AS images
                FROM products p
                LEFT JOIN product_reviews pr ON pr.product_id = p.id AND pr.status = 'approved'
                LEFT JOIN product_images pi ON pi.product_id = p.id
                WHERE p.vendor_id = $1
                AND p.is_featured = true
                AND p.status = 'active'
                AND p.deleted_at IS NULL
                GROUP BY p.id
                ORDER BY p.created_at DESC
                LIMIT $2`,
                [vendorId, limit]
            );

            return rows;
        } catch (error) {
            console.error("Error fetching featured products:", error);
            throw error;
        }
    }
}

export default Product;