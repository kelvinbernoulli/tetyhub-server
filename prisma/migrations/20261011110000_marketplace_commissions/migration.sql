CREATE TABLE platform_commission_settings (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    product_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (product_rate >= 0 AND product_rate <= 100),
    service_rate NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (service_rate >= 0 AND service_rate <= 100),
    updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO platform_commission_settings (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE platform_commission_settings_history (
    id SERIAL PRIMARY KEY,
    product_rate NUMERIC(5,2) NOT NULL,
    service_rate NUMERIC(5,2) NOT NULL,
    changed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE vendor_order_fulfillments
    ADD COLUMN gross_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN commission_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN net_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN payout_status TEXT NOT NULL DEFAULT 'held'
        CHECK (payout_status IN ('held', 'eligible', 'batched', 'paid', 'disputed', 'refunded'));

ALTER TABLE service_bookings
    ADD COLUMN commission_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN commission_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN vendor_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

CREATE TABLE marketplace_ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    vendor_id INTEGER REFERENCES vendors(id) ON DELETE RESTRICT,
    order_id INTEGER REFERENCES orders(id) ON DELETE RESTRICT,
    fulfillment_id INTEGER REFERENCES vendor_order_fulfillments(id) ON DELETE RESTRICT,
    booking_id INTEGER REFERENCES service_bookings(id) ON DELETE RESTRICT,
    entry_type TEXT NOT NULL CHECK (entry_type IN (
        'vendor_sale_credit', 'platform_commission', 'payout_eligible',
        'vendor_payout', 'refund', 'adjustment'
    )),
    amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    currency_id INTEGER NOT NULL REFERENCES currencies(id) ON DELETE RESTRICT,
    idempotency_key TEXT NOT NULL UNIQUE,
    metadata JSONB,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (order_id IS NOT NULL AND fulfillment_id IS NOT NULL AND booking_id IS NULL)
        OR (order_id IS NULL AND fulfillment_id IS NULL AND booking_id IS NOT NULL)
        OR (entry_type = 'adjustment' AND order_id IS NULL AND fulfillment_id IS NULL AND booking_id IS NULL)
    )
);

CREATE INDEX marketplace_ledger_entries_vendor_id_created_at_idx
    ON marketplace_ledger_entries(vendor_id, created_at, id);
CREATE INDEX marketplace_ledger_entries_order_id_idx
    ON marketplace_ledger_entries(order_id);
CREATE INDEX marketplace_ledger_entries_booking_id_idx
    ON marketplace_ledger_entries(booking_id);

INSERT INTO platform_commission_settings_history (product_rate, service_rate)
SELECT product_rate, service_rate FROM platform_commission_settings WHERE id = 1;
