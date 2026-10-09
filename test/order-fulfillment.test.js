import test from 'node:test';
import assert from 'node:assert/strict';
import {
    advanceFulfillmentStatus,
    aggregateFulfillmentStatus,
    shipmentFulfillmentStatus,
} from '../src/services/order-fulfillment.js';

test('parent order status reflects the least-advanced vendor fulfillment', () => {
    assert.equal(
        aggregateFulfillmentStatus(['delivered', 'processing'], 'delivered'),
        'processing'
    );
    assert.equal(
        aggregateFulfillmentStatus(['shipped', 'out_for_delivery'], 'processing'),
        'shipped'
    );
    assert.equal(
        aggregateFulfillmentStatus(['delivered', 'delivered'], 'processing'),
        'delivered'
    );
    assert.equal(
        aggregateFulfillmentStatus(['delivered', 'cancelled'], 'shipped'),
        'shipped'
    );
});

test('shipment events advance only their vendor fulfillment state', () => {
    assert.equal(shipmentFulfillmentStatus('in_transit'), 'shipped');
    assert.equal(shipmentFulfillmentStatus('failed'), null);
    assert.equal(advanceFulfillmentStatus('packed', 'awaiting_shipment'), 'packed');
    assert.equal(advanceFulfillmentStatus('shipped', 'delivered'), 'delivered');
});
