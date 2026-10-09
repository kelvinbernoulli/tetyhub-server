import test from 'node:test';
import assert from 'node:assert/strict';
import pool from '../src/services/pg_pool.js';
import ServicePackages from '../src/models/service-packages.model.js';
import * as Controller from '../src/controllers/service-packages.controller.js';
import {
    createServicePackageSchema,
    updateServicePackageSchema,
} from '../src/schemas/service-packages.schema.js';
import { PLAN_DEFINITIONS } from '../src/config/plans.js';

const packageRow = {
    id: 12,
    service_id: 7,
    name: 'Standard',
    description: 'Standard package',
    price: '5000.00',
    duration_mins: 60,
    status: 'active',
};

function mockDatabase(t, handler = () => undefined) {
    const calls = [];
    const query = async (sql, values = []) => {
        calls.push({ sql, values });
        const specific = handler(sql, values);
        if (specific !== undefined) return specific;
        if (sql.startsWith('SELECT pg_advisory_xact_lock'))
            return { rows: [{}] };
        if (sql.includes('FROM subscriptions s')) return { rows: [] };
        if (sql.includes('FROM plan_versions')) {
            return {
                rows: Object.values(PLAN_DEFINITIONS).map((plan) => ({
                    plan: plan.code,
                    priceNaira: plan.priceNaira,
                    commissionPercent: plan.commissionPercent,
                    activeServices: plan.activeServices,
                    packagesPerService: plan.packagesPerService,
                    portfolioImages: plan.portfolioImages,
                    promotedSlotsPerMonth: plan.promotedSlotsPerMonth,
                    analytics: plan.analytics,
                    support: plan.support,
                })),
            };
        }
        if (sql.includes('SELECT id FROM services')) return { rows: [{ id: 7 }] };
        if (sql.includes('FROM service_packages') && sql.includes('COUNT'))
            return { rows: [{ count: 0 }] };
        if (sql.includes('FROM service_packages') && sql.includes('ORDER BY'))
            return { rows: [packageRow] };
        if (sql.includes('FROM service_packages') && sql.includes('SELECT id'))
            return { rows: [{ id: 12 }] };
        if (sql.startsWith('INSERT INTO service_packages'))
            return { rows: [packageRow] };
        if (sql.startsWith('UPDATE service_packages'))
            return { rows: [{ id: 12 }] };
        return { rows: [] };
    };
    t.mock.method(pool, 'query', query);
    t.mock.method(pool, 'connect', async () => ({ query, release() {} }));
    return calls;
}

const response = () => ({
    status(code) {
        this.code = code;
        return this;
    },
    json(body) {
        this.body = body;
        return this;
    },
});

test('package schemas validate create and partial update data', () => {
    assert.equal(
        createServicePackageSchema.validate({
            name: 'Standard',
            description: 'Standard package',
            price: 5000,
        }).error,
        undefined
    );
    assert.equal(
        createServicePackageSchema.validate({
            name: 'Standard',
            price: 5000,
            duration_mins: 60,
        }).value.duration_mins,
        60
    );
    assert.equal(
        updateServicePackageSchema.validate({ status: 'paused' }).error,
        undefined
    );
    for (const invalid of [
        { name: 'X', price: 5000 },
        { name: 'Standard', price: 5000.999 },
        { name: 'Standard', price: -1 },
        { name: 'Standard', price: 5000, vendor_id: 9 },
        { name: 'Standard', price: 5000, duration_mins: 10 },
    ]) {
        assert.ok(createServicePackageSchema.validate(invalid).error);
    }
});

test('package create checks ownership and plan capacity before insert', async (t) => {
    const calls = mockDatabase(t);
    const result = await ServicePackages.create(7, 3, {
        name: 'Standard',
        description: 'Standard package',
        price: 5000,
        duration_mins: 60,
    });

    assert.equal(result.id, packageRow.id);
    assert.ok(calls.some(({ sql }) => sql.includes('pg_advisory_xact_lock')));
    assert.ok(
        calls.some(({ sql }) => sql.includes('COUNT(*)::integer') &&
            sql.includes('service_packages'))
    );
    const insert = calls.find(({ sql }) =>
        sql.startsWith('INSERT INTO service_packages')
    );
    assert.deepEqual(insert.values, [7, 'Standard', 'Standard package', 5000, 60, 'active']);
});

test('package create returns not-found without allowing access to another vendor service', async (t) => {
    const calls = mockDatabase(t, (sql) =>
        sql.includes('SELECT id FROM services')
            ? { rows: [] }
            : undefined
    );
    assert.equal(
        await ServicePackages.create(7, 3, {
            name: 'Standard',
            price: 5000,
        }),
        null
    );
    assert.ok(!calls.some(({ sql }) => sql.startsWith('INSERT')));
});

test('package list, update and delete are scoped to the owned service', async (t) => {
    const calls = mockDatabase(t);
    assert.deepEqual(await ServicePackages.list(7, 3), [packageRow]);
    assert.deepEqual(
        await ServicePackages.update(7, 12, 3, { name: 'Updated' }),
        { id: 12 }
    );
    assert.deepEqual(await ServicePackages.delete(7, 12, 3), { id: 12 });
    assert.ok(
        calls.some(({ sql }) =>
            sql.includes('SET deleted_at = NOW(), status =') &&
            sql.includes('deleted_at IS NULL')
        )
    );
});

test('package create returns structured plan limit details', async (t) => {
    mockDatabase(t, (sql) =>
        sql.includes('FROM service_packages') && sql.includes('COUNT')
            ? { rows: [{ count: 1 }] }
            : undefined
    );
    const res = response();
    await Controller.create(
        {
            auth: { vendorId: 3 },
            params: { serviceId: '7' },
            body: { name: 'Premium', price: 9000 },
        },
        res
    );
    assert.equal(res.code, 403);
    assert.equal(res.body.code, 'PLAN_LIMIT_REACHED');
    assert.equal(res.body.limitName, 'packagesPerService');
    assert.equal(res.body.limit, 1);
    assert.equal(res.body.planNeeded, 'PRO');
});
