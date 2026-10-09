-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');

-- AlterTable
ALTER TABLE "service_bookings" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');
