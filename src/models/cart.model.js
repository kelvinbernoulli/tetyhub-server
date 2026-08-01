import pool from "#services/pg_pool.js";
import { sendOrderConfirmationEmail } from "./mail.model.js";
import Payment from "./payment.model.js";
import Coupon from "./coupons.model.js";

export class Cart {
    static async addToCart(userId, { product_id, variant_id = null, quantity }) {

        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            const { rows: productRows } =
                await client.query(
                    `
                        SELECT * FROM products
                        WHERE id = $1
                        AND status = 'active'
                        AND deleted_at IS NULL
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

            const vendorId = product.vendor_id;

            if (quantity <= 0) {
                await client.query('ROLLBACK');

                return { error: 'Quantity must be greater than 0', code: 422 };
            }

            let price = product.price;
            let stock = product.stock;

            if (variant_id) {

                const { rows: variantRows } =
                    await client.query(
                        `
                            SELECT * FROM product_variants
                            WHERE id = $1
                            AND product_id = $2
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
                    AND c.vendor_id = $2
                    AND ci.product_id = $3
                    AND (
                        ($4::INT IS NULL AND ci.variant_id IS NULL)
                        OR ci.variant_id = $4
                    )
                `,
                [userId, vendorId, product_id, variant_id]
            );

            const existingItem =
                existingItemRows[0] || null;

            const totalRequestedQty = Number(existingItem?.quantity || 0) + Number(quantity);
            if (
                product.track_inventory &&
                stock < totalRequestedQty
            ) {
                await client.query('ROLLBACK');

                return {
                    error: `Only ${stock} items available in stock`,
                    code: 422
                };
            }

            const { rows: cartRows } =
                await client.query(
                    `
                        INSERT INTO carts (
                            user_id,
                            vendor_id
                        )
                        VALUES ($1, $2)
                        ON CONFLICT (user_id, vendor_id)
                        DO UPDATE SET
                            updated_at = NOW()
                        RETURNING *
                    `,
                    [userId, vendorId]
                );

            const cart = cartRows[0];

            let cartItem;

            if (existingItem) {

                const { rows } =
                    await client.query(
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

                const { rows } =
                    await client.query(
                        `
                            INSERT INTO cart_items (
                                cart_id, vendor_id, product_id, variant_id, quantity, price
                            )
                            VALUES ($1, $2, $3, $4, $5, $6)
                            RETURNING *
                        `,
                        [cart.id, vendorId, product_id, variant_id, quantity, price]
                    );

                cartItem = rows[0];
            }

            await client.query('COMMIT');

            return await Cart.getCart(userId, vendorId);

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
        vendorId,
        {
            product_id,
            variant_id = null,
            quantity
        } = {}
    ) {

        const client = await pool.connect();

        try {

            await client.query('BEGIN');

            const { rows: productRows } = await client.query(
                `
            SELECT *
            FROM products
            WHERE id = $1
            AND vendor_id = $2
            AND status = 'active'
            AND deleted_at IS NULL
            `,
                [product_id, vendorId]
            );

            if (!productRows.length) {

                await client.query('ROLLBACK');

                return {
                    error: 'Product not found or unavailable',
                    code: 404
                };
            }

            const product = productRows[0];

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
                        code: 404
                    };
                }

                const variant = variantRows[0];

                if (variant.stock < quantity) {

                    await client.query('ROLLBACK');

                    return {
                        error: `Only ${variant.stock} items available in stock`,
                        code: 422
                    };
                }

                price = variant.price;

            } else {

                if (product.stock < quantity) {

                    await client.query('ROLLBACK');

                    return {
                        error: `Only ${product.stock} items available in stock`,
                        code: 422
                    };
                }
            }

            const { rows: cartRows } = await client.query(
                `
            SELECT *
            FROM carts
            WHERE user_id = $1
            AND vendor_id = $2
            LIMIT 1
            `,
                [userId, vendorId]
            );

            if (!cartRows.length) {

                await client.query('ROLLBACK');

                return {
                    error: 'Cart not found',
                    code: 404
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
                [
                    quantity,
                    price,
                    cart.id,
                    product_id,
                    variant_id
                ]
            );

            if (!itemRows.length) {

                await client.query('ROLLBACK');

                return {
                    error: 'Cart item not found',
                    code: 404
                };
            }

            await client.query('COMMIT');

            return await Cart.getCart(
                userId,
                vendorId
            );

        } catch (error) {

            await client.query('ROLLBACK');

            console.error(
                'Error updating cart item:',
                error
            );

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
                    c.vendor_id,
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
                WHERE c.user_id = $1 AND c.vendor_id = $2
                GROUP BY c.id`,
                [userId, vendorId]
            );

            return rows[0] ?? null;
        } catch (error) {
            console.error("Error fetching cart item:", error);
            throw error;
        }
    }

    static async getCartItems(userId, vendorId, pagination) {
        try {
            const { offset = 0, limit = 20 } = pagination;
            const { rows } = await pool.query(
                `SELECT
                    c.id AS cart_id,
                    c.user_id,
                    c.vendor_id,
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
                WHERE c.user_id = $1 AND c.vendor_id = $2
                OFFSET = $3 AND LIMIT = $4
                GROUP BY c.id`,
                [userId, vendorId, offset, limit]
            );

            return rows[0] ?? null;
        } catch (error) {
            console.error("Error fetching cart items:", error);
            throw error;
        }
    }

    static async removeFromCart(userId, vendorId, cartItemId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { rows: itemRows } = await client.query(
                `
                    SELECT ci.*
                    FROM cart_items ci
                    INNER JOIN carts c ON c.id = ci.cart_id
                    WHERE ci.id = $1
                    AND c.user_id = $2
                    AND c.vendor_id = $3
                    FOR UPDATE
                `,
                [cartItemId, userId, vendorId]
            );
            console.log('item', itemRows)
            if (!itemRows.length) {
                await client.query('ROLLBACK');

                return {
                    error: 'Cart item not found',
                    code: 404
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
                ? await CartModel.getCart(userId, vendorId)
                : {
                    cart_id: null,
                    items: [],
                    total: 0,
                    item_count: 0
                };

        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error removing cart item:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async previewCheckout(userId, vendorId, couponCode = null) {
        try {
            const { rows } = await pool.query(
                `
                    SELECT
                        c.id AS cart_id,
                        json_agg(
                            jsonb_build_object(
                                'id', ci.id,
                                'product_id', ci.product_id,
                                'product_name', p.name,
                                'thumbnail', p.thumbnail,
                                'variant_id', ci.variant_id,
                                'quantity', ci.quantity,
                                'price', ci.price,
                                'subtotal', ROUND(ci.quantity * ci.price, 2),

                                'stock',
                                CASE
                                    WHEN ci.variant_id IS NOT NULL
                                    THEN pv.stock
                                    ELSE p.stock
                                END,

                                'free_shipping', p.free_shipping
                            )
                        ) FILTER (WHERE ci.id IS NOT NULL) AS items

                    FROM carts c

                    INNER JOIN cart_items ci
                        ON ci.cart_id = c.id

                    INNER JOIN products p
                        ON p.id = ci.product_id
                        AND p.status = 'active'
                        AND p.deleted_at IS NULL

                    LEFT JOIN product_variants pv
                        ON pv.id = ci.variant_id
                        AND (
                            ci.variant_id IS NULL
                            OR pv.status = 'active'
                        )

                    WHERE c.user_id = $1
                    AND c.vendor_id = $2

                    GROUP BY c.id
                    LIMIT 1
                `,
                [userId, vendorId]
            );

            if (!rows.length || !rows[0].items || rows[0].items.length === 0) {
                return {error: 'Cart is empty', code: 400};
            }

            const cart = rows[0];
            const items = cart.items;

            for (const item of items) {
                if (!item.stock || item.stock < item.quantity) {
                    return {error: `Insufficient stock for ${item.product_name}. ` + `Only ${item.stock || 0} available`, code: 422};
                }
            }

            const subtotal = items.reduce(
                (sum, item) =>
                    sum +
                    (
                        Number(item.price) *
                        Number(item.quantity)
                    ),
                0
            );

            const allFreeShipping = items.every(
                item => item.free_shipping
            );

            const shipping_fee = allFreeShipping ? 0 : await Cart.calculateShipping(vendorId, subtotal);

            let discount = 0;
            let couponData = null;

            if (couponCode) {
                const couponResult = await Cart.validateCoupon(couponCode, vendorId, userId, subtotal);

                if (couponResult?.error) {
                    return couponResult;
                }

                discount = Number(couponResult.discount || 0);
                couponData = couponResult.coupon;
            }

            const total = Math.max(0, subtotal + shipping_fee - discount);
            const item_count = items.reduce((sum, item) => sum + Number(item.quantity), 0);

            return {
                cart_id: cart.cart_id,
                items,
                subtotal: Number(
                    subtotal.toFixed(2)
                ),
                shipping_fee: Number(
                    shipping_fee.toFixed(2)
                ),
                discount: Number(
                    discount.toFixed(2)
                ),
                total: Number(
                    total.toFixed(2)
                ),
                coupon: couponData,
                free_shipping: allFreeShipping,
                item_count
            };

        } catch (error) {
            console.error('Error previewing checkout:', error);
            throw error;
        }
    }

    // ─── CALCULATE SHIPPING ────────────────────────────
    static async calculateShipping(vendorId, subtotal) {
        // You can make this dynamic based on vendor shipping settings
        // For now using simple flat rate logic
        if (subtotal >= 100) return 0;  // free shipping over $100
        return 5.00;                    // flat rate $5
    }

    // ─── VALIDATE COUPON ───────────────────────────────
    static async validateCoupon(code, vendorId, userId, subtotal) {
        try {
            // 1. Find coupon
            const { rows: couponRows } = await pool.query(
                `SELECT * FROM coupons
                WHERE code = $1 AND vendor_id = $2
                AND status = 'active'
                AND (expires_at IS NULL OR expires_at > NOW())`,
                [code, vendorId]
            );

            if (couponRows.length === 0) {
                return { error: 'Invalid or expired coupon code', code: 422 };
            }

            const coupon = couponRows[0];

            // 2. Check usage limit
            if (coupon.usage_limit && coupon.usage_count >= coupon.usage_limit) {
                return { error: 'Coupon usage limit reached', code: 422 };
            }

            // 3. Check if user already used this coupon
            const { rows: usageRows } = await pool.query(
                `SELECT id FROM coupon_usage WHERE coupon_id = $1 AND user_id = $2`,
                [coupon.id, userId]
            );

            if (usageRows.length > 0) {
                return { error: 'You have already used this coupon', code: 422 };
            }

            // 4. Check minimum order
            if (subtotal < coupon.min_order) {
                return {
                    error: `Minimum order of ${coupon.min_order} required for this coupon`,
                    code: 422
                };
            }

            // 5. Calculate discount
            let discount = 0;
            if (coupon.type === 'percentage') {
                discount = (subtotal * coupon.value) / 100;
                if (coupon.max_discount) {
                    discount = Math.min(discount, coupon.max_discount);
                }
            } else if (coupon.type === 'fixed') {
                discount = coupon.value;
            }

            return { discount, coupon };
        } catch (error) {
            console.error("Error validating coupon:", error);
            throw error;
        }
    }

    static async processCheckout(user, vendor, data) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const { shipping_address_id, shipping_address, gateway, note, coupon_code } = data;


            // 1. Preview checkout to get totals
            const preview = await Cart.previewCheckout(user.id, user.vendor_id, coupon_code);
            if (preview?.error) {
                return preview;
            }

            // 2. Resolve shipping address
            let address;
            if (shipping_address_id) {
                const { rows: addressRows } = await client.query(
                    `SELECT * FROM user_addresses WHERE id = $1 AND user_id = $2`,
                    [shipping_address_id, user.id]
                );

                if (addressRows.length === 0) {
                    return { error: 'Shipping address not found', code: 404 };
                }
                address = addressRows[0];
            } else {
                address = shipping_address;
            }

            // 3. Create order
            const { rows: orderRows } = await client.query(
                `INSERT INTO orders (user_id, vendor_id, subtotal, shipping_fee, discount, total, payment_method, note)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *`,
                [
                    user.id, user.vendor_id,
                    preview.subtotal, preview.shipping_fee,
                    preview.discount, preview.total,
                    gateway, note ?? null
                ]
            );

            const order = orderRows[0];

            // 4. Insert order items and deduct stock
            for (const item of preview.items) {
                await client.query(
                    `INSERT INTO order_items (order_id, product_id, variant_id, quantity, price, subtotal)
                    VALUES ($1, $2, $3, $4, $5, $6)`,
                    [
                        order.id, item.product_id,
                        item.variant_id ?? null,
                        item.quantity, item.price,
                        item.subtotal
                    ]
                );

                // Deduct stock
                if (item.variant_id) {
                    await client.query(
                        `UPDATE product_variants SET stock = stock - $1, updated_at = NOW() WHERE id = $2`,
                        [item.quantity, item.variant_id]
                    );
                } else {
                    await client.query(
                        `UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2`,
                        [item.quantity, item.product_id]
                    );
                }
            }

            // 5. Insert shipping address
            await client.query(
                `INSERT INTO order_addresses
                (order_id, firstname, lastname, phone, address, city, state, country, zip_code)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
                [
                    order.id,
                    address.firstname, address.lastname,
                    address.phone, address.address,
                    address.city, address.state,
                    address.country, address.zip_code ?? null
                ]
            );

            // 6. Apply coupon
            if (coupon_code && preview.coupon) {
                await Coupon.incrementUsage(preview.coupon.id);

                await client.query(
                    `INSERT INTO coupon_usage (coupon_id, user_id, order_id)
                    VALUES ($1, $2, $3)`,
                    [preview.coupon.id, user.id, order.id]
                );
            }

            // 7. Clear cart
            await client.query(
                `DELETE FROM carts WHERE user_id = $1 AND vendor_id = $2`,
                [user.id, user.vendor_id]
            );

            // 8. Insert order status history
            await client.query(
                `INSERT INTO order_status_history (order_id, status, note, changed_by)
                VALUES ($1, $2, $3, $4)`,
                [order.id, 'pending', 'order placed', user.id]
            );

            await client.query('COMMIT');

            // 9. Initiate payment
            const payment = await Payment.initiatePayment(user.id, order.id, gateway);
            if (payment?.error) {
                return payment;
            }

            order.items = preview.items;
            console.log('order items', order.items)

            // 10. Send order confirmation email
            await sendOrderConfirmationEmail(user, order, vendor);

            return {
                order_id: order.id,
                total: order.total,
                payment
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error processing checkout:", error);
            throw error;
        } finally {
            client.release();
        }
    }
}

export default Cart;