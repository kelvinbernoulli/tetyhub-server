ALTER TABLE vendors
    ADD COLUMN IF NOT EXISTS commission_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN payout_mode TEXT NOT NULL DEFAULT 'manual',
    ADD COLUMN payout_interval TEXT,
    ADD COLUMN payout_next_at TIMESTAMPTZ(3),
    ADD COLUMN paystack_recipient_code TEXT,
    ADD COLUMN payout_account_name TEXT,
    ADD COLUMN payout_bank_code TEXT,
    ADD COLUMN payout_bank_name TEXT,
    ADD COLUMN payout_account_last4 TEXT,
    ADD COLUMN payout_currency CHAR(3) NOT NULL DEFAULT 'NGN',
    ADD COLUMN payout_verified_at TIMESTAMPTZ(3),
    ADD CONSTRAINT vendors_payout_mode_check
        CHECK (payout_mode IN ('manual', 'automatic')),
    ADD CONSTRAINT vendors_payout_interval_check
        CHECK (payout_interval IS NULL OR payout_interval IN ('weekly', 'bi_weekly', 'monthly')),
    ADD CONSTRAINT vendors_automatic_payout_interval_check
        CHECK (payout_mode <> 'automatic' OR payout_interval IS NOT NULL);

INSERT INTO admin_types (admin_type,slug,description,scope,is_system,status)
VALUES ('Payouts','payouts','Manage vendor payouts and payout configuration','both',true,true)
ON CONFLICT (slug) DO UPDATE SET
    description = EXCLUDED.description,
    scope = EXCLUDED.scope,
    is_system = true,
    status = true,
    updated_at = CURRENT_TIMESTAMP;

ALTER TABLE orders
    ADD COLUMN delivered_at TIMESTAMPTZ(3);

UPDATE orders
SET delivered_at = COALESCE(updated_at, created_at) AT TIME ZONE current_setting('TimeZone')
WHERE status = 'delivered';

CREATE FUNCTION set_order_delivered_at() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN
        NEW.delivered_at = COALESCE(NEW.delivered_at, NOW());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_set_delivered_at
BEFORE UPDATE OF status ON orders
FOR EACH ROW EXECUTE FUNCTION set_order_delivered_at();

ALTER TABLE service_bookings
    ADD COLUMN completed_at TIMESTAMPTZ(3);

UPDATE service_bookings
SET completed_at = COALESCE(updated_at, created_at) AT TIME ZONE current_setting('TimeZone')
WHERE booking_status = 'completed';

CREATE FUNCTION set_booking_completed_at() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.booking_status = 'completed' AND OLD.booking_status IS DISTINCT FROM 'completed' THEN
        NEW.completed_at = COALESCE(NEW.completed_at, NOW());
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER service_bookings_set_completed_at
BEFORE UPDATE OF booking_status ON service_bookings
FOR EACH ROW EXECUTE FUNCTION set_booking_completed_at();

CREATE TABLE payout_batches (
    id SERIAL PRIMARY KEY,
    batch_key TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL CHECK (mode IN ('manual', 'automatic')),
    cadence TEXT CHECK (cadence IS NULL OR cadence IN ('weekly', 'bi_weekly', 'monthly')),
    status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
    created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ(3)
);

CREATE TABLE payouts (
    id SERIAL PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES payout_batches(id) ON DELETE RESTRICT,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    currency CHAR(3) NOT NULL DEFAULT 'NGN',
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    transfer_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (transfer_fee_minor >= 0),
    transfer_reference TEXT NOT NULL UNIQUE,
    transfer_code TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'reversed')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    retryable BOOLEAN NOT NULL DEFAULT FALSE,
    last_error_code TEXT,
    last_error_message TEXT,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ(3),
    UNIQUE (batch_id, vendor_id)
);

CREATE INDEX payouts_vendor_created_idx ON payouts(vendor_id, created_at DESC);
CREATE INDEX payouts_status_retryable_updated_idx ON payouts(status, retryable, updated_at);

CREATE TABLE vendor_ledger_entries (
    id BIGSERIAL PRIMARY KEY,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    order_id INTEGER REFERENCES orders(id) ON DELETE RESTRICT,
    order_item_id INTEGER REFERENCES order_items(id) ON DELETE RESTRICT,
    booking_id INTEGER REFERENCES service_bookings(id) ON DELETE RESTRICT,
    payout_id INTEGER REFERENCES payouts(id) ON DELETE RESTRICT,
    entry_type TEXT NOT NULL CHECK (entry_type IN (
        'credit_sale', 'debit_commission', 'debit_tax', 'debit_refund',
        'debit_transfer_fee', 'debit_payout', 'credit_payout_reversal',
        'debit_chargeback', 'credit_chargeback_reversal', 'debit_adjustment'
    )),
    amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
    currency CHAR(3) NOT NULL DEFAULT 'NGN',
    idempotency_key TEXT NOT NULL UNIQUE,
    available_at TIMESTAMPTZ(3),
    metadata JSONB,
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    CHECK (order_item_id IS NULL OR order_id IS NOT NULL),
    CHECK (order_item_id IS NULL OR booking_id IS NULL),
    CHECK (booking_id IS NULL OR order_id IS NULL)
);

CREATE INDEX vendor_ledger_vendor_created_idx ON vendor_ledger_entries(vendor_id, created_at DESC, id DESC);
CREATE INDEX vendor_ledger_vendor_available_idx ON vendor_ledger_entries(vendor_id, available_at);
CREATE INDEX vendor_ledger_order_item_idx ON vendor_ledger_entries(order_item_id);
CREATE INDEX vendor_ledger_booking_idx ON vendor_ledger_entries(booking_id);
CREATE INDEX vendor_ledger_payout_idx ON vendor_ledger_entries(payout_id);

