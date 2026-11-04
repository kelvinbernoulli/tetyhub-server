CREATE TABLE kyc_identity (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    id_type JSONB NOT NULL DEFAULT '{}'::jsonb,
    id_number JSONB NOT NULL DEFAULT '{}'::jsonb,
    id_document TEXT,
    country VARCHAR(2) NOT NULL,
    document_number JSONB NOT NULL DEFAULT '{}'::jsonb,
    verification_status JSONB NOT NULL DEFAULT '{}'::jsonb,
    selfie TEXT NOT NULL,
    verification_data JSONB NOT NULL,
    review_reasons JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE kyc_business (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL,
    registration_number TEXT NOT NULL,
    business_document TEXT NOT NULL,
    business_address TEXT NOT NULL,
    verification_status TEXT NOT NULL DEFAULT 'pending',
    verification_data JSONB NOT NULL,
    review_reason TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE kyc_address (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    landmark TEXT,
    city TEXT NOT NULL,
    state TEXT NOT NULL,
    lga TEXT NOT NULL,
    street TEXT NOT NULL,
    address_verification_due_date TIMESTAMP(3),
    verification_type TEXT NOT NULL,
    country TEXT NOT NULL,
    verification_data JSONB NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'pending',
    review_reason TEXT,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX kyc_identity_verification_status_idx ON kyc_identity USING GIN (verification_status);
CREATE INDEX kyc_business_status_idx ON kyc_business (verification_status, created_at DESC);
CREATE INDEX kyc_address_created_idx ON kyc_address (created_at DESC);