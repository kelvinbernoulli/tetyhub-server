-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');

-- AlterTable
ALTER TABLE "service_bookings" ALTER COLUMN "reservation_expires_at" SET DEFAULT (now() + interval '30 minutes');

-- CreateTable
CREATE TABLE "faq" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "faq_pkey" PRIMARY KEY ("id")
);
