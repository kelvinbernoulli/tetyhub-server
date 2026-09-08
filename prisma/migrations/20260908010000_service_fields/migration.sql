BEGIN;
ALTER TABLE "services"
    ADD COLUMN "category_id" INTEGER,
    ADD COLUMN "subcategory_id" INTEGER,
    ADD COLUMN "childcategory_id" INTEGER,
    ADD COLUMN "short_description" TEXT,
    ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "compare_at_price" DECIMAL(10,2),
    ADD COLUMN "buffer_mins" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "max_bookings_per_slot" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "is_remote" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "location_type" TEXT NOT NULL DEFAULT 'vendor_location',
    ADD COLUMN "cancellation_window_hours" INTEGER NOT NULL DEFAULT 24,
    ADD COLUMN "cancellation_fee_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "thumbnail" TEXT,
    ADD COLUMN "meta_title" TEXT,
    ADD COLUMN "meta_description" TEXT,
    ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Preserve the deletion state of any legacy rows.
UPDATE "services" SET "deleted_at" = COALESCE("updated_at", "created_at") WHERE "status" = 'deleted';
CREATE INDEX "services_category_id_idx" ON "services"("category_id");
CREATE INDEX "services_subcategory_id_idx" ON "services"("subcategory_id");
CREATE INDEX "services_childcategory_id_idx" ON "services"("childcategory_id");
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "services" ADD CONSTRAINT "services_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "services" ADD CONSTRAINT "services_childcategory_id_fkey" FOREIGN KEY ("childcategory_id") REFERENCES "childcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
COMMIT;
