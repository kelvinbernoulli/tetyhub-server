ALTER TABLE "support_tickets" ADD COLUMN "assigned_to" INTEGER;
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_to_fkey"
    FOREIGN KEY ("assigned_to") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "support_ticket_replies" ADD COLUMN "is_internal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "support_tickets" ALTER COLUMN "priority" SET DEFAULT 'medium';
UPDATE "support_tickets" SET "priority" = 'medium' WHERE "priority" = 'normal';
UPDATE "support_tickets" SET "priority" = 'high' WHERE "priority" = 'urgent';
UPDATE "support_tickets" SET "status" = 'open' WHERE "status" = 'reopened';
UPDATE "support_tickets" SET "status" = 'resolved' WHERE "status" = 'closed';
UPDATE "support_tickets" SET "category" = 'general' WHERE "category" IS NULL OR "category" IN ('internal', 'external');
CREATE INDEX "support_tickets_user_id_created_at_idx" ON "support_tickets"("user_id", "created_at");
CREATE INDEX "support_tickets_assigned_to_status_idx" ON "support_tickets"("assigned_to", "status");
CREATE INDEX "support_ticket_replies_ticket_id_id_idx" ON "support_ticket_replies"("ticket_id", "id");
