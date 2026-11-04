CREATE TABLE "system_logs" (
    "id" BIGSERIAL NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'error',
    "event" TEXT NOT NULL,
    "message" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "user_id" INTEGER,
    "request_id" TEXT,
    "method" TEXT,
    "path" TEXT,
    "status_code" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "system_logs_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "system_logs_created_at_idx" ON "system_logs"("created_at");
CREATE INDEX "system_logs_level_created_at_idx" ON "system_logs"("level", "created_at");
CREATE INDEX "system_logs_user_id_created_at_idx" ON "system_logs"("user_id", "created_at");
