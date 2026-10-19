/*
  Warnings:

  - You are about to drop the column `vendor_settingsId` on the `services` table. All the data in the column will be lost.

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

-- DropForeignKey
ALTER TABLE "platform_commission_settings" DROP CONSTRAINT "platform_commission_settings_updated_by_fkey";

-- DropForeignKey
ALTER TABLE "platform_commission_settings_history" DROP CONSTRAINT "platform_commission_settings_history_changed_by_fkey";

-- DropForeignKey
ALTER TABLE "service_packages" DROP CONSTRAINT "service_packages_service_id_fkey";

-- DropForeignKey
ALTER TABLE "services" DROP CONSTRAINT "services_vendor_settingsId_fkey";

-- DropForeignKey
ALTER TABLE "subscription_events" DROP CONSTRAINT "subscription_events_plan_version_id_fkey";

-- DropForeignKey
ALTER TABLE "subscription_events" DROP CONSTRAINT "subscription_events_provider_id_fkey";

-- DropForeignKey
ALTER TABLE "subscription_events" DROP CONSTRAINT "subscription_events_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_pending_plan_version_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_plan_version_fkey";

-- DropForeignKey
ALTER TABLE "subscriptions" DROP CONSTRAINT "subscriptions_provider_id_fkey";

-- DropForeignKey
ALTER TABLE "vendor_order_fulfillment_history" DROP CONSTRAINT "vendor_order_fulfillment_history_fulfillment_id_fkey";

-- DropForeignKey
ALTER TABLE "vendor_order_fulfillments" DROP CONSTRAINT "vendor_order_fulfillments_order_id_fkey";

-- DropForeignKey
ALTER TABLE "vendor_order_fulfillments" DROP CONSTRAINT "vendor_order_fulfillments_vendor_id_fkey";

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');

-- AlterTable
ALTER TABLE "service_bookings" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '24 hours');

-- AlterTable
ALTER TABLE "services" DROP COLUMN "vendor_settingsId";

-- AlterTable
ALTER TABLE "subscriptions" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "support_ticket_replies" ALTER COLUMN "message" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "plan_versions_plan_is_current_idx" ON "plan_versions"("plan", "is_current");

-- AddForeignKey
ALTER TABLE "vendor_order_fulfillments" ADD CONSTRAINT "vendor_order_fulfillments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_order_fulfillments" ADD CONSTRAINT "vendor_order_fulfillments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_order_fulfillment_history" ADD CONSTRAINT "vendor_order_fulfillment_history_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "vendor_order_fulfillments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_commission_settings" ADD CONSTRAINT "platform_commission_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_commission_settings_history" ADD CONSTRAINT "platform_commission_settings_history_changed_by_fkey" FOREIGN KEY ("changed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_ledger_entries" ADD CONSTRAINT "marketplace_ledger_entries_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_ledger_entries" ADD CONSTRAINT "marketplace_ledger_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_ledger_entries" ADD CONSTRAINT "marketplace_ledger_entries_fulfillment_id_fkey" FOREIGN KEY ("fulfillment_id") REFERENCES "vendor_order_fulfillments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_ledger_entries" ADD CONSTRAINT "marketplace_ledger_entries_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "service_bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_ledger_entries" ADD CONSTRAINT "marketplace_ledger_entries_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_packages" ADD CONSTRAINT "service_packages_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_plan_version_fkey" FOREIGN KEY ("plan", "plan_version") REFERENCES "plan_versions"("plan", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_plan_pending_plan_version_fkey" FOREIGN KEY ("pending_plan", "pending_plan_version") REFERENCES "plan_versions"("plan", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_provider_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_plan_version_id_fkey" FOREIGN KEY ("plan_version_id") REFERENCES "plan_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "marketplace_ledger_entries_vendor_id_created_at_idx" RENAME TO "marketplace_ledger_entries_vendor_id_created_at_id_idx";

-- RenameIndex
ALTER INDEX "paystack_webhook_events_pending_idx" RENAME TO "paystack_webhook_events_status_available_at_created_at_idx";

-- RenameIndex
ALTER INDEX "vendor_order_fulfillment_history_fulfillment_id_created_at_id_i" RENAME TO "vendor_order_fulfillment_history_fulfillment_id_created_at__idx";
