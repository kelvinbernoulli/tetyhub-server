import pool from '#services/pg_pool.js';
import Notification from '#models/notification.model.js';
import {
    platformRecipients,
    vendorRecipients,
} from '#services/notifications.js';
import { transaction } from '#utils/checkout.js';

const reviewError = (message, status = 400) =>
    Object.assign(new Error(message), { status });
const requireUser = (userId) => {
    if (!Number.isSafeInteger(userId) || userId <= 0 || userId > 2147483647)
        throw reviewError('Authentication required', 401);
};
const resource = (kind) => {
    if (kind === 'product') return { table: 'products', column: 'product_id' };
    if (kind === 'service') return { table: 'services', column: 'service_id' };
    throw reviewError('Invalid review resource');
};
const content = (data) =>
    Object.fromEntries(
        ['rating', 'title', 'comment']
            .filter((key) => data[key] !== undefined)
            .map((key) => [key, data[key]])
    );
const metadata = (review) => ({
    review_id: review.id,
    product_id: review.product_id,
    service_id: review.service_id,
});

async function findResource(client, kind, id, publicOnly = false) {
    const { table } = resource(kind);
    const { rows } = await client.query(
        `SELECT p.id, p.vendor_id FROM ${table} p JOIN vendors v ON v.id = p.vendor_id
         WHERE p.id = $1 AND p.deleted_at IS NULL
         ${publicOnly ? "AND p.status = 'active' AND v.status = 'active'" : ''}`,
        [id]
    );
    if (!rows[0])
        throw reviewError(
            `${kind === 'product' ? 'Product' : 'Service'} not found`,
            404
        );
    return rows[0];
}

async function purchase(client, kind, id, userId) {
    const result =
        kind === 'product'
            ? await client.query(
                  `SELECT o.id FROM orders o JOIN order_items oi ON oi.order_id = o.id
             WHERE oi.product_id = $1 AND o.user_id = $2 AND o.payment_status = 'paid'
             AND o.status = 'delivered' ORDER BY o.id DESC LIMIT 1 FOR SHARE OF o`,
                  [id, userId]
              )
            : await client.query(
                  `SELECT b.id FROM service_bookings b WHERE b.service_id = $1 AND b.user_id = $2
             AND b.payment_status = 'paid' AND b.booking_status = 'completed'
             ORDER BY b.id DESC LIMIT 1 FOR SHARE OF b`,
                  [id, userId]
              );
    if (!result.rows[0])
        throw reviewError(
            kind === 'product'
                ? 'You can review a product after a paid order is delivered'
                : 'You can review a service after a paid booking is completed',
            403
        );
    return {
        order_id: kind === 'product' ? result.rows[0].id : null,
        booking_id: kind === 'service' ? result.rows[0].id : null,
    };
}

async function pendingNotification(client, review) {
    await Notification.createMany(
        await platformRecipients(client, 'reviews'),
        'review',
        'Review awaiting approval',
        'A customer review is ready for moderation.',
        metadata(review),
        client
    );
}

async function findReview(client, id, userId = null) {
    const { rows } = await client.query(
        `SELECT * FROM reviews WHERE id = $1 AND ($2::integer IS NULL OR user_id = $2) FOR UPDATE`,
        [id, userId]
    );
    if (!rows[0]) throw reviewError('Review not found', 404);
    return rows[0];
}

export class Review {
    static async create(kind, resourceId, userId, data) {
        requireUser(userId);
        try {
            return await transaction(pool, async (client) => {
                const { column } = resource(kind);
                await findResource(client, kind, resourceId);
                const source = await purchase(client, kind, resourceId, userId);
                const fields = content(data);
                const { rows } = await client.query(
                    `INSERT INTO reviews (${column}, user_id, order_id, booking_id, rating, title, comment, status, verified_purchase)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', true) RETURNING *`,
                    [
                        resourceId,
                        userId,
                        source.order_id,
                        source.booking_id,
                        fields.rating,
                        fields.title ?? null,
                        fields.comment ?? null,
                    ]
                );
                await pendingNotification(client, rows[0]);
                return rows[0];
            });
        } catch (error) {
            if (error.code === '23505')
                throw reviewError(
                    'You have already reviewed this item. Edit your existing review instead.',
                    409
                );
            throw error;
        }
    }

    static async update(id, userId, data) {
        requireUser(userId);
        return transaction(pool, async (client) => {
            const review = await findReview(client, id, userId);
            const fields = content(data);
            const keys = Object.keys(fields);
            if (!keys.length) throw reviewError('No review changes supplied');
            if (keys.every((key) => fields[key] === review[key])) return review;
            const kind = review.product_id != null ? 'product' : 'service';
            const resourceId = review.product_id ?? review.service_id;
            await findResource(client, kind, resourceId);
            const source = await purchase(client, kind, resourceId, userId);
            const values = Object.values(fields);
            values.push(source.order_id, source.booking_id, id);
            const { rows } = await client.query(
                `UPDATE reviews SET ${keys.map((key, i) => `${key} = $${i + 1}`).join(', ')},
                 order_id = $${keys.length + 1}, booking_id = $${keys.length + 2},
                 status = 'pending', verified_purchase = true, moderation_note = NULL,
                 revision = revision + 1, updated_at = NOW() WHERE id = $${keys.length + 3} RETURNING *`,
                values
            );
            await pendingNotification(client, rows[0]);
            return rows[0];
        });
    }

