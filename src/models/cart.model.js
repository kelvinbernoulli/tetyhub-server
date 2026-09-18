import pool from '#services/pg_pool.js';
import { quote, processCheckout } from '#services/checkout.service.js';
import { CheckoutError } from '#utils/checkout.js';

export class Cart {
    static async addToCart(
        userId,
        { product_id, variant_id = null, quantity }
    ) {
        console.log('data:', userId, product_id, variant_id, quantity);

        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
                userId,
            ]);
            const { rows: productRows } = await client.query(
                `
                        SELECT * FROM products
                        WHERE id = $1
                        AND status = 'active' AND deleted_at IS NULL
                        LIMIT 1
                        FOR UPDATE
                    `,
                [product_id]
            );

            if (!productRows.length) {
                await client.query('ROLLBACK');

                return { error: 'Product not found', code: 404 };
            }

            const product = productRows[0];

            if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
                await client.query('ROLLBACK');

                return { error: 'Quantity must be greater than 0', code: 422 };
            }

            if (product.has_variants && !variant_id) {
                await client.query('ROLLBACK');
                return { error: 'Choose a product variant', code: 422 };
            }
            let price = product.price;
            let stock = product.stock;

            if (variant_id) {
                const { rows: variantRows } = await client.query(
                    `
                            SELECT * FROM product_variants
                            WHERE id = $1
                            AND product_id = $2 AND status = 'active'
                            LIMIT 1
                            FOR UPDATE
                        `,
                    [variant_id, product_id]
                );

                if (!variantRows.length) {
                    await client.query('ROLLBACK');

                    return { error: 'Variant not found', code: 404 };
                }

                const variant = variantRows[0];

                price = variant.price;
                stock = variant.stock;
            }

            const { rows: existingItemRows } = await client.query(
                `
                    SELECT ci.*
                    FROM cart_items ci
                    INNER JOIN carts c ON c.id = ci.cart_id
                    WHERE c.user_id = $1
                    AND ci.product_id = $2
                    AND (
                        ($3::INT IS NULL AND ci.variant_id IS NULL)
                        OR ci.variant_id = $3
                    )
                `,
                [userId, product_id, variant_id]
            );

            const existingItem = existingItemRows[0] || null;

            const totalRequestedQty =
                Number(existingItem?.quantity || 0) + Number(quantity);
            if (totalRequestedQty > 100) {
                await client.query('ROLLBACK');
                return {
                    error: 'Maximum cart quantity is 100 per item',
                    code: 422,
                };
            }
            if (product.track_inventory && stock < totalRequestedQty) {
                await client.query('ROLLBACK');

                return {
                    error: `Only ${stock} items available in stock`,
                    code: 422,
                };
            }

            const { rows: cartRows } = await client.query(
                `
                        INSERT INTO carts (
                            user_id
                        )
                        VALUES ($1)
                        ON CONFLICT (user_id)
                        DO UPDATE SET
                            updated_at = NOW()
                        RETURNING *
                    `,
                [userId]
            );

            const cart = cartRows[0];

            let cartItem;

            if (existingItem) {
                const { rows } = await client.query(
                    `
                            UPDATE cart_items
                            SET
                                quantity = quantity + $1,
                                price = $2,
                                updated_at = NOW()
                            WHERE id = $3
                            RETURNING *
                        `,
                    [Number(quantity), Number(price), existingItem.id]
                );

                cartItem = rows[0];
            } else {
                const { rows } = await client.query(
                    `
                            INSERT INTO cart_items (
                                cart_id, product_id, variant_id, quantity, price
                            )
                            VALUES ($1, $2, $3, $4, $5)
                            RETURNING *
                        `,
                    [cart.id, product_id, variant_id, quantity, price]
                );

                cartItem = rows[0];
            }

            await client.query('COMMIT');

            return await Cart.getCart(userId);
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error adding to cart:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async updateCart(
        userId,
        { product_id, variant_id = null, quantity } = {}
    ) {
        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
                userId,
            ]);

            const { rows: productRows } = await client.query(
                `
                SELECT *
                FROM products
                WHERE id = $1
                AND status = 'active'
                AND deleted_at IS NULL
                `,
                [product_id]
            );

            if (!productRows.length) {
                await client.query('ROLLBACK');

                return {
                    error: 'Product not found or unavailable',
                    code: 404,
                };
            }

            const product = productRows[0];

            if (product.has_variants && !variant_id) {
                await client.query('ROLLBACK');
                return { error: 'Choose a product variant', code: 422 };
            }
            let price = product.price;

            if (variant_id) {
                const { rows: variantRows } = await client.query(
                    `
                SELECT *
                FROM product_variants
                WHERE id = $1
                AND product_id = $2
                AND status = 'active'
                `,
                    [variant_id, product_id]
                );

                if (!variantRows.length) {
                    await client.query('ROLLBACK');

                    return {
                        error: 'Variant not found or unavailable',
                        code: 404,
                    };
                }

                const variant = variantRows[0];

                if (product.track_inventory && variant.stock < quantity) {
                    await client.query('ROLLBACK');

                    return {
                        error: `Only ${variant.stock} items available in stock`,
                        code: 422,
                    };
                }

                price = variant.price;
            } else {
                if (product.track_inventory && product.stock < quantity) {
                    await client.query('ROLLBACK');

                    return {
                        error: `Only ${product.stock} items available in stock`,
                        code: 422,
                    };
                }
            }

            const { rows: cartRows } = await client.query(
                `
                SELECT *
                FROM carts
                WHERE user_id = $1
                LIMIT 1
                `,
                [userId]
            );

            if (!cartRows.length) {
                await client.query('ROLLBACK');

                return {
                    error: 'Cart not found',
                    code: 404,
                };
            }

            const cart = cartRows[0];

            const { rows: itemRows } = await client.query(
                `
                UPDATE cart_items
                SET
                    quantity = $1,
                    price = $2,
                    updated_at = NOW()
                WHERE cart_id = $3
                AND product_id = $4
                AND (
                    ($5::INT IS NULL AND variant_id IS NULL)
                    OR variant_id = $5
                )
                RETURNING *
                `,
                [quantity, price, cart.id, product_id, variant_id]
            );

            if (!itemRows.length) {
                await client.query('ROLLBACK');

                return {
                    error: 'Cart item not found',
                    code: 404,
                };
            }

            await client.query('COMMIT');

            return await Cart.getCart(userId);
        } catch (error) {
            await client.query('ROLLBACK');

            console.error('Error updating cart item:', error);

            throw error;
        } finally {
            client.release();
        }
    }

    static async getCart(userId, vendorId) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    c.id AS cart_id,
                    c.user_id,
                    json_agg(jsonb_build_object(
                        'id', ci.id,
                        'product_id', ci.product_id,
                        'product_name', p.name,
                        'thumbnail', p.thumbnail,
                        'variant_id', ci.variant_id,
                        'quantity', ci.quantity,
                        'price', ci.price,
                        'subtotal', ci.quantity * ci.price
                    ) ORDER BY ci.created_at DESC) AS items,
                    SUM(ci.quantity * ci.price) AS total,
                    COUNT(ci.id) AS item_count
                FROM carts c
                LEFT JOIN cart_items ci ON ci.cart_id = c.id
                LEFT JOIN products p ON p.id = ci.product_id
                WHERE c.user_id = $1
                GROUP BY c.id`,
                [userId]
            );

            return rows[0] ?? null;
        } catch (error) {
            console.error('Error fetching cart item:', error);
            throw error;
        }
    }

    static async getCartItems(userId, pagination = {}) {
        try {
            const { offset = 0, limit = 20 } = pagination;
            const { rows } = await pool.query(
                `SELECT
                    c.id AS cart_id,
                    c.user_id,
                    json_agg(jsonb_build_object(
                        'id', ci.id,
                        'product_id', ci.product_id,
                        'product_name', p.name,
                        'thumbnail', p.thumbnail,
                        'variant_id', ci.variant_id,
                        'quantity', ci.quantity,
                        'price', ci.price,
                        'subtotal', ci.quantity * ci.price
                    ) ORDER BY ci.created_at DESC) AS items,
                    SUM(ci.quantity * ci.price) AS total,
                    COUNT(ci.id) AS item_count
                FROM carts c
                LEFT JOIN cart_items ci ON ci.cart_id = c.id
                LEFT JOIN products p ON p.id = ci.product_id
                WHERE c.user_id = $1
                GROUP BY c.id
                LIMIT $3 OFFSET $2`,
                [userId, offset, limit]
            );

            return rows[0] ?? null;
        } catch (error) {
            console.error('Error fetching cart items:', error);
            throw error;
        }
    }

    static async removeFromCart(userId, cartItemId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
                userId,
            ]);

            const { rows: itemRows } = await client.query(
                `
                    SELECT ci.*
                    FROM cart_items ci
                    INNER JOIN carts c ON c.id = ci.cart_id
                    WHERE ci.id = $1
                    AND c.user_id = $2
                    FOR UPDATE
                `,
                [cartItemId, userId]
            );
            console.log('item', itemRows);
            if (!itemRows.length) {
                await client.query('ROLLBACK');

                return {
                    error: 'Cart item not found',
                    code: 404,
                };
            }

            const cartItem = itemRows[0];

            await client.query(
                `
                    DELETE FROM cart_items
                    WHERE id = $1
                `,
                [cartItemId]
            );

            const { rows: remainingItems } = await client.query(
                `
                    SELECT 1
                    FROM cart_items
                    WHERE cart_id = $1
                    LIMIT 1
                `,
                [cartItem.cart_id]
            );

            if (remainingItems.length === 0) {
                await client.query(
                    `
                        DELETE FROM carts
                        WHERE id = $1
                    `,
                    [cartItem.cart_id]
                );
            }

            await client.query('COMMIT');

            return remainingItems.length > 0
                ? await Cart.getCart(userId)
                : {
                      cart_id: null,
                      items: [],
                      total: 0,
                      item_count: 0,
                  };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('Error removing cart item:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async previewCheckout(userId, couponCode = null, country = null) {
        try {
            return await quote(pool, userId, {
                coupon_code: couponCode,
                country,
            });
        } catch (error) {
            if (error instanceof CheckoutError)
                return { error: error.message, code: error.code };
            throw error;
        }
    }
    static async validateCoupon(code, userId, country) {
        const result = await Cart.previewCheckout(userId, code, country);
        return result;
    }
    static async processCheckout(user, data) {
        try {
            return await processCheckout(user, data);
        } catch (error) {
            if (error instanceof CheckoutError)
                return { error: error.message, code: error.code };
            throw error;
        }
    }
}
export default Cart;
