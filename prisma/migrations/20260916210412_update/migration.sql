/*
  Warnings:

  - You are about to drop the column `additional_notes` on the `service_bookings` table. All the data in the column will be lost.
  - Added the required column `checkout_hash` to the `service_bookings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `checkout_key` to the `service_bookings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `currency_id` to the `service_bookings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `location` to the `service_bookings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `location_type` to the `service_bookings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `payment_method` to the `service_bookings` table without a default value. This is not possible if the table is not empty.
  - Added the required column `service_name` to the `service_bookings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');

-- AlterTable
ALTER TABLE "service_bookings" DROP COLUMN "additional_notes",
ADD COLUMN     "buffer_mins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "cancellation_fee_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "cancellation_window_hours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "checkout_hash" TEXT NOT NULL,
ADD COLUMN     "checkout_key" TEXT NOT NULL,
ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "currency_id" INTEGER NOT NULL,
ADD COLUMN     "ends_at" TIMESTAMP(3),
ADD COLUMN     "location" TEXT NOT NULL,
ADD COLUMN     "location_type" TEXT NOT NULL,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "payment_method" TEXT NOT NULL,
ADD COLUMN     "reservation_expires_at" TIMESTAMP(3) DEFAULT (now() + interval '30 minutes'),
ADD COLUMN     "service_name" TEXT NOT NULL,
ADD COLUMN     "total" DECIMAL(10,2);