CREATE TABLE vendor_payout_holds (
    id BIGSERIAL PRIMARY KEY,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
    order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
    provider_dispute_id TEXT NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    currency CHAR(3) NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'released', 'debited')),
    created_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    UNIQUE (provider_dispute_id, order_item_id)
);

CREATE INDEX vendor_payout_holds_vendor_status_idx ON vendor_payout_holds(vendor_id, status);

CREATE FUNCTION prevent_vendor_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'vendor ledger entries are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON vendor_ledger_entries
FOR EACH ROW EXECUTE FUNCTION prevent_vendor_ledger_mutation();

CREATE TABLE payout_webhook_events (
    id BIGSERIAL PRIMARY KEY,
    event_key TEXT NOT NULL UNIQUE,
    transfer_reference TEXT,
    event_type TEXT NOT NULL,
    received_at TIMESTAMPTZ(3) NOT NULL DEFAULT NOW(),
    payload JSONB
);

-- Seed the immutable ledger for previously paid orders and bookings so existing
-- vendor balances carry over when the payout feature is enabled.
WITH item_values AS (
    SELECT oi.id AS order_item_id,oi.order_id,oi.vendor_id,oi.quantity,
        ROUND(oi.subtotal * 100)::BIGINT AS gross_minor,
        ROUND(o.discount * 100)::BIGINT AS order_discount_minor,
        ROUND(o.tax * 100)::BIGINT AS order_tax_minor,
        ROUND(o.subtotal * 100)::BIGINT AS order_subtotal_minor,
        v.commission_rate,
        c.code AS currency,
        ROW_NUMBER() OVER (PARTITION BY o.id ORDER BY oi.id) AS row_num,
        COUNT(*) OVER (PARTITION BY o.id) AS row_count
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN vendors v ON v.id = oi.vendor_id
    JOIN currencies c ON c.id = o.currency_id
    WHERE o.payment_status = 'paid'
), allocated AS (
    SELECT *,
        CASE WHEN row_num = row_count THEN order_discount_minor -
            COALESCE(SUM(FLOOR(gross_minor::NUMERIC * order_discount_minor /
                NULLIF(order_subtotal_minor,0))) OVER (
                    PARTITION BY order_id ORDER BY order_item_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ),0)::BIGINT
            ELSE FLOOR(gross_minor::NUMERIC * order_discount_minor /
                NULLIF(order_subtotal_minor,0))::BIGINT END AS discount_minor,
        CASE WHEN row_num = row_count THEN order_tax_minor -
            COALESCE(SUM(FLOOR(gross_minor::NUMERIC * order_tax_minor /
                NULLIF(order_subtotal_minor,0))) OVER (
                    PARTITION BY order_id ORDER BY order_item_id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
                ),0)::BIGINT
            ELSE FLOOR(gross_minor::NUMERIC * order_tax_minor /
                NULLIF(order_subtotal_minor,0))::BIGINT END AS tax_minor
    FROM item_values
    WHERE order_subtotal_minor > 0
), ledger AS (
    SELECT vendor_id,order_id,order_item_id,NULL::INTEGER AS booking_id,
        'credit_sale'::TEXT AS entry_type,gross_minor - discount_minor AS amount_minor,
        currency,'order-item:' || order_item_id || ':sale' AS idempotency_key
    FROM allocated
    UNION ALL
    SELECT vendor_id,order_id,order_item_id,NULL::INTEGER,
        'debit_commission',-ROUND((gross_minor - discount_minor) * commission_percent / 100)::BIGINT,
        currency,'order-item:' || order_item_id || ':commission'
    FROM allocated
    UNION ALL
    SELECT vendor_id,order_id,order_item_id,NULL::INTEGER,'debit_tax',-tax_minor,
        currency,'order-item:' || order_item_id || ':tax'
    FROM allocated
)
INSERT INTO vendor_ledger_entries
    (vendor_id,order_id,order_item_id,booking_id,entry_type,amount_minor,currency,idempotency_key)
SELECT vendor_id,order_id,order_item_id,booking_id,entry_type,amount_minor,currency,idempotency_key
FROM ledger WHERE amount_minor <> 0
ON CONFLICT (idempotency_key) DO NOTHING;

WITH paid_bookings AS (
    SELECT b.id,b.vendor_id,b.total,
        v.commission_rate,
        c.code AS currency
    FROM service_bookings b
    JOIN vendors v ON v.id = b.vendor_id
    JOIN currencies c ON c.id = b.currency_id
    WHERE b.payment_status = 'paid'
), booking_ledger AS (
    SELECT id AS booking_id,vendor_id,'credit_sale'::TEXT AS entry_type,
        ROUND(total * 100)::BIGINT AS amount_minor,currency,
        'booking:' || id || ':sale' AS idempotency_key
    FROM paid_bookings
    UNION ALL
    SELECT id,vendor_id,'debit_commission',-ROUND(total * 100 * commission_percent / 100)::BIGINT,
        currency,'booking:' || id || ':commission'
    FROM paid_bookings
)
INSERT INTO vendor_ledger_entries
    (vendor_id,booking_id,entry_type,amount_minor,currency,idempotency_key)
SELECT vendor_id,booking_id,entry_type,amount_minor,currency,idempotency_key
FROM booking_ledger WHERE amount_minor <> 0
ON CONFLICT (idempotency_key) DO NOTHING;
