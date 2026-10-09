ALTER TABLE plan_versions
    ADD COLUMN paystack_plan_code TEXT;

CREATE TABLE paystack_webhook_events (
    id BIGSERIAL PRIMARY KEY,
    event_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    reference TEXT,
    transaction_id TEXT,
    subscription_code TEXT,
    customer_code TEXT,
    event_status TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'processed', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processing_until TIMESTAMP(3),
    last_error TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP(3)
);

CREATE INDEX paystack_webhook_events_pending_idx
    ON paystack_webhook_events(status, available_at, created_at);
