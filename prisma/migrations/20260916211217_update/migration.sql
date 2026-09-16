-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');

-- AlterTable
ALTER TABLE "service_bookings" ADD COLUMN     "payment_status" TEXT NOT NULL DEFAULT 'unpaid',
ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');
