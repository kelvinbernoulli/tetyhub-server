-- AlterTable
ALTER TABLE "admin_permissions" ALTER COLUMN "status" SET DEFAULT false;

-- AlterTable
ALTER TABLE "vendors" ALTER COLUMN "store_name" DROP NOT NULL;
