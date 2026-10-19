/*
  Warnings:

  - You are about to drop the `marketplace_ledger_entries` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "marketplace_ledger_entries" DROP CONSTRAINT "marketplace_ledger_entries_booking_id_fkey";

-- DropForeignKey
ALTER TABLE "marketplace_ledger_entries" DROP CONSTRAINT "marketplace_ledger_entries_currency_id_fkey";

-- DropForeignKey
ALTER TABLE "marketplace_ledger_entries" DROP CONSTRAINT "marketplace_ledger_entries_fulfillment_id_fkey";

-- DropForeignKey
ALTER TABLE "marketplace_ledger_entries" DROP CONSTRAINT "marketplace_ledger_entries_order_id_fkey";

-- DropForeignKey
ALTER TABLE "marketplace_ledger_entries" DROP CONSTRAINT "marketplace_ledger_entries_vendor_id_fkey";

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');

-- AlterTable
ALTER TABLE "promotion_pricing_rules" ALTER COLUMN "effective_from" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "effective_to" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "promotions" ALTER COLUMN "start_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "end_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "service_bookings" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '24 hours');

-- DropTable
DROP TABLE "marketplace_ledger_entries";

-- CreateTable
CREATE TABLE "vendor_payouts" (
    "id" SERIAL NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "order_id" INTEGER NOT NULL,
    "fulfillment_id" INTEGER,
    "currency_id" INTEGER NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payout_method" TEXT NOT NULL DEFAULT 'bank_transfer',
    "reference" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "vendor_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" BIGSERIAL NOT NULL,
    "vendor_id" INTEGER,
    "order_id" INTEGER,
    "fulfillment_id" INTEGER,
    "booking_id" INTEGER,
    "currency_id" INTEGER NOT NULL,
    "entry_type" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendor_payouts_reference_key" ON "vendor_payouts"("reference");

-- CreateIndex
CREATE INDEX "vendor_payouts_vendor_id_status_created_at_idx" ON "vendor_payouts"("vendor_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "vendor_payouts_status_created_at_idx" ON "vendor_payouts"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_entries_vendor_id_created_at_id_idx" ON "ledger_entries"("vendor_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "ledger_entries_order_id_idx" ON "ledger_entries"("order_id");

-- CreateIndex
CREATE INDEX "ledger_entries_booking_id_idx" ON "ledger_entries"("booking_id");

-- AddForeignKey
ALTER TABLE "vendor_payouts" ADD CONSTRAINT "vendor_payouts_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payouts" ADD CONSTRAINT "vendor_payouts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payouts" ADD CONSTRAINT "vendor_payouts_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "vendor_order_fulfillments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_payouts" ADD CONSTRAINT "vendor_payouts_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "vendor_order_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "service_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "subscription_renewal_emails_pending_idx" RENAME TO "subscription_renewal_emails_status_available_at_created_at_idx";
