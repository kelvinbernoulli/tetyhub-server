-- DropForeignKey
ALTER TABLE "cart_items" DROP CONSTRAINT "cart_items_currency_id_fkey";

-- AlterTable
ALTER TABLE "cart_items" ALTER COLUMN "currency_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
