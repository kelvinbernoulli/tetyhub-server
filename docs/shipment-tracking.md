# Manual shipment tracking

Each vendor creates one shipment per order, covering all of that vendor's product items. Split parcels within one vendor are not supported yet. A parent checkout has a separate fulfillment status for every vendor; shipment progress advances only that vendor's fulfillment, while the parent order reflects aggregate progress. Customer responses include the shipment's items, carrier, tracking number, estimated/actual delivery, status, and chronological tracking history. Vendor notes are excluded from customer reads.

## Vendor API

Paths below are relative to the vendor router and require the matching shipments permission.

- `POST /orders/:orderId/shipments`: create with `carrier` and `tracking_number`; optionally `shipping_method`, `estimated_delivery`, `shipping_cost`, `location`, and internal `notes`.
- `GET /orders/:orderId/shipments`: list this vendor's shipments and their items/events.
- `GET /shipments/:shipmentId`: shipment details.
- `PATCH /shipments/:shipmentId`: edit shipment details or status; optionally include `location` and `tracking_description`.
- `POST /shipments/:shipmentId/tracking`: add a public event with required `status`, optional `location` and `description`.
- `GET /shipments/:shipmentId/tracking`: chronological events.

Example tracking body:

```json
{
  "status": "out_for_delivery",
  "location": "Ikeja, Lagos",
  "description": "Your package is with the delivery rider."
}
```

Typical flow: `pending ? processing ? shipped ? in_transit ? out_for_delivery ? delivered`. Processing, transit, and out-for-delivery steps may be skipped where permitted. Failed delivery supports retry; delivered shipments can only advance to returned. Repeated same-status tracking POSTs intentionally represent new location/events; unchanged status PATCHes do not create duplicate events. Delivery sets `actual_delivery`.

## Customer API

Paths are relative to the web router. All require the authenticated customer who owns the order.

- `GET /orders/:orderId/shipments`: preferred endpoint; returns an array with items and tracking history for every vendor shipment.
- `GET /shipments/:shipmentId`: shipment details, excluding internal notes.
- `GET /shipments/:shipmentId/tracking`: event history.
- `GET /orders/:orderId/shipment`: legacy single-shipment response; returns 409 for multiple shipments so clients must use the plural endpoint.

The frontend can poll the plural endpoint while the tracking screen is open. No courier account or automatic courier updates are configured by this implementation.

## Consistency and notifications

Both write endpoints run shipment changes, tracking events, vendor fulfillment progress, overall order progress, order history, and customer in-app notifications in one transaction. Order locks serialize updates from different vendors. A vendor's shipment status cannot advance another vendor's fulfillment. The parent order uses the least-advanced active vendor status and becomes delivered only when all vendor fulfillments are delivered. In transit maps to shipped, not out for delivery. Delivery problems remain visible on the individual shipment and do not advance that vendor's fulfillment. Returns/refunds retain their separate order workflow.

## Database rollout

Apply `20260925120000_vendor_shipment_tracking` through the project's migration workflow before running this code. It removes the old one-shipment-per-order unique index, adds vendor ownership and uniqueness per order/vendor, and indexes the event timeline. Existing single-vendor shipments are assigned automatically. Ambiguous legacy shipments retain a null vendor: customers can still read them, but vendor mutations and new shipment creation for that order are blocked until an operator reconciles their ownership. No historical events are fabricated.

Apply `20261011090000_vendor_order_fulfillments` after the shipment migration. It creates and backfills one fulfillment record per vendor represented in each product order.

Run `node --test test/shipment.test.js test/order-history.test.js`. Optional PostgreSQL coverage uses `SHIPMENT_DATABASE_URL` and an isolated temporary schema; it does not use the application database URL.
