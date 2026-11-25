-- The payout migrations dated 20261120 and 20261121 target a superseded payout
-- schema. The active payout schema is created by 20261124010000_vendor_payouts.
-- Keep the webhook metadata fields required by the Paystack event worker.
ALTER TABLE paystack_webhook_events
    ADD COLUMN IF NOT EXISTS resource_id TEXT,
    ADD COLUMN IF NOT EXISTS amount_minor BIGINT,
    ADD COLUMN IF NOT EXISTS resolution TEXT;
