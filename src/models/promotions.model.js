import pool from '#services/pg_pool.js';

export class Promotions {
    static VALID_PLACEMENTS = new Set([
        'homepage_banner',
        'featured_strip',
        'category_hero',
        'vendor_banner',
        'homepage_hero',
        'category_top_bar',
        'product_sidebar',
    ]);

    static VALID_STATUSES = new Set(['draft', 'active', 'paused', 'expired']);

    static normalizePlacement(placement) {
        const value = String(placement ?? 'homepage_banner').trim().toLowerCase().replace(/\s+/g, '_');
        return this.VALID_PLACEMENTS.has(value) ? value : 'homepage_banner';
    }

    static normalizeStatus(status) {
        const value = String(status ?? 'draft').trim().toLowerCase();
        return this.VALID_STATUSES.has(value) ? value : 'draft';
    }

    static filterActive(rows = [], now = new Date()) {
        const current = new Date(now);

        return [...rows]
            .filter((row) => {
                if (row.status !== 'active') return false;
                const startAt = row.start_at ? new Date(row.start_at) : null;
                const endAt = row.end_at ? new Date(row.end_at) : null;
                if (startAt && startAt > current) return false;
                if (endAt && endAt < current) return false;
                return true;
            })
            .sort((a, b) => {
                const diff = Number(b.priority ?? 0) - Number(a.priority ?? 0);
                if (diff !== 0) return diff;
                return new Date(a.start_at).getTime() - new Date(b.start_at).getTime();
            });
    }

    static validatePayload(payload = {}) {
        const placement = this.normalizePlacement(payload.placement);
        const status = this.normalizeStatus(payload.status);
        const priceModel = ['fixed', 'dynamic', 'hybrid'].includes(String(payload.pricing_model ?? 'dynamic').toLowerCase())
            ? String(payload.pricing_model).toLowerCase()
            : 'dynamic';

        const startAt = payload.start_at ? new Date(payload.start_at) : null;
        const endAt = payload.end_at ? new Date(payload.end_at) : null;
        if (!startAt || Number.isNaN(startAt.getTime())) {
            const error = new Error('Promotion start date is required.');
            error.status = 400;
            throw error;
        }
        if (endAt && !Number.isNaN(endAt.getTime()) && endAt < startAt) {
            const error = new Error('Promotion end date must be after the start date.');
            error.status = 400;
            throw error;
        }

        const safeBaseDailyRate = payload.base_daily_rate === undefined || payload.base_daily_rate === null
            ? null
            : Number(payload.base_daily_rate);
        const safeMinTotalPrice = payload.min_total_price === undefined || payload.min_total_price === null
            ? null
            : Number(payload.min_total_price);
        const safeDefaultMultiplier = payload.default_multiplier === undefined || payload.default_multiplier === null
            ? null
            : Number(payload.default_multiplier);

        if (safeBaseDailyRate !== null && (!Number.isFinite(safeBaseDailyRate) || safeBaseDailyRate < 0)) {
            const error = new Error('base_daily_rate must be a valid non-negative number.');
            error.status = 400;
            throw error;
        }

        if (safeMinTotalPrice !== null && (!Number.isFinite(safeMinTotalPrice) || safeMinTotalPrice < 0)) {
            const error = new Error('min_total_price must be a valid non-negative number.');
            error.status = 400;
            throw error;
        }

        if (safeDefaultMultiplier !== null && (!Number.isFinite(safeDefaultMultiplier) || safeDefaultMultiplier < 0)) {
            const error = new Error('default_multiplier must be a valid non-negative number.');
            error.status = 400;
            throw error;
        }

        return {
            vendor_id: Number(payload.vendor_id ?? null),
            target_type: payload.target_type ?? 'vendor',
            target_id: payload.target_id === undefined || payload.target_id === null ? null : Number(payload.target_id),
            placement,
            pricing_model: priceModel,
            base_daily_rate: safeBaseDailyRate,
            min_total_price: safeMinTotalPrice,
            default_multiplier: safeDefaultMultiplier,
            auto_reprice: payload.auto_reprice !== false,
            title: payload.title ?? null,
            subtitle: payload.subtitle ?? null,
            image_url: payload.image_url ?? null,
            cta_label: payload.cta_label ?? null,
            cta_link: payload.cta_link ?? null,
            start_at: startAt.toISOString(),
            end_at: endAt ? endAt.toISOString() : null,
            status,
            priority: Number.isInteger(Number(payload.priority)) ? Number(payload.priority) : 0,
            is_paid: Boolean(payload.is_paid),
        };
    }

