ALTER TABLE vendors
  ADD COLUMN payout_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (payout_mode IN ('manual', 'automatic')),
  ADD COLUMN next_payout_at TIMESTAMPTZ(6);

-- Older installs may contain the former daily or on_demand cadence values.
-- Existing vendors default to manual mode after this migration, so normalize
-- those legacy values to the standard weekly cadence without triggering a payout.
UPDATE vendors
SET payout_cadence = 'weekly'
WHERE payout_cadence NOT IN ('weekly', 'monthly', 'bi_weekly');

ALTER TABLE vendors
  DROP CONSTRAINT IF EXISTS vendors_payout_cadence_check,
  ADD CONSTRAINT vendors_payout_cadence_check
    CHECK (payout_cadence IN ('weekly', 'bi_weekly', 'monthly'));

ALTER TABLE payout_batches
  DROP CONSTRAINT IF EXISTS payout_batches_cadence_check,
  ADD CONSTRAINT payout_batches_cadence_check
    CHECK (cadence IN ('daily', 'weekly', 'bi_weekly', 'monthly', 'on_demand'));

CREATE INDEX vendors_due_automatic_payouts_idx
  ON vendors (next_payout_at, id)
  WHERE payout_mode = 'automatic' AND next_payout_at IS NOT NULL;
