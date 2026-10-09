ALTER TABLE "support_tickets"
    ADD COLUMN "pending_assigned_to" INTEGER,
    ADD COLUMN "transfer_requested_by" INTEGER,
    ADD COLUMN "transfer_requested_at" TIMESTAMP(3);

ALTER TABLE "support_tickets"
    ADD CONSTRAINT "support_tickets_pending_assigned_to_fkey"
        FOREIGN KEY ("pending_assigned_to") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "support_tickets_transfer_requested_by_fkey"
        FOREIGN KEY ("transfer_requested_by") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "support_tickets_pending_assigned_to_idx"
    ON "support_tickets"("pending_assigned_to");
