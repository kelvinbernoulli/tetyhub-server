BEGIN;

ALTER TABLE returns
  ADD COLUMN reason_type TEXT NOT NULL DEFAULT 'change_of_mind',
  ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'not_requested',
  ADD COLUMN refund_reference TEXT,
  ADD COLUMN refund_processed_at TIMESTAMP(3),
  ADD COLUMN delivered_at TIMESTAMP(3),
  ADD COLUMN return_window_expires_at TIMESTAMP(3),
  ADD COLUMN policy_version TEXT NOT NULL DEFAULT '2026-11-12';

ALTER TABLE return_items
  ADD COLUMN condition TEXT;

ALTER TABLE paystack_webhook_events ADD COLUMN refund_reference TEXT;

CREATE TABLE order_refunds (
  id SERIAL PRIMARY KEY,
  return_id INTEGER NOT NULL UNIQUE REFERENCES returns(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  gateway TEXT NOT NULL,
  transaction_reference TEXT NOT NULL,
  refund_reference TEXT NOT NULL UNIQUE,
  provider_ref TEXT,
  amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  currency_id INTEGER NOT NULL REFERENCES currencies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued',
  last_error TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP(3)
);

CREATE INDEX order_refunds_status_created_at_idx ON order_refunds(status, created_at);
CREATE INDEX returns_user_id_created_at_idx ON returns(user_id, created_at DESC);
CREATE INDEX returns_vendor_id_status_created_at_idx ON returns(vendor_id, status, created_at DESC);
CREATE INDEX paystack_webhook_events_refund_reference_idx ON paystack_webhook_events(refund_reference);

COMMIT;
