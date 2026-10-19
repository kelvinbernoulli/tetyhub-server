CREATE TABLE "service_bookmarks" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "service_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_bookmarks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_bookmarks_user_id_service_id_key"
    ON "service_bookmarks"("user_id", "service_id");

CREATE INDEX "service_bookmarks_user_id_created_at_idx"
    ON "service_bookmarks"("user_id", "created_at");

ALTER TABLE "service_bookmarks"
    ADD CONSTRAINT "service_bookmarks_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "service_bookmarks"
    ADD CONSTRAINT "service_bookmarks_service_id_fkey"
    FOREIGN KEY ("service_id") REFERENCES "services"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
