import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/services/pg_pool.js';
import Review from '../src/models/review.model.js';
import * as Controller from '../src/controllers/review.controller.js';
import {
    createReviewSchema,
    updateReviewSchema,
    moderateReviewSchema,
} from '../src/schemas/reviews.schema.js';

const existing = {
    id: 7,
    user_id: 1,
    product_id: 3,
    service_id: null,
    order_id: 9,
    booking_id: null,
    rating: 4,
    title: null,
    comment: 'Good product',
    status: 'approved',
    revision: 2,
    verified_purchase: true,
    moderation_note: null,
};
function database(t, handler = () => undefined) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        const result = handler(sql, values);
        if (result !== undefined) return result;
        if (sql.startsWith('SELECT p.id, p.vendor_id'))
            return { rows: [{ id: 3, vendor_id: 5 }] };
        if (sql.startsWith('SELECT o.id') || sql.startsWith('SELECT b.id'))
            return { rows: [{ id: 9 }] };
        if (sql.startsWith('SELECT * FROM reviews'))
            return { rows: [existing] };
        if (sql.startsWith('INSERT INTO reviews'))
            return { rows: [{ ...existing, status: 'pending', revision: 1 }] };
        if (sql.startsWith('UPDATE reviews'))
            return { rows: [{ ...existing, revision: 3 }] };
        if (sql.includes('FROM users u JOIN')) return { rows: [{ id: 20 }] };
        if (sql.startsWith('SELECT COUNT'))
            return {
                rows: [
                    {
                        total: 1,
                        review_count: 1,
                        filtered_count: 1,
                        average_rating: 4,
                        ratings: { 4: 1 },
                    },
                ],
            };
        return { rows: [], rowCount: 0 };
    };
    t.mock.method(pool, 'query', query);
    t.mock.method(pool, 'connect', async () => ({
        query,
        release() {
            calls.push({ sql: 'RELEASE' });
        },
    }));
    return calls;
}
const response = () => ({
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
});

test('review schema imports and accepts integer ratings with the legacy rate alias', () => {
    assert.equal(
        createReviewSchema.validate({ rating: 5, comment: '  Great  ' }).value
            .comment,
        'Great'
    );
    assert.deepEqual(createReviewSchema.validate({ rate: 4 }).value, {
        rating: 4,
    });
    for (const body of [
        {},
        { comment: 'Good' },
        { rating: 2.5 },
        { rating: 0 },
        { rating: 6 },
        { rating: 3, rate: 4 },
        { rating: 5, comment: ' ' },
        { rating: 5, user_id: 20 },
        { rating: 5, verified_purchase: true },
        { rating: 5, status: 'approved' },
    ]) {
        assert.ok(
            createReviewSchema.validate(body).error,
            JSON.stringify(body)
        );
    }
    assert.ok(updateReviewSchema.validate({}).error);
    assert.ok(updateReviewSchema.validate({ helpful_count: 99 }).error);
    assert.ok(moderateReviewSchema.validate({ status: 'approved' }).error);
});

test('product review eligibility checks a paid, delivered purchase by the authenticated customer', async (t) => {
    const calls = database(t);
    await Review.create('product', 3, 1, { rating: 4, comment: 'Nice' });
    const purchase = calls.find(({ sql }) => sql.startsWith('SELECT o.id'));
    assert.deepEqual(purchase.values, [3, 1]);
    assert.match(purchase.sql, /o.payment_status = 'paid'/);
    assert.match(purchase.sql, /o.status = 'delivered'/);
    assert.match(purchase.sql, /FOR SHARE OF o/);
    const insert = calls.find(({ sql }) =>
        sql.startsWith('INSERT INTO reviews')
    );
    assert.deepEqual(insert.values, [3, 1, 9, null, 4, null, 'Nice']);
    assert.match(insert.sql, /'pending', true/);
    assert.equal(calls.at(-2).sql, 'COMMIT');
});

