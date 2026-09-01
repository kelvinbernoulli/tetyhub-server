-- AlterTable
ALTER TABLE "products" ADD COLUMN     "child_subcategory_id" INTEGER;

-- CreateTable
CREATE TABLE "child_subcategories" (
    "id" SERIAL NOT NULL,
    "subcategory_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "status" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "child_subcategories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "child_subcategories_subcategory_id_slug_key" ON "child_subcategories"("subcategory_id", "slug");

-- AddForeignKey
ALTER TABLE "child_subcategories" ADD CONSTRAINT "child_subcategories_subcategory_id_fkey" FOREIGN KEY ("subcategory_id") REFERENCES "subcategories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_child_subcategory_id_fkey" FOREIGN KEY ("child_subcategory_id") REFERENCES "child_subcategories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
