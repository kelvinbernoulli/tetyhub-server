/*
  Warnings:

  - You are about to drop the column `exchange_rate` on the `currencies` table. All the data in the column will be lost.
  - You are about to drop the column `symbol` on the `currencies` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "currencies" DROP COLUMN "exchange_rate",
DROP COLUMN "symbol",
ADD COLUMN     "status" BOOLEAN NOT NULL DEFAULT true;
