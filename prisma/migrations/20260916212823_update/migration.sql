/*
  Warnings:

  - Added the required column `vendor_id` to the `service_bookings` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');

-- AlterTable
ALTER TABLE "service_bookings" ADD COLUMN     "vendor_id" INTEGER NOT NULL,
ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');

-- AddForeignKey
ALTER TABLE "service_bookings" ADD CONSTRAINT "service_bookings_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
