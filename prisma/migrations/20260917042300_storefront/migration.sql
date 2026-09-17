/*
  Warnings:

  - You are about to drop the column `site_name` on the `vendor_settings` table. All the data in the column will be lost.
  - You are about to drop the column `address` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `banner` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `city` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `commission_rate` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `country_id` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `email` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `facebook` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `instagram` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `linkedIn` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `logo` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `phone_one` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `phone_two` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `postal_code` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `snapchat` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `state` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `store_name` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `store_slug` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `twitter` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `website` on the `vendors` table. All the data in the column will be lost.
  - You are about to drop the column `whatsapp` on the `vendors` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[user_id]` on the table `vendor_settings` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[store_slug]` on the table `vendor_settings` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `user_id` to the `vendor_settings` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "vendors" DROP CONSTRAINT "vendors_country_id_fkey";

-- DropIndex
DROP INDEX "vendors_country_id_idx";

-- DropIndex
DROP INDEX "vendors_store_slug_key";

-- AlterTable
ALTER TABLE "admin_audit_logs" ADD COLUMN     "vendor_settingsId" INTEGER;

-- AlterTable
ALTER TABLE "admins" ADD COLUMN     "vendor_settingsId" INTEGER;

-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "vendor_settingsId" INTEGER;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "vendor_settingsId" INTEGER;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "vendor_settingsId" INTEGER;

-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "vendor_settingsId" INTEGER;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "vendor_settingsId" INTEGER;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "vendor_settingsId" INTEGER;

-- AlterTable
ALTER TABLE "returns" ADD COLUMN     "vendor_settingsId" INTEGER;

-- AlterTable
ALTER TABLE "service_bookings" ADD COLUMN     "vendor_settingsId" INTEGER,
ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "vendor_settingsId" INTEGER;

-- AlterTable
ALTER TABLE "support_tickets" ADD COLUMN     "vendor_settingsId" INTEGER;

-- AlterTable
ALTER TABLE "vendor_settings" DROP COLUMN "site_name",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "banner" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country_id" INTEGER,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "facebook" TEXT,
ADD COLUMN     "logo" TEXT,
ADD COLUMN     "postal_code" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "store_name" TEXT,
ADD COLUMN     "store_slug" TEXT,
ADD COLUMN     "user_id" INTEGER NOT NULL,
ADD COLUMN     "website" TEXT,
ADD COLUMN     "whatsapp" TEXT;

-- AlterTable
ALTER TABLE "vendors" DROP COLUMN "address",
DROP COLUMN "banner",
DROP COLUMN "city",
DROP COLUMN "commission_rate",
DROP COLUMN "country_id",
DROP COLUMN "description",
DROP COLUMN "email",
DROP COLUMN "facebook",
DROP COLUMN "instagram",
DROP COLUMN "linkedIn",
DROP COLUMN "logo",
DROP COLUMN "phone_one",
DROP COLUMN "phone_two",
DROP COLUMN "postal_code",
DROP COLUMN "snapchat",
DROP COLUMN "state",
DROP COLUMN "store_name",
DROP COLUMN "store_slug",
DROP COLUMN "twitter",
DROP COLUMN "website",
DROP COLUMN "whatsapp";

-- CreateIndex
CREATE UNIQUE INDEX "vendor_settings_user_id_key" ON "vendor_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_settings_store_slug_key" ON "vendor_settings"("store_slug");

-- CreateIndex
CREATE INDEX "vendor_settings_country_id_idx" ON "vendor_settings"("country_id");

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_vendor_settingsId_fkey" FOREIGN KEY ("vendor_settingsId") REFERENCES "vendor_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_audit_logs" ADD CONSTRAINT "admin_audit_logs_vendor_settingsId_fkey" FOREIGN KEY ("vendor_settingsId") REFERENCES "vendor_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_vendor_settingsId_fkey" FOREIGN KEY ("vendor_settingsId") REFERENCES "vendor_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_vendor_settingsId_fkey" FOREIGN KEY ("vendor_settingsId") REFERENCES "vendor_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_vendor_settingsId_fkey" FOREIGN KEY ("vendor_settingsId") REFERENCES "vendor_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_vendor_settingsId_fkey" FOREIGN KEY ("vendor_settingsId") REFERENCES "vendor_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_vendor_settingsId_fkey" FOREIGN KEY ("vendor_settingsId") REFERENCES "vendor_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_vendor_settingsId_fkey" FOREIGN KEY ("vendor_settingsId") REFERENCES "vendor_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "returns" ADD CONSTRAINT "returns_vendor_settingsId_fkey" FOREIGN KEY ("vendor_settingsId") REFERENCES "vendor_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_vendor_settingsId_fkey" FOREIGN KEY ("vendor_settingsId") REFERENCES "vendor_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_settings" ADD CONSTRAINT "vendor_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_vendor_settingsId_fkey" FOREIGN KEY ("vendor_settingsId") REFERENCES "vendor_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_bookings" ADD CONSTRAINT "service_bookings_vendor_settingsId_fkey" FOREIGN KEY ("vendor_settingsId") REFERENCES "vendor_settings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
