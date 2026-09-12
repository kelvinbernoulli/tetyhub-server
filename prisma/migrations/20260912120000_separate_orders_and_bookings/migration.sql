BEGIN;

-- Do not discard service sales, payment references, or mixed-order totals.
LOCK TABLE "orders", "order_items", "service_bookings" IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "order_items"
        WHERE "service_id" IS NOT NULL OR "product_id" IS NULL
    ) THEN
        RAISE EXCEPTION 'Reconcile legacy service order items, payments and order totals into standalone bookings before applying this migration';
    END IF;
END $$;

ALTER TABLE "service_bookings" ADD COLUMN "user_id" INTEGER;
UPDATE "service_bookings" AS b
SET "user_id" = o."user_id"
FROM "order_items" AS oi
JOIN "orders" AS o ON o."id" = oi."order_id"
WHERE oi."id" = b."order_item_id";
ALTER TABLE "service_bookings" ALTER COLUMN "user_id" SET NOT NULL;
ALTER TABLE "service_bookings" ADD CONSTRAINT "service_bookings_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "service_bookings" DROP COLUMN "order_item_id";
CREATE INDEX "service_bookings_user_id_booking_status_idx"
    ON "service_bookings"("user_id", "booking_status");

ALTER TABLE "order_items" DROP COLUMN "service_id";
ALTER TABLE "order_items" ALTER COLUMN "product_id" SET NOT NULL;

COMMIT;
