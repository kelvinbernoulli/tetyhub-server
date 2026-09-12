/*
  Warnings:

  - You are about to drop the column `product_name` on the `order_items` table. All the data in the column will be lost.
  - You are about to drop the column `reservation_expires_at` on the `orders` table. All the data in the column will be lost.
  - You are about to drop the column `booking_id` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `buffer_mins` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `cancellation_fee_percent` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `cancellation_reason` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `cancellation_window_hours` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `checkout_hash` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `checkout_key` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `created_at` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `currency_id` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `ends_at` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `location_type` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `payment_method` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `payment_status` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `refund_due` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `reservation_expires_at` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `service_name` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `total` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `user_id` on the `service_bookings` table. All the data in the column will be lost.
  - You are about to drop the column `vendor_id` on the `service_bookings` table. All the data in the column will be lost.
  - Made the column `currency_id` on table `orders` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "coupon_usage" DROP CONSTRAINT "coupon_usage_coupon_id_fkey";

-- DropForeignKey
ALTER TABLE "coupon_usage" DROP CONSTRAINT "coupon_usage_user_id_fkey";

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_currency_id_fkey";

-- DropForeignKey
ALTER TABLE "payments" DROP CONSTRAINT "payments_booking_id_fkey";

-- DropForeignKey
ALTER TABLE "service_bookings" DROP CONSTRAINT "service_bookings_currency_id_fkey";

-- DropForeignKey
ALTER TABLE "service_bookings" DROP CONSTRAINT "service_bookings_user_id_fkey";

-- DropForeignKey
ALTER TABLE "service_bookings" DROP CONSTRAINT "service_bookings_vendor_id_fkey";

-- DropIndex
DROP INDEX "orders_status_reservation_expires_at_idx";

-- DropIndex
DROP INDEX "payments_booking_id_key";

-- DropIndex
DROP INDEX "service_bookings_service_id_scheduled_for_ends_at_idx";

-- DropIndex
DROP INDEX "service_bookings_user_id_booking_status_idx";

-- DropIndex
DROP INDEX "service_bookings_user_id_checkout_key_key";

-- DropIndex
DROP INDEX "service_bookings_vendor_id_booking_status_idx";

-- AlterTable
ALTER TABLE "order_items" DROP COLUMN "product_name",
ADD COLUMN     "service_id" INTEGER,
ALTER COLUMN "product_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "orders" DROP COLUMN "reservation_expires_at",
ALTER COLUMN "currency_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "booking_id";

-- AlterTable
ALTER TABLE "service_bookings" DROP COLUMN "buffer_mins",
DROP COLUMN "cancellation_fee_percent",
DROP COLUMN "cancellation_reason",
DROP COLUMN "cancellation_window_hours",
DROP COLUMN "checkout_hash",
DROP COLUMN "checkout_key",
DROP COLUMN "created_at",
DROP COLUMN "currency_id",
DROP COLUMN "ends_at",
DROP COLUMN "location",
DROP COLUMN "location_type",
DROP COLUMN "payment_method",
DROP COLUMN "payment_status",
DROP COLUMN "refund_due",
DROP COLUMN "reservation_expires_at",
DROP COLUMN "service_name",
DROP COLUMN "total",
DROP COLUMN "updated_at",
DROP COLUMN "user_id",
DROP COLUMN "vendor_id",
ALTER COLUMN "scheduled_for" SET DATA TYPE TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "order_items_service_id_idx" ON "order_items"("service_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usage" ADD CONSTRAINT "coupon_usage_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_usage" ADD CONSTRAINT "coupon_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
