const progress = {
    pending: 0,
    processing: 1,
    awaiting_shipment: 2,
    packed: 3,
    shipped: 4,
    out_for_delivery: 5,
    delivered: 6,
};

export function aggregateFulfillmentStatus(statuses, fallback) {
    if (!statuses.length) return fallback;
    if (statuses.every((status) => status === statuses[0])) return statuses[0];
    if (statuses.some((status) => ['cancelled', 'returned', 'refunded'].includes(status)))
        return fallback;
    const active = statuses.filter((status) => Object.hasOwn(progress, status));
    if (!active.length) return fallback;
    return active.reduce((earliest, status) =>
        progress[status] < progress[earliest] ? status : earliest
    );
}

export function shipmentFulfillmentStatus(status) {
    return {
        pending: 'awaiting_shipment',
        processing: 'awaiting_shipment',
        shipped: 'shipped',
        in_transit: 'shipped',
        out_for_delivery: 'out_for_delivery',
        delivered: 'delivered',
        returned: 'returned',
    }[status] ?? null;
}

export function advanceFulfillmentStatus(current, next) {
    if (!next) return current;
    if (next === 'returned') return next;
    if (!Object.hasOwn(progress, current) || !Object.hasOwn(progress, next))
        return current;
    return progress[next] > progress[current] ? next : current;
}
