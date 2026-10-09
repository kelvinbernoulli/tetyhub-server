import pool from '#services/pg_pool.js';
import {
    assertCanAddPackage,
    getProviderPlan,
    lockProviderEntitlements,
} from '#services/entitlements.js';
import { serviceError } from '#utils/service-state.js';

function requireId(id, label) {
    if (!Number.isInteger(id) || id < 1 || id > 2147483647) {
        throw serviceError(`${label} is invalid`, 400);
    }
}

async function transaction(work) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}

async function assertOwnedService(client, serviceId, vendorId, lock = false) {
    const result = await client.query(
        `SELECT id FROM services
         WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL${lock ? ' FOR UPDATE' : ''}`,
        [serviceId, vendorId]
    );
    return result.rows.length > 0;
}

export class ServicePackages {
    static async list(serviceId, vendorId) {
        requireId(serviceId, 'Service ID');
        requireId(vendorId, 'Vendor ID');
        const { rows: owned } = await pool.query(
            `SELECT id FROM services
             WHERE id = $1 AND vendor_id = $2 AND deleted_at IS NULL`,
            [serviceId, vendorId]
        );
        if (!owned.length) return null;
        const { rows } = await pool.query(
            `SELECT id, service_id, name, description, price, duration_mins,
                    status, created_at, updated_at
             FROM service_packages
             WHERE service_id = $1 AND deleted_at IS NULL
             ORDER BY created_at, id`,
            [serviceId]
        );
        return rows;
    }

    static async create(serviceId, vendorId, data) {
        requireId(serviceId, 'Service ID');
        requireId(vendorId, 'Vendor ID');
        return transaction(async (client) => {
            await lockProviderEntitlements(client, vendorId);
            if (!(await assertOwnedService(client, serviceId, vendorId, true)))
                return null;

            const { plan, catalog } = await getProviderPlan(client, vendorId);
            const { rows: countRows } = await client.query(
                `SELECT COUNT(*)::integer AS count
                 FROM service_packages
                 WHERE service_id = $1 AND deleted_at IS NULL`,
                [serviceId]
            );
            assertCanAddPackage(plan, Number(countRows[0].count), { catalog });

            const { rows } = await client.query(
                `INSERT INTO service_packages
                    (service_id, name, description, price, duration_mins, status)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING id, service_id, name, description, price,
                           duration_mins, status, created_at, updated_at`,
                [
                    serviceId,
                    data.name,
                    data.description ?? null,
                    data.price,
                    data.duration_mins ?? 60,
                    data.status ?? 'active',
                ]
            );
            return rows[0];
        });
    }

    static async update(serviceId, packageId, vendorId, data) {
        requireId(serviceId, 'Service ID');
        requireId(packageId, 'Package ID');
        requireId(vendorId, 'Vendor ID');
        return transaction(async (client) => {
            await lockProviderEntitlements(client, vendorId);
            if (!(await assertOwnedService(client, serviceId, vendorId, true)))
                return null;

            const { rows: found } = await client.query(
                `SELECT id FROM service_packages
                 WHERE id = $1 AND service_id = $2 AND deleted_at IS NULL
                 FOR UPDATE`,
                [packageId, serviceId]
            );
            if (!found.length) return null;

            const keys = Object.keys(data);
            const { rows } = await client.query(
                `UPDATE service_packages
                 SET ${keys.map((key, index) => `${key} = $${index + 1}`).join(', ')},
                     updated_at = NOW()
                 WHERE id = $${keys.length + 1}
                   AND service_id = $${keys.length + 2}
                   AND deleted_at IS NULL
                 RETURNING id, service_id, name, description, price,
                           duration_mins, status, created_at, updated_at`,
                [...keys.map((key) => data[key]), packageId, serviceId]
            );
            return rows[0] ?? null;
        });
    }

    static async delete(serviceId, packageId, vendorId) {
        requireId(serviceId, 'Service ID');
        requireId(packageId, 'Package ID');
        requireId(vendorId, 'Vendor ID');
        return transaction(async (client) => {
            await lockProviderEntitlements(client, vendorId);
            if (!(await assertOwnedService(client, serviceId, vendorId, true)))
                return null;
            const { rows } = await client.query(
                `UPDATE service_packages
                 SET deleted_at = NOW(), status = 'paused', updated_at = NOW()
                 WHERE id = $1 AND service_id = $2 AND deleted_at IS NULL
                 RETURNING id`,
                [packageId, serviceId]
            );
            return rows[0] ?? null;
        });
    }
}

export default ServicePackages;
