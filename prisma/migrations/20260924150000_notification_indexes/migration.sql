CREATE INDEX "notifications_user_id_id_idx" ON "notifications"("user_id", "id");
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- These fields are already accepted by the return workflow.
ALTER TABLE "returns" ADD COLUMN "vendor_notes" TEXT,
    ADD COLUMN "admin_notes" TEXT,
    ADD COLUMN "evidence" JSONB,
    ADD COLUMN "approved_at" TIMESTAMP(3),
    ADD COLUMN "completed_at" TIMESTAMP(3);
ALTER TABLE "return_items" ADD COLUMN "condition" TEXT;
