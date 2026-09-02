-- Production-grade, tenant-aware admin authorization.
-- This is an expand/backfill migration: legacy role columns are retained but
-- are no longer used as an authorization source.

CREATE TYPE "UserRole" AS ENUM ('customer', 'vendor', 'admin', 'vendor_admin', 'super_admin');
CREATE TYPE "UserStatus" AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE "AdminScope" AS ENUM ('platform', 'vendor');
CREATE TYPE "AdminStatus" AS ENUM ('invited', 'active', 'suspended', 'revoked');
CREATE TYPE "PermissionScope" AS ENUM ('platform', 'vendor', 'both');

UPDATE "users"
SET "role" = LOWER(TRIM("role")),
    "status" = CASE
        WHEN LOWER(TRIM("status")) IN ('true', '1') THEN 'active'
        WHEN LOWER(TRIM("status")) IN ('false', '0') THEN 'inactive'
        ELSE LOWER(TRIM("status"))
    END;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM "users"
        WHERE "role" NOT IN ('customer', 'vendor', 'admin', 'vendor_admin', 'super_admin')
    ) THEN
        RAISE EXCEPTION 'Cannot migrate users.role: unsupported values exist';
    END IF;

    IF EXISTS (
        SELECT 1 FROM "users"
        WHERE "status" NOT IN ('active', 'inactive', 'suspended')
    ) THEN
        RAISE EXCEPTION 'Cannot migrate users.status: unsupported values exist';
    END IF;
END $$;

ALTER TABLE "users" ADD COLUMN "auth_version" INTEGER NOT NULL DEFAULT 1;

