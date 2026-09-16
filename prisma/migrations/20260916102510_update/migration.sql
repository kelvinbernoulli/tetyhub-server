-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes'),
ALTER COLUMN "reservation_expires_at" SET DATA TYPE TIMESTAMP(3);
