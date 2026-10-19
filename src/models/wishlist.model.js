import Cart from '#models/cart.model.js';
import { productAvailableSql } from '#utils/product-stock.js';
import pool from '#services/pg_pool.js';

export class Wishlist {
    static async addToWishlist(userId, productId) {
        const { rows: products } = await pool.query(
            `SELECT id FROM products
             WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
            [productId]
        );
        if (!products.length) {
            return { error: 'Product not found or unavailable', code: 404 };
        }

        const { rows } = await pool.query(
            `INSERT INTO wishlist_items (user_id, product_id)
             VALUES ($1, $2)
             ON CONFLICT (user_id, product_id) DO NOTHING
             RETURNING *`,
            [userId, productId]
        );
        if (!rows.length) {
            return { error: 'Product already in wishlist', code: 409 };
        }

        return Wishlist.getWishlistItems(userId);
    }

    static async getWishlistItems(userId, { offset = 0, limit = 40 } = {}) {
        const [itemsResult, countResult] = await Promise.all([
            pool.query(
                `SELECT
                    wi.id,
                    wi.user_id,
                    wi.product_id,
                    p.name,
                    p.slug,
                    p.thumbnail,
                    p.price,
                    p.compare_at_price,
                    p.discount,
                    p.status,
                    (p.status = 'active' AND p.deleted_at IS NULL AND ${productAvailableSql}) AS in_stock,
                    wi.created_at AS added_at
                 FROM wishlist_items wi
                 JOIN products p ON p.id = wi.product_id
                 WHERE wi.user_id = $1
                 ORDER BY wi.created_at DESC, wi.id DESC
                 LIMIT $2 OFFSET $3`,
                [userId, limit, offset]
            ),
            pool.query(
                'SELECT COUNT(*)::integer AS total FROM wishlist_items WHERE user_id = $1',
                [userId]
            ),
        ]);

        return {
            items: itemsResult.rows,
            item_count: countResult.rows[0].total,
            offset,
            limit,
        };
    }

    static async removeFromWishlist(userId, wishlistItemId) {
        const { rows } = await pool.query(
            `DELETE FROM wishlist_items
             WHERE id = $1 AND user_id = $2
             RETURNING id`,
            [wishlistItemId, userId]
        );
        if (!rows.length) {
            return { error: 'Wishlist item not found', code: 404 };
        }
        return Wishlist.getWishlistItems(userId);
    }

    static async moveToCart(userId, wishlistItemId) {
        const { rows } = await pool.query(
            `SELECT wi.product_id
             FROM wishlist_items wi
             JOIN products p ON p.id = wi.product_id
             WHERE wi.id = $1 AND wi.user_id = $2
               AND p.status = 'active' AND p.deleted_at IS NULL`,
            [wishlistItemId, userId]
        );
        if (!rows.length) {
            return {
                error: 'Wishlist item not found or product unavailable',
                code: 404,
            };
        }

        const cartResult = await Cart.addToCart(userId, {
            product_id: rows[0].product_id,
            variant_id: null,
            quantity: 1,
        });
        if (cartResult?.error) return cartResult;

        const { rowCount } = await pool.query(
            'DELETE FROM wishlist_items WHERE id = $1 AND user_id = $2',
            [wishlistItemId, userId]
        );
        if (!rowCount) {
            return { error: 'Wishlist item not found', code: 404 };
        }

        return cartResult;
    }
}

export default Wishlist;
