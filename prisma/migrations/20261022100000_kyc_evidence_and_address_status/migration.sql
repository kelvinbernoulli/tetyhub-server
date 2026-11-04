CREATE TABLE IF NOT EXISTS kyc_identity_evidence (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id_type VARCHAR(3) NOT NULL CHECK (id_type IN ('nin', 'bvn', 'pp')),
    selfie TEXT NOT NULL,
    id_document TEXT,
    country VARCHAR(2) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT kyc_identity_evidence_user_id_id_type_key UNIQUE (user_id, id_type)
);

CREATE INDEX IF NOT EXISTS kyc_identity_evidence_user_id_idx
    ON kyc_identity_evidence (user_id);

-- Existing rows only have one shared evidence pair. Backfill it only when its
-- document type is unambiguous; never copy one document onto several ID types.
INSERT INTO kyc_identity_evidence (user_id, id_type, selfie, id_document, country, created_at, updated_at)
SELECT i.user_id, id_type.key, i.selfie, i.id_document, i.country, i.created_at, i.updated_at
FROM kyc_identity i
CROSS JOIN LATERAL jsonb_object_keys(COALESCE(i.id_type, '{}'::jsonb)) AS id_type(key)
WHERE (
    SELECT COUNT(*)
    FROM jsonb_object_keys(COALESCE(i.id_type, '{}'::jsonb))
) = 1
ON CONFLICT (user_id, id_type) DO NOTHING;

ALTER TABLE kyc_address
    ADD COLUMN IF NOT EXISTS provider_job_id TEXT,
    ADD COLUMN IF NOT EXISTS provider_status TEXT NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS provider_checked_at TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS kyc_address_provider_job_id_key
    ON kyc_address (provider_job_id)
    WHERE provider_job_id IS NOT NULL;
