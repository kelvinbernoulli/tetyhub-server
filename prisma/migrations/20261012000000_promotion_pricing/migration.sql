ALTER TABLE "promotions"
    ADD COLUMN IF NOT EXISTS "pricing_model" TEXT NOT NULL DEFAULT 'dynamic',
    ADD COLUMN IF NOT EXISTS "base_daily_rate" DECIMAL(10, 2),
    ADD COLUMN IF NOT EXISTS "min_total_price" DECIMAL(10, 2),
    ADD COLUMN IF NOT EXISTS "default_multiplier" DECIMAL(10, 2),
    ADD COLUMN IF NOT EXISTS "auto_reprice" BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE "promotion_pricing_rules" (
    "id" SERIAL PRIMARY KEY,
    "placement" TEXT NOT NULL,
    "keyword" TEXT,
    "season" TEXT,
    "multiplier" DECIMAL(10, 2) NOT NULL,
    "base_daily_rate" DECIMAL(10, 2),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "effective_from" TIMESTAMPTZ,
    "effective_to" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ
);

CREATE INDEX "promotion_pricing_rules_placement_status_priority_idx"
    ON "promotion_pricing_rules" ("placement", "status", "priority");

CREATE INDEX "promotion_pricing_rules_keyword_season_status_idx"
    ON "promotion_pricing_rules" ("keyword", "season", "status");