DO $$
BEGIN
    IF EXISTS (
        SELECT "phone"
        FROM "users"
        WHERE "phone" IS NOT NULL
        GROUP BY "phone"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Cannot create users.phone uniqueness constraint: duplicates exist';
    END IF;
END $$;

CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "UserRole" USING ("role"::"UserRole");
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'customer';
ALTER TABLE "users" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "status" TYPE "UserStatus" USING ("status"::"UserStatus");
ALTER TABLE "users" ALTER COLUMN "status" SET DEFAULT 'active';

ALTER TABLE "admins"
    ADD COLUMN "vendor_id" INTEGER,
    ADD COLUMN "scope" "AdminScope" NOT NULL DEFAULT 'platform',
    ADD COLUMN "authz_version" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "created_by_user_id" INTEGER,
    ADD COLUMN "invitation_token_hash" TEXT,
    ADD COLUMN "invitation_expires_at" TIMESTAMP(3),
    ADD COLUMN "invited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "activated_at" TIMESTAMP(3),
    ADD COLUMN "revoked_at" TIMESTAMP(3);

UPDATE "admins"
SET "status" = CASE
    WHEN LOWER(TRIM("status")) = 'active' THEN 'active'
    WHEN LOWER(TRIM("status")) = 'suspended' THEN 'suspended'
    WHEN LOWER(TRIM("status")) IN ('inactive', 'disabled', 'revoked') THEN 'revoked'
    ELSE 'suspended'
END;

ALTER TABLE "admins" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "admins" ALTER COLUMN "status" TYPE "AdminStatus" USING ("status"::"AdminStatus");
ALTER TABLE "admins" ALTER COLUMN "status" SET DEFAULT 'invited';

-- Existing platform admins remain active. Existing vendor-admin rows cannot be
-- assigned to a store safely from the legacy schema, so fail closed until an
-- operator explicitly assigns vendor_id and scope='vendor'.
UPDATE "admins" AS a
SET "status" = 'suspended'
FROM "users" AS u
WHERE a."user_id" = u."id" AND u."role" = 'vendor_admin';

INSERT INTO "admins" (
    "user_id", "role", "scope", "status", "activated_at", "created_at"
)
SELECT
    u."id", u."role"::TEXT, 'platform', 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "users" AS u
WHERE u."role" IN ('admin', 'super_admin')
ON CONFLICT ("user_id") DO NOTHING;

ALTER TABLE "admin_types"
    ADD COLUMN "scope" "PermissionScope" NOT NULL DEFAULT 'both',
    ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "admin_permissions"
    ADD COLUMN "granted_by_user_id" INTEGER,
    ADD COLUMN "expires_at" TIMESTAMP(3);

-- Legacy code confused users.id with admins.id when writing grants. Existing
-- rows cannot be trusted even when their foreign key happens to resolve, so
-- disable them and require an explicit audited reassignment.
UPDATE "admin_permissions" SET "status" = false, "updated_at" = CURRENT_TIMESTAMP;

CREATE TABLE "admin_audit_logs" (
    "id" SERIAL NOT NULL,
    "actor_user_id" INTEGER NOT NULL,
    "target_admin_id" INTEGER,
    "vendor_id" INTEGER,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'success',
    "changes" JSONB,
    "request_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "admin_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "admins_invitation_token_hash_key"
    ON "admins"("invitation_token_hash");
CREATE INDEX "admins_scope_status_idx" ON "admins"("scope", "status");
CREATE INDEX "admins_vendor_id_status_idx" ON "admins"("vendor_id", "status");
CREATE INDEX "admin_permissions_expires_at_idx" ON "admin_permissions"("expires_at");
CREATE INDEX "admin_audit_logs_actor_user_id_created_at_idx"
    ON "admin_audit_logs"("actor_user_id", "created_at");
CREATE INDEX "admin_audit_logs_target_admin_id_created_at_idx"
    ON "admin_audit_logs"("target_admin_id", "created_at");
CREATE INDEX "admin_audit_logs_vendor_id_created_at_idx"
    ON "admin_audit_logs"("vendor_id", "created_at");

ALTER TABLE "admins"
    ADD CONSTRAINT "admins_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "admins_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "admins_scope_vendor_check"
    CHECK (
        ("scope" = 'platform' AND "vendor_id" IS NULL)
        OR ("scope" = 'vendor' AND "vendor_id" IS NOT NULL)
    );

ALTER TABLE "admin_permissions"
    ADD CONSTRAINT "admin_permissions_granted_by_user_id_fkey"
    FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "admin_audit_logs"
    ADD CONSTRAINT "admin_audit_logs_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "admin_audit_logs_target_admin_id_fkey"
    FOREIGN KEY ("target_admin_id") REFERENCES "admins"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "admin_audit_logs_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "admin_types" (
    "admin_type", "slug", "description", "scope", "is_system", "status"
)
VALUES
    ('Admin Management', 'admins', 'Manage scoped staff and grants', 'both', true, true),
    ('Categories', 'categories', 'Manage the global category catalogue', 'platform', true, true),
    ('Countries', 'countries', 'Manage supported countries', 'platform', true, true),
    ('Currencies', 'currencies', 'Manage supported currencies', 'platform', true, true),
    ('Products', 'products', 'Manage and moderate products', 'both', true, true),
    ('Orders', 'orders', 'Read and update scoped orders', 'both', true, true),
    ('Shipments', 'shipments', 'Manage scoped fulfillment', 'vendor', true, true),
    ('Returns', 'returns', 'Manage scoped returns', 'both', true, true),
    ('Refunds', 'refunds', 'Manage scoped refunds', 'vendor', true, true),
    ('Payments', 'payments', 'Read scoped payment state', 'vendor', true, true),
    ('Transactions', 'transactions', 'Read scoped transactions', 'both', true, true),
    ('Dashboard', 'dashboard', 'Read vendor dashboard metrics', 'vendor', true, true),
    ('Settings', 'settings', 'Manage scoped settings', 'both', true, true),
    ('Support', 'support', 'Manage scoped support tickets', 'both', true, true),
    ('Coupons', 'coupons', 'Manage vendor promotions', 'vendor', true, true)
ON CONFLICT ("slug") DO UPDATE
SET "description" = EXCLUDED."description",
    "scope" = EXCLUDED."scope",
    "is_system" = true,
    "status" = true,
    "updated_at" = CURRENT_TIMESTAMP;
