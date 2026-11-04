ALTER TABLE kyc_address
    ADD COLUMN house_number TEXT;

CREATE TABLE kyc_id_fingerprints (
    id_type VARCHAR(3) NOT NULL,
    fingerprint CHAR(64) NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id_type, fingerprint),
    UNIQUE (user_id, id_type)
);

CREATE INDEX kyc_id_fingerprints_user_id_idx ON kyc_id_fingerprints (user_id);
