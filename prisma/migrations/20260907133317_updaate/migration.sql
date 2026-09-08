-- AlterTable
ALTER TABLE "coupons" ADD COLUMN     "service_id" INTEGER;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_currency_id_fkey" FOREIGN KEY ("currency_id") REFERENCES "currencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
