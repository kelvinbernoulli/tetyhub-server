const API_BASE_URL = 'https://api.shipbubble.com/v1';

export class ShipbubbleError extends Error {
    constructor(message, status = 502, details = null) {
        super(message);
        this.name = 'ShipbubbleError';
        this.status = status;
        this.details = details;
    }
}

async function request(path, { method = 'GET', body } = {}) {
    const isProduction = process.env.NODE_ENV === 'production';
    const keyName = isProduction
        ? 'SHIPBUBBLE_LIVE_KEY'
        : 'SHIPBUBBLE_TEST_KEY';
    const apiKey = process.env[keyName]?.trim();
    if (!apiKey) {
        throw new ShipbubbleError(
            `ShipBubble API is not configured (${keyName} is missing)`,
            503
        );
    }

    let response;
    try {
        response = await fetch(`${API_BASE_URL}${path}`, {
            method,
            headers: {
                Accept: 'application/json',
                Authorization: `Bearer ${apiKey}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: AbortSignal.timeout(15000),
        });
    } catch (error) {
        throw new ShipbubbleError(
            `ShipBubble request failed: ${error.message}`,
            502
        );
    }

    let result;
    try {
        result = await response.json();
    } catch {
        throw new ShipbubbleError(
            'ShipBubble returned an invalid JSON response',
            502
        );
    }

    if (!response.ok || result?.status === 'failed') {
        throw new ShipbubbleError(
            result?.message || 'ShipBubble request was rejected',
            response.status >= 400 && response.status < 500
                ? response.status
                : 502,
            result?.errors ?? null
        );
    }
    return result;
}

const Shipbubble = {
    validateAddress(body) {
        return request('/shipping/address/validate', { method: 'POST', body });
    },

    listPackageCategories() {
        return request('/shipping/labels/categories');
    },

    requestRates(body) {
        return request('/shipping/fetch_rates', { method: 'POST', body });
    },

    requestRatesFromCouriers(serviceCodes, body) {
        if (!Array.isArray(serviceCodes) || serviceCodes.length === 0) {
            throw new TypeError('At least one ShipBubble service code is required');
        }
        const path = `/shipping/fetch_rates/${serviceCodes
            .map((code) => encodeURIComponent(code))
            .join(',')}`;
        return request(path, { method: 'POST', body });
    },

    createLabel({ request_token, service_code, courier_id, ...options }) {
        if (!request_token || !service_code || courier_id === undefined) {
            throw new TypeError(
                'request_token, service_code, and courier_id are required'
            );
        }
        return request('/shipping/labels', {
            method: 'POST',
            body: { request_token, service_code, courier_id, ...options },
        });
    },

    listLabels(query = {}) {
        const params = new URLSearchParams(query);
        return request(
            `/shipping/labels${params.size ? `?${params.toString()}` : ''}`
        );
    },
};

export default Shipbubble;
