import pool from '#services/pg_pool.js';
import Shipbubble from '#services/shipbubble.service.js';
import Shipment from '#models/shipment.model.js';

const providerStatusMap = {
    pending: 'pending',
    confirmed: 'shipped',
    picked_up: 'shipped',
    in_transit: 'in_transit',
    completed: 'delivered',
    cancelled: 'cancelled',
};

function labelUpdate(label) {
    const providerStatus =
        typeof label?.status === 'string' ? label.status.toLowerCase() : null;
    const status = providerStatusMap[providerStatus];
    if (!status) return null;

    const events = Array.isArray(label.events) ? label.events : [];
    const packageStatuses = Array.isArray(label.package_status)
        ? label.package_status
        : [];
    const lastEvent = events.at(-1) ?? packageStatuses.at(-1) ?? null;
    const description =
        (typeof lastEvent?.message === 'string' && lastEvent.message) ||
        (typeof lastEvent?.status === 'string' &&
            `Package status: ${lastEvent.status}`) ||
        (typeof label.courier?.tracking_message === 'string' &&
            label.courier.tracking_message) ||
        `ShipBubble status: ${providerStatus}`;

    return {
        status,
        tracking_number: label.courier?.tracking_code ?? undefined,
        tracking_url: label.courier?.tracking_url ?? label.tracking_url ?? undefined,
        waybill_document:
            label.waybill_document ?? label.waybill_url ?? undefined,
        carrier: label.courier?.name ?? label.courier?.courier_name ?? undefined,
        location:
            typeof lastEvent?.location === 'string'
                ? lastEvent.location.slice(0, 255)
                : undefined,
        tracking_description: String(description).slice(0, 500),
    };
}

async function listAllLabels() {
    const labels = new Map();
    let page = 1;
    const seenPages = new Set();

    while (!seenPages.has(page)) {
        seenPages.add(page);
        const response = await Shipbubble.listLabels({ Page: page, PerPage: 50 });
        const data = response?.data;
        if (!Array.isArray(data?.results))
            throw new Error('ShipBubble labels response did not contain results');

        for (const label of data.results) {
            if (label?.order_id !== undefined && label?.order_id !== null)
                labels.set(String(label.order_id), label);
        }

        const nextPage = Number(data.pagination?.next);
        if (!Number.isSafeInteger(nextPage) || nextPage <= 0 || nextPage === page)
            break;
        page = nextPage;
    }

    return labels;
}

async function reconcileShipments() {
    const { rows: shipments } = await pool.query(
        `SELECT s.id, s.vendor_id, s.shipbubble_order_id
         FROM shipments s
         JOIN orders o ON o.id = s.order_id
         WHERE s.shipbubble_order_id IS NOT NULL AND s.vendor_id IS NOT NULL
           AND s.status NOT IN ('delivered', 'cancelled', 'failed')
           AND o.payment_status = 'paid'
           AND o.status NOT IN ('cancelled', 'refunded', 'payment_review')
         ORDER BY s.updated_at, s.id`
    );
    if (!shipments.length) return;

    const labels = await listAllLabels();
    for (const shipment of shipments) {
        const label = labels.get(String(shipment.shipbubble_order_id));
        const update = labelUpdate(label);
        if (!update) continue;
        try {
            await Shipment.updateShipment(
                shipment.id,
                shipment.vendor_id,
                update,
                null,
                true,
                true
            );
        } catch (error) {
            console.error(
                'ShipBubble tracking reconciliation failed:',
                shipment.shipbubble_order_id,
                error.message
            );
        }
    }
}

export function startShipbubbleTrackingWorker({ intervalMs = 15 * 60 * 1000 } = {}) {
    let running = false;
    const run = async () => {
        if (running) return;
        running = true;
        let lockClient;
        try {
            const keyName = process.env.NODE_ENV === 'production'
                ? 'SHIPBUBBLE_LIVE_KEY'
                : 'SHIPBUBBLE_TEST_KEY';
            if (!process.env[keyName]?.trim()) return;

            lockClient = await pool.connect();
            const { rows } = await lockClient.query(
                'SELECT pg_try_advisory_lock($1::bigint) AS locked',
                [80464311]
            );
            if (!rows[0]?.locked) return;
            await reconcileShipments();
        } catch (error) {
            console.error('ShipBubble tracking worker failed:', error.message);
        } finally {
            if (lockClient) {
                try {
                    await lockClient.query(
                        'SELECT pg_advisory_unlock($1::bigint)',
                        [80464311]
                    );
                } catch (error) {
                    console.error(
                        'Could not release ShipBubble tracking lock:',
                        error.message
                    );
                }
                lockClient.release();
            }
            running = false;
        }
    };

    const timer = setInterval(run, intervalMs);
    timer.unref();
    void run();
    return () => clearInterval(timer);
}
