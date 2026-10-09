CREATE TABLE vendor_order_fulfillments (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3),
    CONSTRAINT vendor_order_fulfillments_order_id_vendor_id_key UNIQUE (order_id, vendor_id)
);

CREATE INDEX vendor_order_fulfillments_vendor_id_status_idx
    ON vendor_order_fulfillments(vendor_id, status);

CREATE TABLE vendor_order_fulfillment_history (
    id SERIAL PRIMARY KEY,
    fulfillment_id INTEGER NOT NULL REFERENCES vendor_order_fulfillments(id) ON DELETE CASCADE,
    status TEXT NOT NULL,
    note TEXT,
    changed_by INTEGER,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX vendor_order_fulfillment_history_fulfillment_id_created_at_id_idx
    ON vendor_order_fulfillment_history(fulfillment_id, created_at, id);

INSERT INTO vendor_order_fulfillments (order_id, vendor_id, status)
SELECT DISTINCT oi.order_id, oi.vendor_id,
    CASE s.status
        WHEN 'delivered' THEN 'delivered'
        WHEN 'out_for_delivery' THEN 'out_for_delivery'
        WHEN 'shipped' THEN 'shipped'
        WHEN 'in_transit' THEN 'shipped'
        ELSE o.status
    END
FROM order_items oi
JOIN orders o ON o.id = oi.order_id
LEFT JOIN shipments s ON s.order_id = oi.order_id AND s.vendor_id = oi.vendor_id
WHERE oi.product_id IS NOT NULL
ON CONFLICT (order_id, vendor_id) DO NOTHING;

INSERT INTO vendor_order_fulfillment_history (fulfillment_id, status, note)
SELECT vof.id, vof.status, 'Fulfillment status backfilled'
FROM vendor_order_fulfillments vof;
