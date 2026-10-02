import { CheckoutError } from '#utils/checkout.js';

export const shipmentTransitions = {
    pending: ['processing', 'shipped', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['in_transit', 'out_for_delivery', 'delivered', 'failed', 'returned'],
    in_transit: ['out_for_delivery', 'delivered', 'failed', 'returned'],
    out_for_delivery: ['delivered', 'failed', 'returned'],
    failed: ['shipped', 'in_transit', 'out_for_delivery', 'returned', 'cancelled'],
    delivered: ['returned'],
    returned: [],
    cancelled: [],
};

export function validateShipmentTransition(previous, next) {
    if (!Object.hasOwn(shipmentTransitions, next) ||
        (previous !== next && !shipmentTransitions[previous]?.includes(next))) {
        throw new CheckoutError(`Cannot transition shipment from ${previous} to ${next}`, 422);
    }
}

// Missing vendors and delivery problems must never produce a delivered order.
export function fulfillmentStatus(shipments, vendorCount) {
    if (!shipments.length) return null;
    const complete = shipments.length === vendorCount && shipments.every(s => s.vendor_id);
    const statuses = shipments.map(s => s.status);
    if (complete && statuses.every(s => s === 'delivered')) return 'delivered';
    if (complete && statuses.every(s => ['out_for_delivery', 'delivered'].includes(s))) return 'out_for_delivery';
    if (complete && statuses.every(s => ['shipped', 'in_transit', 'out_for_delivery', 'delivered'].includes(s))) return 'shipped';
    return 'awaiting_shipment';
}
