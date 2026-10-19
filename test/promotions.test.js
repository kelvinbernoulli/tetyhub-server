import test from 'node:test';
import assert from 'node:assert/strict';
import { Promotions } from '#models/promotions.model.js';

test('filters out inactive or expired homepage promotions and keeps the highest priority active placement first', () => {
    const now = new Date('2026-10-15T12:00:00.000Z');

    const rows = [
        { id: 1, status: 'active', start_at: '2026-10-01T00:00:00.000Z', end_at: '2026-10-30T00:00:00.000Z', priority: 2 },
        { id: 2, status: 'draft', start_at: '2026-10-01T00:00:00.000Z', end_at: '2026-10-30T00:00:00.000Z', priority: 99 },
        { id: 3, status: 'active', start_at: '2026-10-14T00:00:00.000Z', end_at: '2026-10-20T00:00:00.000Z', priority: 5 },
        { id: 4, status: 'active', start_at: '2026-10-05T00:00:00.000Z', end_at: '2026-10-12T00:00:00.000Z', priority: 15 },
        { id: 5, status: 'active', start_at: '2026-10-10T00:00:00.000Z', end_at: '2026-10-20T00:00:00.000Z', priority: 30 },
    ];

    const result = Promotions.filterActive(rows, now);
    assert.deepEqual(result.map((item) => item.id), [5, 3, 1]);
});
