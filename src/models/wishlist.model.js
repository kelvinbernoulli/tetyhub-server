export class Wishlist {
    static async addToWishlist(userId, vendorId, productId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verify product exists and belongs to vendor
            const { rows: productRows } = await client.query(
                `SELECT id FROM products
                WHERE id = $1 AND vendor_id = $2
                AND status = 'active' AND deleted_at IS NULL`,
                [productId, vendorId]
            );

            if (productRows.length === 0) {
                return { error: 'Product not found or unavailable', code: 404 };
            }

            // 2. Get or create wishlist
            const { rows: wishlistRows } = await client.query(
                `INSERT INTO wishlists (user_id, vendor_id)
                VALUES ($1, $2)
                ON CONFLICT (user_id, vendor_id) DO UPDATE SET user_id = EXCLUDED.user_id
                RETURNING *`,
                [userId, vendorId]
            );

            const wishlistId = wishlistRows[0].id;

            // 3. Check if product already in wishlist
            const { rows: existingItem } = await client.query(
                `SELECT id FROM wishlist_items
                WHERE wishlist_id = $1 AND product_id = $2`,
                [wishlistId, productId]
            );

            if (existingItem.length > 0) {
                return { error: 'Product already in wishlist', code: 409 };
            }

            // 4. Add product to wishlist
            await client.query(
                `INSERT INTO wishlist_items (wishlist_id, product_id)
                VALUES ($1, $2)`,
                [wishlistId, productId]
            );

            await client.query('COMMIT');

            // 5. Return updated wishlist
            return await Wishlist.getWishlistItems(userId, vendorId, {});
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error adding to wishlist:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async getWishlistItems(userId, vendorId, { offset = 0, limit = 40 }) {
        try {
            const { rows } = await pool.query(
                `SELECT
                    w.id AS wishlist_id,
                    w.user_id,
                    w.vendor_id,
                    COUNT(wi.id) AS item_count,
                    json_agg(jsonb_build_object(
                        'id', wi.id,
                        'product_id', p.id,
                        'name', p.name,
                        'slug', p.slug,
                        'thumbnail', p.thumbnail,
                        'price', p.price,
                        'compare_at_price', p.compare_at_price,
                        'discount', p.discount,
                        'status', p.status,
                        'in_stock', p.stock > 0,
                        'added_at', wi.created_at
                    ) ORDER BY wi.created_at DESC) AS items
                FROM wishlists w
                LEFT JOIN wishlist_items wi ON wi.wishlist_id = w.id
                LEFT JOIN products p ON p.id = wi.product_id
                WHERE w.user_id = $1 AND w.vendor_id = $2
                GROUP BY w.id
                LIMIT $3 OFFSET $4`,
                [userId, vendorId, limit, offset]
            );

            return rows[0] ?? { wishlist_id: null, items: [], item_count: 0 };
        } catch (error) {
            console.error("Error fetching wishlist items:", error);
            throw error;
        }
    }

    static async removeFromWishlist(userId, vendorId, wishlistItemId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Verify wishlist item belongs to user
            const { rows: itemRows } = await client.query(
                `SELECT wi.* FROM wishlist_items wi
                JOIN wishlists w ON w.id = wi.wishlist_id
                WHERE wi.id = $1 AND w.user_id = $2 AND w.vendor_id = $3`,
                [wishlistItemId, userId, vendorId]
            );

            if (itemRows.length === 0) {
                return { error: 'Wishlist item not found', code: 404 };
            }

            // 2. Remove item
            await client.query(
                `DELETE FROM wishlist_items WHERE id = $1`,
                [wishlistItemId]
            );

            // 3. If wishlist is empty delete it
            const { rows: remainingItems } = await client.query(
                `SELECT id FROM wishlist_items WHERE wishlist_id = $1`,
                [itemRows[0].wishlist_id]
            );

            if (remainingItems.length === 0) {
                await client.query(
                    `DELETE FROM wishlists WHERE id = $1`,
                    [itemRows[0].wishlist_id]
                );
            }

            await client.query('COMMIT');

            // 4. Return updated wishlist or empty
            return remainingItems.length > 0
                ? await Wishlist.getWishlistItems(userId, vendorId, {})
                : { wishlist_id: null, items: [], item_count: 0 };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error removing from wishlist:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async moveToCart(userId, vendorId, wishlistItemId) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Get wishlist item
            const { rows: itemRows } = await client.query(
                `SELECT wi.*, p.price FROM wishlist_items wi
                JOIN wishlists w ON w.id = wi.wishlist_id
                JOIN products p ON p.id = wi.product_id
                WHERE wi.id = $1 AND w.user_id = $2 AND w.vendor_id = $3
                AND p.status = 'active' AND p.deleted_at IS NULL`,
                [wishlistItemId, userId, vendorId]
            );

            if (itemRows.length === 0) {
                return { error: 'Wishlist item not found or product unavailable', code: 404 };
            }

            const item = itemRows[0];

            await client.query('COMMIT');

            // 2. Add to cart
            const cartResult = await CartModel.upsertCartItem(userId, vendorId, {
                product_id: item.product_id,
                variant_id: null,
                quantity: 1
            });

            if (cartResult?.error) {
                return cartResult;
            }

            // 3. Remove from wishlist
            await WishlistModel.removeFromWishlist(userId, vendorId, wishlistItemId);

            return cartResult;
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error moving to cart:", error);
            throw error;
        } finally {
            client.release();
        }
    }
}

export default Wishlist;