/*
  Warnings:

  - You are about to drop the column `currency` on the `countries` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `child_subcategory_id` on the `products` table. All the data in the column will be lost.
  - You are about to drop the `child_subcategories` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `currency_id` to the `cart_items` table without a default value. This is not possible if the table is not empty.
  - Added the required column `currency_id` to the `countries` table without a default value. This is not possible if the table is not empty.
  - Added the required column `currency_id` to the `payments` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CategoryType" AS ENUM ('product', 'service', 'both');

-- DropForeignKey
ALTER TABLE "child_subcategories" DROP CONSTRAINT "child_subcategories_subcategory_id_fkey";

-- DropForeignKey
ALTER TABLE "order_items" DROP CONSTRAINT "order_items_product_id_fkey";

-- DropForeignKey
ALTER TABLE "products" DROP CONSTRAINT "products_child_subcategory_id_fkey";

-- AlterTable
ALTER TABLE "cart_items" ADD COLUMN     "currency_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "type" "CategoryType" NOT NULL DEFAULT 'product';

-- AlterTable
ALTER TABLE "countries" DROP COLUMN "currency",
ADD COLUMN     "currency_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "service_id" INTEGER,
ALTER COLUMN "product_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "currency",
ADD COLUMN     "currency_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "products" DROP COLUMN "child_subcategory_id",
ADD COLUMN     "childcategory_id" INTEGER;

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "service_id" INTEGER,
ALTER COLUMN "product_id" DROP NOT NULL;

-- DropTable
DROP TABLE "child_subcategories";

-- CreateTable
CREATE TABLE "childcategories" (
    "id" SERIAL NOT NULL,
    "subcategory_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "childcategories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" SERIAL NOT NULL,
    "vendor_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "base_price" DECIMAL(10,2) NOT NULL,
    "currency_id" INTEGER NOT NULL,
    "duration_mins" INTEGER NOT NULL DEFAULT 60,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_bookings" (
    "id" SERIAL NOT NULL,
    "order_item_id" INTEGER NOT NULL,
    "service_id" INTEGER NOT NULL,
    "scheduled_for" TIMESTAMP(3) NOT NULL,
    "booking_status" TEXT NOT NULL DEFAULT 'pending',
    "additional_notes" TEXT,

    CONSTRAINT "service_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "childcategories_subcategory_id_slug_key" ON "childcategories"("subcategory_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "services_slug_key" ON "services"("slug");

-- CreateIndex
CREATE INDEX "services_vendor_id_status_idx" ON "services"("vendor_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "service_bookings_order_item_id_key" ON "service_bookings"("order_item_id");

-- CreateIndex
CREATE INDEX "service_bookings_service_id_booking_status_idx" ON "service_bookings"("service_id", "booking_status");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "order_items_service_id_idx" ON "order_items"("service_id");

-- AddForeignKey
ALTER TABLE "childcategories" ADD CONSTRAINT "childcategories_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_childcategory_id_fkey" FOREIGN KEY ("childcategory_id") REFERENCES "childcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "countries" ADD CONSTRAINT "countries_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_bookings" ADD CONSTRAINT "service_bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_bookings" ADD CONSTRAINT "service_bookings_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
