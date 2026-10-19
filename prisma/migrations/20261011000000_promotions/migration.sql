CREATE TABLE "promotions" (
    "id" SERIAL PRIMARY KEY,
    "vendor_id" INTEGER NOT NULL,
    "target_type" TEXT DEFAULT 'vendor',
    "target_id" INTEGER,
    "placement" TEXT NOT NULL DEFAULT 'homepage_banner',
    "title" TEXT,
    "subtitle" TEXT,
    "image_url" TEXT,
    "cta_label" TEXT,
    "cta_link" TEXT,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_paid" BOOLEAN NOT NULL DEFAULT FALSE,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ
);

CREATE INDEX "promotions_placement_status_priority_start_at_idx"
    ON "promotions" ("placement", "status", "priority", "start_at");

CREATE INDEX "promotions_vendor_id_status_idx"
    ON "promotions" ("vendor_id", "status");

CREATE INDEX "promotions_target_type_target_id_idx"
    ON "promotions" ("target_type", "target_id");

ALTER TABLE "promotions"
    ADD CONSTRAINT "promotions_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
