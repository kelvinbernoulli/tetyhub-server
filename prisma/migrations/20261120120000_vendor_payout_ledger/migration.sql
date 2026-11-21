ALTER TABLE paystack_webhook_events
  ADD COLUMN resource_id TEXT,
  ADD COLUMN amount_minor BIGINT,
  ADD COLUMN resolution TEXT;

ALTER TABLE vendors
  ADD COLUMN paystack_recipient_code TEXT UNIQUE,
  ADD COLUMN payout_cadence TEXT NOT NULL DEFAULT 'weekly'
    CHECK (payout_cadence IN ('daily', 'weekly', 'monthly', 'on_demand')),
  ADD COLUMN minimum_payout_minor BIGINT NOT NULL DEFAULT 0
    CHECK (minimum_payout_minor >= 0),
  ADD COLUMN tax_rate_bps INTEGER NOT NULL DEFAULT 0
    CHECK (tax_rate_bps BETWEEN 0 AND 10000);

CREATE TABLE vendor_ledger_entries (
  id BIGSERIAL PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  fulfillment_id INTEGER REFERENCES vendor_order_fulfillments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  payout_batch_id BIGINT,
  payout_id BIGINT,
  currency_id INTEGER NOT NULL REFERENCES currencies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  entry_type TEXT NOT NULL,
  amount_minor BIGINT NOT NULL CHECK (amount_minor <> 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payout_batches (
  id BIGSERIAL PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  currency_id INTEGER NOT NULL REFERENCES currencies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'monthly', 'on_demand')),
  status TEXT NOT NULL DEFAULT 'pending',
  gross_amount_minor BIGINT NOT NULL CHECK (gross_amount_minor > 0),
  transfer_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (transfer_fee_minor >= 0),
  tax_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount_minor >= 0),
  payout_amount_minor BIGINT NOT NULL CHECK (payout_amount_minor >= 0),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP(3),
  completed_at TIMESTAMP(3)
);

CREATE TABLE payouts (
  id BIGSERIAL PRIMARY KEY,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  batch_id BIGINT REFERENCES payout_batches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  order_id INTEGER REFERENCES orders(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  fulfillment_id INTEGER REFERENCES vendor_order_fulfillments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  currency_id INTEGER NOT NULL REFERENCES currencies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  reference TEXT NOT NULL UNIQUE,
  provider_reference TEXT UNIQUE,
  transfer_code TEXT,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  transfer_fee_minor BIGINT NOT NULL DEFAULT 0 CHECK (transfer_fee_minor >= 0),
  tax_amount_minor BIGINT NOT NULL DEFAULT 0 CHECK (tax_amount_minor >= 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'paid', 'failed', 'reversed', 'cancelled')),
  failure_code TEXT,
  failure_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP(3),
  paid_at TIMESTAMP(3),
  reversed_at TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE vendor_ledger_entries
  ADD CONSTRAINT vendor_ledger_entries_batch_fkey FOREIGN KEY (payout_batch_id)
    REFERENCES payout_batches(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT vendor_ledger_entries_payout_fkey FOREIGN KEY (payout_id)
    REFERENCES payouts(id) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO vendor_ledger_entries
  (vendor_id, order_id, fulfillment_id, currency_id, entry_type, amount_minor, idempotency_key, metadata, created_at)
SELECT vendor_id, order_id, fulfillment_id, currency_id, 'legacy_payout_hold',
       -ROUND(amount * 100)::BIGINT, 'legacy-payout-hold:' || id,
       jsonb_build_object('migrated_from_vendor_payout', id), created_at
FROM vendor_payouts WHERE status IN ('pending', 'processing') AND amount > 0
ON CONFLICT (idempotency_key) DO NOTHING;

CREATE INDEX vendor_ledger_entries_vendor_currency_created_idx
  ON vendor_ledger_entries(vendor_id, currency_id, created_at, id);
CREATE INDEX vendor_ledger_entries_order_idx ON vendor_ledger_entries(order_id);
CREATE INDEX payout_batches_vendor_status_created_idx
  ON payout_batches(vendor_id, status, created_at);
CREATE INDEX payout_batches_status_created_idx ON payout_batches(status, created_at);
CREATE INDEX payouts_vendor_status_created_idx ON payouts(vendor_id, status, created_at);
CREATE INDEX payouts_status_created_idx ON payouts(status, created_at);
CREATE INDEX payouts_batch_idx ON payouts(batch_id);

-- Financial ledger rows are append-only. Corrections must be represented by reversals.
CREATE FUNCTION reject_vendor_ledger_entry_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'vendor_ledger_entries is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER vendor_ledger_entries_immutable
  BEFORE UPDATE OR DELETE ON vendor_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_vendor_ledger_entry_mutation();

-- Preserve existing signed vendor balances in the new minor-unit ledger without
-- replaying old payout requests. Legacy pending payout rows remain in vendor_payouts.
INSERT INTO vendor_ledger_entries
  (vendor_id, order_id, fulfillment_id, currency_id, entry_type, amount_minor,
   idempotency_key, metadata, created_at)
SELECT vendor_id, order_id, fulfillment_id, currency_id, entry_type,
       ROUND(amount * 100)::BIGINT, 'legacy:' || idempotency_key,
       COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('migrated_from_ledger_entry', id),
       created_at
FROM ledger_entries
WHERE vendor_id IS NOT NULL AND amount <> 0
ON CONFLICT (idempotency_key) DO NOTHING;