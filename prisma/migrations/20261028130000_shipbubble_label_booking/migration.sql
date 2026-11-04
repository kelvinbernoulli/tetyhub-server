ALTER TABLE shipments
    ADD COLUMN shipbubble_order_id TEXT,
    ADD COLUMN tracking_url TEXT,
    ADD COLUMN waybill_document TEXT;

CREATE UNIQUE INDEX shipments_shipbubble_order_id_key
    ON shipments(shipbubble_order_id);

ALTER TABLE shipbubble_rate_quotes
    ADD COLUMN booking_status TEXT NOT NULL DEFAULT 'unpaid',
    ADD COLUMN booking_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN processing_until TIMESTAMP(3),
    ADD COLUMN booking_error TEXT,
    ADD COLUMN booked_at TIMESTAMP(3);

CREATE INDEX shipbubble_rate_quotes_booking_status_processing_until_order_id_idx
    ON shipbubble_rate_quotes(booking_status, processing_until, order_id);
