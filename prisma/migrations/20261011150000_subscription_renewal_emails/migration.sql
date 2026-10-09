CREATE TABLE subscription_renewal_emails (
    id BIGSERIAL PRIMARY KEY,
    event_key TEXT NOT NULL UNIQUE,
    provider_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    recipient_email TEXT NOT NULL,
    firstname TEXT,
    current_period_end TIMESTAMP(3) NOT NULL,
    pending_plan "SubscriptionPlan",
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    available_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    processing_until TIMESTAMP(3),
    last_error TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP(3)
);

CREATE INDEX subscription_renewal_emails_pending_idx
    ON subscription_renewal_emails(status, available_at, created_at);
