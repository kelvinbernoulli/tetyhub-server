CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'PRO', 'BUSINESS');
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled');
CREATE TYPE "PlanAnalytics" AS ENUM ('none', 'basic', 'full');
CREATE TYPE "PlanSupport" AS ENUM ('standard', 'priority');

CREATE TABLE plan_versions (
    id SERIAL PRIMARY KEY,
    plan "SubscriptionPlan" NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    price_naira NUMERIC(12,2) NOT NULL CHECK (price_naira >= 0),
    commission_percent NUMERIC(5,2) NOT NULL
        CHECK (commission_percent >= 0 AND commission_percent <= 100),
    active_services INTEGER CHECK (active_services IS NULL OR active_services >= 0),
    packages_per_service INTEGER NOT NULL CHECK (packages_per_service >= 0),
    portfolio_images INTEGER NOT NULL CHECK (portfolio_images >= 0),
    promoted_slots_per_month INTEGER NOT NULL
        CHECK (promoted_slots_per_month >= 0),
    analytics "PlanAnalytics" NOT NULL,
    support "PlanSupport" NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT plan_versions_plan_version_key UNIQUE (plan, version)
);

CREATE UNIQUE INDEX plan_versions_one_current_per_plan_idx
    ON plan_versions(plan)
    WHERE is_current;

INSERT INTO plan_versions (
    plan, version, price_naira, commission_percent, active_services,
    packages_per_service, portfolio_images, promoted_slots_per_month,
    analytics, support, is_current
) VALUES
    ('FREE', 1, 0.00, 15.00, 3, 1, 5, 0, 'none', 'standard', TRUE),
    ('PRO', 1, 5000.00, 10.00, 15, 3, 25, 1, 'basic', 'standard', TRUE),
    ('BUSINESS', 1, 15000.00, 7.00, NULL, 3, 100, 5, 'full', 'priority', TRUE);

CREATE TABLE subscriptions (
    id SERIAL PRIMARY KEY,
    provider_id INTEGER NOT NULL UNIQUE
        REFERENCES vendors(id) ON DELETE CASCADE,
    plan "SubscriptionPlan" NOT NULL,
    plan_version INTEGER,
    status "SubscriptionStatus" NOT NULL,
    current_period_start TIMESTAMP(3),
    current_period_end TIMESTAMP(3),
    grace_ends_at TIMESTAMP(3),
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    pending_plan "SubscriptionPlan",
    pending_plan_version INTEGER,
    trial_used BOOLEAN NOT NULL DEFAULT FALSE,
    paystack_customer_code TEXT,
    paystack_subscription_code TEXT,
    paystack_email_token TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT subscriptions_plan_version_fkey
        FOREIGN KEY (plan, plan_version)
        REFERENCES plan_versions(plan, version) ON DELETE RESTRICT,
    CONSTRAINT subscriptions_pending_plan_version_fkey
        FOREIGN KEY (pending_plan, pending_plan_version)
        REFERENCES plan_versions(plan, version) ON DELETE RESTRICT,
    CONSTRAINT subscriptions_pending_plan_pair_check CHECK (
        (pending_plan IS NULL AND pending_plan_version IS NULL)
        OR (pending_plan IS NOT NULL AND pending_plan_version IS NOT NULL)
    ),
    CONSTRAINT subscriptions_paid_plan_version_check CHECK (
        plan = 'FREE' OR plan_version IS NOT NULL
    )
);

CREATE INDEX subscriptions_status_current_period_end_idx
    ON subscriptions(status, current_period_end);
CREATE INDEX subscriptions_status_grace_ends_at_idx
    ON subscriptions(status, grace_ends_at);

CREATE TABLE subscription_events (
    id SERIAL PRIMARY KEY,
    subscription_id INTEGER
        REFERENCES subscriptions(id) ON DELETE SET NULL,
    provider_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
    plan_version_id INTEGER REFERENCES plan_versions(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    event_key TEXT UNIQUE,
    meta JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT subscription_events_subject_check CHECK (
        subscription_id IS NOT NULL OR provider_id IS NOT NULL
    )
);

CREATE INDEX subscription_events_provider_id_created_at_idx
    ON subscription_events(provider_id, created_at);
CREATE INDEX subscription_events_subscription_id_created_at_idx
    ON subscription_events(subscription_id, created_at);