test('service reviews require completed paid bookings and retain booking provenance', async (t) => {
    const calls = database(t);
    await Review.create('service', 3, 1, { rating: 5 });
    const purchase = calls.find(({ sql }) => sql.startsWith('SELECT b.id'));
    assert.match(purchase.sql, /b.booking_status = 'completed'/);
    assert.match(purchase.sql, /b.payment_status = 'paid'/);
    const insert = calls.find(({ sql }) =>
        sql.startsWith('INSERT INTO reviews')
    );
    assert.match(insert.sql, /\(service_id, user_id/);
    assert.deepEqual(insert.values.slice(0, 5), [3, 1, null, 9, 5]);
});

test('ineligible purchase rolls back before a review or notification can be written', async (t) => {
    const calls = database(t, (sql) =>
        sql.startsWith('SELECT o.id') ? { rows: [] } : undefined
    );
    await assert.rejects(Review.create('product', 3, 1, { rating: 5 }), {
        status: 403,
    });
    assert.ok(!calls.some(({ sql }) => sql.startsWith('INSERT')));
    assert.equal(calls.at(-2).sql, 'ROLLBACK');
});

test('missing resource is a 404 and database uniqueness conflicts are a 409', async (t) => {
    const calls = database(t, (sql) => {
        if (sql.startsWith('INSERT INTO reviews'))
            throw Object.assign(new Error('duplicate'), { code: '23505' });
    });
    await assert.rejects(Review.create('product', 3, 1, { rating: 5 }), {
        status: 409,
    });
    assert.equal(calls.at(-2).sql, 'ROLLBACK');
    t.mock.method(pool, 'query', async () => ({ rows: [] }));
    await assert.rejects(Review.listPublic('product', 999), { status: 404 });
});

test('notification failure rolls back a newly submitted review', async (t) => {
    const calls = database(t, (sql) => {
        if (sql.startsWith('INSERT INTO notifications'))
            throw new Error('notification failed');
    });
    await assert.rejects(
        Review.create('product', 3, 1, { rating: 5 }),
        /notification failed/
    );
    assert.equal(calls.at(-2).sql, 'ROLLBACK');
});

test('editing and deletion cannot access another customer review', async (t) => {
    const calls = database(t, (sql) =>
        sql.startsWith('SELECT * FROM reviews') ? { rows: [] } : undefined
    );
    await assert.rejects(Review.update(7, 2, { rating: 2 }), { status: 404 });
    await assert.rejects(Review.delete(7, 2), { status: 404 });
    assert.ok(
        calls
            .filter(({ sql }) => sql.startsWith('SELECT * FROM reviews'))
            .every(({ values }) => values[1] === 2)
    );
    assert.ok(
        !calls.some(
            ({ sql }) => sql.startsWith('UPDATE') || sql.startsWith('DELETE')
        )
    );
});

test('editing resets moderation and advances the revision without accepting protected fields', async (t) => {
    const calls = database(t);
    await Review.update(7, 1, { rating: 2, status: 'approved', user_id: 99 });
    const update = calls.find(({ sql }) => sql.startsWith('UPDATE reviews'));
    assert.match(update.sql, /status = 'pending'/);
    assert.match(update.sql, /revision = revision \+ 1/);
    assert.match(update.sql, /moderation_note = NULL/);
    assert.deepEqual(update.values, [2, 9, null, 7]);
});

test('saving unchanged content does not reset approval or send another notification', async (t) => {
    const calls = database(t);
    const result = await Review.update(7, 1, { rating: 4 });
    assert.equal(result.status, 'approved');
    assert.ok(
        !calls.some(
            ({ sql }) => sql.startsWith('UPDATE') || sql.startsWith('INSERT')
        )
    );
});

test('moderation rejects stale revisions and self-approval before modifying a review', async (t) => {
    const calls = database(t);
    await assert.rejects(
        Review.moderate(7, 20, { status: 'approved', revision: 1 }),
        { status: 409 }
    );
    await assert.rejects(
        Review.moderate(7, 1, { status: 'approved', revision: 2 }),
        { status: 403 }
    );
    assert.ok(!calls.some(({ sql }) => sql.startsWith('UPDATE')));
});

test('approval rechecks eligibility and notifies the author and vendor without review text', async (t) => {
    const calls = database(t, (sql) =>
        sql.startsWith('SELECT * FROM reviews')
            ? { rows: [{ ...existing, status: 'pending' }] }
            : undefined
    );
    await Review.moderate(7, 20, { status: 'approved', revision: 2 });
    assert.ok(calls.some(({ sql }) => sql.startsWith('SELECT o.id')));
    const writes = calls.filter(({ sql }) =>
        sql.startsWith('INSERT INTO notifications')
    );
    assert.equal(writes.length, 2);
    assert.deepEqual(writes[0].values[0], [1]);
    assert.ok(!JSON.stringify(writes).includes('Good product'));
});

test('rejection does not alert vendors and pending edits are never included in public totals', async (t) => {
    const calls = database(t);
    await Review.moderate(7, 20, {
        status: 'rejected',
        revision: 2,
        moderation_note: 'Please remove personal details',
    });
    assert.equal(
        calls.filter(({ sql }) => sql.startsWith('INSERT INTO notifications'))
            .length,
        1
    );
    const result = await Review.listPublic('product', 3, {
        limit: 5,
        offset: 0,
        rating: 4,
    });
    assert.equal(result.summary.average_rating, 4);
    const publicRead = calls.find(({ sql }) => sql.startsWith('SELECT r.id'));
    assert.match(publicRead.sql, /r.status = 'approved'/);
    assert.ok(!publicRead.sql.includes('r.*'));
    assert.ok(!publicRead.sql.includes('u.email'));
    assert.deepEqual(publicRead.values, [3, 4, 5, 0]);
    assert.match(
        calls.find(({ sql }) => sql.startsWith('SELECT COUNT')).sql,
        /status = 'approved'/
    );
});

test('owner and staff inbox queries keep scope and filters separate', async (t) => {
    const calls = database(t);
    await Review.list(1, { status: 'pending', product_id: 3 });
    assert.deepEqual(calls[0].values, [false, 1, 'pending', 3, 20, 0]);
    await Review.list(20, {}, true);
    assert.deepEqual(calls[2].values, [true, 20, 20, 0]);
});

test('controllers enforce roles, validate IDs and reject forged moderation state', async (t) => {
    const calls = database(t);
    for (const request of [
        { params: { productId: '3' }, body: { rating: 5 } },
        {
            auth: { userId: 2, role: 'vendor' },
            params: { productId: '3' },
            body: { rating: 5 },
        },
        {
            auth: { userId: 1, role: 'customer' },
            params: { productId: '3oops' },
            body: { rating: 5 },
        },
        {
            auth: { userId: 1, role: 'customer' },
            params: { productId: '3' },
            body: { rating: 5, status: 'approved' },
        },
    ]) {
        const res = response();
        await Controller.createReview(request, res);
        assert.ok([400, 401, 403].includes(res.statusCode));
    }
    const res = response();
    await Controller.moderateReview(
        {
            auth: { userId: 2, role: 'vendor' },
            params: { reviewId: '7' },
            body: { status: 'approved', revision: 2 },
        },
        res
    );
    assert.equal(res.statusCode, 403);
    assert.equal(calls.length, 0);
});

test('create controller maps rate to rating and returns a pending review', async (t) => {
    const calls = database(t);
    const res = response();
    await Controller.createReview(
        {
            auth: { userId: 1, role: 'customer' },
            params: { productId: '3' },
            body: { rate: 4 },
        },
        res
    );
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.result.status, 'pending');
    assert.equal(
        calls.find(({ sql }) => sql.startsWith('INSERT INTO reviews'))
            .values[4],
        4
    );
});

test('review detail access is scoped to its author unless explicitly called by staff', async (t) => {
    const calls = database(t);
    await Review.view(7, 1);
    assert.deepEqual(calls[0].values, [7, false, 1]);
    await Review.view(7, 20, true);
    assert.deepEqual(calls[1].values, [7, true, 20]);
});

test('model mutations reject missing actors rather than treating them as unrestricted access', async (t) => {
    const calls = database(t);
    await assert.rejects(Review.update(7, undefined, { rating: 2 }), {
        status: 401,
    });
    await assert.rejects(Review.delete(7, null), { status: 401 });
    await assert.rejects(
        Review.moderate(7, null, { status: 'approved', revision: 2 }),
        { status: 401 }
    );
    assert.equal(calls.length, 0);
});
