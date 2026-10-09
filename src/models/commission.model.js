import pool from '#services/pg_pool.js';
import { transaction } from '#utils/checkout.js';

export default class Commission {
    static async getRates(client = pool) {
        const { rows } = await client.query(
            'SELECT product_rate, service_rate, updated_by, updated_at FROM platform_commission_settings WHERE id = 1'
        );
        return rows[0] ?? { product_rate: '0.00', service_rate: '0.00' };
    }

    static async updateRates({ product_rate, service_rate }, changedBy) {
        return transaction(pool, async (client) => {
            const previous = await this.getRates(client);
            const { rows } = await client.query(
                `UPDATE platform_commission_settings
                 SET product_rate = $1, service_rate = $2, updated_by = $3, updated_at = NOW()
                 WHERE id = 1 RETURNING product_rate, service_rate, updated_by, updated_at`,
                [product_rate, service_rate, changedBy]
            );
            const rates = rows[0];
            if (!rates)
                throw new Error('Commission settings row is missing');
            if (
                String(previous.product_rate) !== String(rates.product_rate) ||
                String(previous.service_rate) !== String(rates.service_rate)
            ) {
                await client.query(
                    `INSERT INTO platform_commission_settings_history
                     (product_rate, service_rate, changed_by) VALUES ($1, $2, $3)`,
                    [rates.product_rate, rates.service_rate, changedBy]
                );
            }
            return rates;
        });
    }

    static async history({ limit = 50, offset = 0 } = {}) {
        const { rows } = await pool.query(
            `SELECT h.*, u.firstname, u.lastname
             FROM platform_commission_settings_history h
             LEFT JOIN users u ON u.id = h.changed_by
             ORDER BY h.created_at DESC, h.id DESC LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        return rows;
    }
}
