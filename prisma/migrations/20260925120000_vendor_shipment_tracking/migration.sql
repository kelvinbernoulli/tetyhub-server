-- Preserve legacy shipments; only infer ownership when exactly one vendor is known.
ALTER TABLE shipments ADD COLUMN vendor_id INTEGER;
ALTER TABLE shipments ADD CONSTRAINT shipments_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE shipments s SET vendor_id = owners.vendor_id
FROM (SELECT order_id, MIN(vendor_id) AS vendor_id FROM order_items WHERE product_id IS NOT NULL GROUP BY order_id HAVING COUNT(DISTINCT vendor_id) = 1) owners
WHERE owners.order_id = s.order_id;
DROP INDEX shipments_order_id_key;
CREATE UNIQUE INDEX shipments_order_id_vendor_id_key ON shipments(order_id, vendor_id);
CREATE INDEX shipments_vendor_id_idx ON shipments(vendor_id);
ALTER TABLE shipment_tracking_history ADD COLUMN changed_by INTEGER;
CREATE INDEX shipment_tracking_history_shipment_id_created_at_id_idx ON shipment_tracking_history(shipment_id, created_at, id);
