-- AlterTable
ALTER TABLE "countries" ADD COLUMN     "status" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "barcode" TEXT;