    static async listByPlacement(placement, limit = 10, vendorId = null) {
        const normalizedPlacement = this.normalizePlacement(placement);
        const safeLimit = Math.min(20, Math.max(1, Number(limit) || 10));

        const params = [normalizedPlacement];
        let query = `
            SELECT *
            FROM promotions
            WHERE placement = $1
              AND status = 'active'
              AND start_at <= NOW()
              AND (end_at IS NULL OR end_at >= NOW())
        `;

        if (vendorId !== null && vendorId !== undefined) {
            query += ' AND vendor_id = $2';
            params.push(Number(vendorId));
        }

        query += ` ORDER BY priority DESC, start_at DESC LIMIT $${params.length + 1}`;
        params.push(safeLimit);

        const { rows } = await pool.query(query, params);
        return rows;
    }

    static async list({ placement, vendorId = null, status = 'active', limit = 20, offset = 0 } = {}) {
        const safeLimit = Math.min(50, Math.max(1, Number(limit) || 20));
        const safeOffset = Math.max(0, Number(offset) || 0);

        const filters = [];
        const params = [];

        if (vendorId !== null && vendorId !== undefined) {
            filters.push('vendor_id = $1');
            params.push(Number(vendorId));
        }

        if (placement) {
            const normalizedPlacement = this.normalizePlacement(placement);
            filters.push(`placement = $${params.length + 1}`);
            params.push(normalizedPlacement);
        }

        if (status) {
            filters.push(`status = $${params.length + 1}`);
            params.push(String(status).toLowerCase());
        }

        let query = 'SELECT * FROM promotions';
        if (filters.length > 0) {
            query += ` WHERE ${filters.join(' AND ')}`;
        }
        query += ' ORDER BY priority DESC, start_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
        params.push(safeLimit, safeOffset);

        const { rows } = await pool.query(query, params);
        return rows;
    }

    static async findById(id, vendorId = null) {
        const numericId = Number(id);
        if (!Number.isInteger(numericId) || numericId < 1) {
            const error = new Error('Invalid promotion ID.');
            error.status = 400;
            throw error;
        }

        const params = [numericId];
        let query = 'SELECT * FROM promotions WHERE id = $1';

        if (vendorId !== null && vendorId !== undefined) {
            query += ' AND vendor_id = $2';
            params.push(Number(vendorId));
        }

        const { rows } = await pool.query(query, params);
        return rows[0] ?? null;
    }

    static async create(vendorId, payload = {}) {
        const safeVendorId = Number(vendorId);
        if (!Number.isInteger(safeVendorId) || safeVendorId < 1) {
            const error = new Error('Vendor authentication required.');
            error.status = 403;
            throw error;
        }

        const values = this.validatePayload({ ...payload, vendor_id: safeVendorId });
        const columns = Object.keys(values);
        const placeholders = columns.map((_, index) => `$${index + 1}`);
        const query = `INSERT INTO promotions (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
        const { rows } = await pool.query(query, Object.values(values));
        return rows[0];
    }

    static async update(id, vendorId, payload = {}) {
        const existing = await this.findById(id, vendorId);
        if (!existing) {
            const error = new Error('Promotion not found.');
            error.status = 404;
            throw error;
        }

        const values = this.validatePayload({ ...existing, ...payload, vendor_id: vendorId });
        const assignments = [];
        const params = [];

        Object.entries(values).forEach(([key, value]) => {
            if (key === 'vendor_id') return;
            assignments.push(`${key} = $${params.length + 1}`);
            params.push(value);
        });

        params.push(Number(id));
        const query = `UPDATE promotions SET ${assignments.join(', ')} WHERE id = $${params.length} RETURNING *`;
        const { rows } = await pool.query(query, params);
        return rows[0];
    }

    static async remove(id, vendorId) {
        const existing = await this.findById(id, vendorId);
        if (!existing) {
            const error = new Error('Promotion not found.');
            error.status = 404;
            throw error;
        }

        const { rowCount } = await pool.query('DELETE FROM promotions WHERE id = $1 AND vendor_id = $2', [Number(id), Number(vendorId)]);
        if (rowCount === 0) {
            const error = new Error('Promotion could not be deleted.');
            error.status = 409;
            throw error;
        }

        return existing;
    }

    static async getLandingPage(placements = ['homepage_banner', 'featured_strip']) {
        const normalized = [...new Set(placements.map((item) => this.normalizePlacement(item)))];
        const results = {};

        for (const placement of normalized) {
            results[placement] = await this.listByPlacement(placement, 10);
        }

        return results;
    }
}

export default Promotions;
