ALTER TABLE products
    ADD COLUMN shipbubble_category_id INTEGER;

ALTER TABLE product_variants
    ADD COLUMN length DOUBLE PRECISION,
    ADD COLUMN width DOUBLE PRECISION,
    ADD COLUMN height DOUBLE PRECISION;

ALTER TABLE order_items
    ADD COLUMN shipbubble_category_id INTEGER;

ALTER TABLE shipments
    ADD COLUMN shipping_group_key TEXT,
    ADD COLUMN shipbubble_category_id INTEGER;

ALTER TABLE shipbubble_rate_quotes
    ADD COLUMN package_group_key TEXT;

DROP INDEX shipments_order_id_vendor_id_key;

CREATE UNIQUE INDEX shipments_order_vendor_manual_key
    ON shipments(order_id, vendor_id)
    WHERE shipping_group_key IS NULL;

CREATE UNIQUE INDEX shipments_order_vendor_group_key
    ON shipments(order_id, vendor_id, shipping_group_key)
    WHERE shipping_group_key IS NOT NULL;

CREATE INDEX shipments_order_vendor_group_lookup_idx
    ON shipments(order_id, vendor_id, shipping_group_key);
