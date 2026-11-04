-- Raw SQL subscription inserts rely on a database-side timestamp default.
ALTER TABLE "subscriptions"
    ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