    static async moderate(id, actorId, data) {
        requireUser(actorId);
        return transaction(pool, async (client) => {
            const review = await findReview(client, id);
            if (review.user_id === actorId)
                throw reviewError('You cannot moderate your own review', 403);
            if (review.revision !== data.revision)
                throw reviewError(
                    'This review changed. Refresh it before moderating.',
                    409
                );
            if (
                review.status === data.status &&
                (data.moderation_note === undefined ||
                    data.moderation_note === review.moderation_note)
            )
                return review;
            const kind = review.product_id != null ? 'product' : 'service';
            const target = await findResource(
                client,
                kind,
                review.product_id ?? review.service_id
            );
            let source = {
                order_id: review.order_id,
                booking_id: review.booking_id,
            };
            if (data.status === 'approved')
                source = await purchase(
                    client,
                    kind,
                    target.id,
                    review.user_id
                );
            const { rows } = await client.query(
                `UPDATE reviews SET status = $1, moderation_note = $2,
                 order_id = $3, booking_id = $4, verified_purchase = $5,
                 revision = revision + 1, updated_at = NOW() WHERE id = $6 RETURNING *`,
                [
                    data.status,
                    data.moderation_note ?? null,
                    source.order_id,
                    source.booking_id,
                    data.status === 'approved'
                        ? true
                        : review.verified_purchase,
                    id,
                ]
            );
            const updated = rows[0];
            if (review.status !== data.status) {
                await Notification.createNotification(
                    review.user_id,
                    'review',
                    'Review status updated',
                    `Your review is ${data.status}.`,
                    { ...metadata(review), status: data.status },
                    client
                );
                if (data.status === 'approved') {
                    const recipients = await vendorRecipients(
                        client,
                        [target.vendor_id],
                        kind === 'product' ? 'products' : 'services'
                    );
                    await Notification.createMany(
                        recipients.filter(
                            (userId) => userId !== review.user_id
                        ),
                        'review',
                        'New customer review',
                        'A customer review has been published for your listing.',
                        metadata(review),
                        client
                    );
                }
            }
            return updated;
        });
    }

    static async delete(id, userId, staff = false) {
        requireUser(userId);
        return transaction(pool, async (client) => {
            const review = await findReview(client, id, staff ? null : userId);
            await client.query('DELETE FROM reviews WHERE id = $1', [id]);
            if (staff && review.user_id !== userId) {
                await Notification.createNotification(
                    review.user_id,
                    'review',
                    'Review removed',
                    'Your review was removed by the moderation team.',
                    metadata(review),
                    client
                );
            }
            return { id };
        });
    }

    static async listPublic(
        kind,
        resourceId,
        { limit = 20, offset = 0, rating } = {}
    ) {
        const { column } = resource(kind);
        await findResource(pool, kind, resourceId, true);
        const [result, totals] = await Promise.all([
            pool.query(
                `SELECT r.id, r.rating, r.title, r.comment, r.verified_purchase, r.created_at, r.updated_at,
                 u.firstname AS reviewer_name FROM reviews r JOIN users u ON u.id = r.user_id
                 WHERE r.${column} = $1 AND r.status = 'approved' AND ($2::integer IS NULL OR r.rating = $2)
                 ORDER BY r.created_at DESC, r.id DESC LIMIT $3 OFFSET $4`,
                [resourceId, rating ?? null, limit, offset]
            ),
            pool.query(
                `SELECT COUNT(*)::integer AS review_count, ROUND(AVG(rating), 1)::float8 AS average_rating,
                 COUNT(*) FILTER (WHERE $2::integer IS NULL OR rating = $2)::integer AS filtered_count,
                 json_build_object('1', COUNT(*) FILTER (WHERE rating = 1), '2', COUNT(*) FILTER (WHERE rating = 2),
                 '3', COUNT(*) FILTER (WHERE rating = 3), '4', COUNT(*) FILTER (WHERE rating = 4),
                 '5', COUNT(*) FILTER (WHERE rating = 5)) AS ratings
                 FROM reviews WHERE ${column} = $1 AND status = 'approved'`,
                [resourceId, rating ?? null]
            ),
        ]);
        const { filtered_count, ...summary } = totals.rows[0];
        return {
            rows: result.rows,
            total: filtered_count,
            limit,
            offset,
            summary,
        };
    }

    static async view(id, userId, staff = false) {
        requireUser(userId);
        const { rows } = await pool.query(
            'SELECT * FROM reviews WHERE id = $1 AND ($2::boolean OR user_id = $3)',
            [id, staff, userId]
        );
        if (!rows[0]) throw reviewError('Review not found', 404);
        return rows[0];
    }

    static async list(userId, filters = {}, staff = false) {
        requireUser(userId);
        const { limit = 20, offset = 0 } = filters;
        const values = [staff, userId];
        const where = ['($1::boolean OR r.user_id = $2)'];
        for (const key of ['status', 'product_id', 'service_id', 'rating']) {
            if (filters[key] !== undefined) {
                values.push(filters[key]);
                where.push(`r.${key} = $${values.length}`);
            }
        }
        const [result, count] = await Promise.all([
            pool.query(
                `SELECT r.* FROM reviews r WHERE ${where.join(' AND ')} ORDER BY r.id DESC
                LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
                [...values, limit, offset]
            ),
            pool.query(
                `SELECT COUNT(*)::integer AS total FROM reviews r WHERE ${where.join(' AND ')}`,
                values
            ),
        ]);
        return { rows: result.rows, total: count.rows[0].total, limit, offset };
    }
}

export default Review;
