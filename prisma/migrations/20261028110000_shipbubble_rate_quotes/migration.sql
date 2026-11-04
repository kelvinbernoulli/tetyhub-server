CREATE TABLE shipbubble_rate_quotes (
    id UUID PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vendor_id INTEGER NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    request_token TEXT NOT NULL,
    courier_id TEXT NOT NULL,
    service_code TEXT NOT NULL,
    courier_name TEXT NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT NOT NULL,
    quote_data JSONB NOT NULL,
    expires_at TIMESTAMP(3) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX shipbubble_rate_quotes_user_id_expires_at_idx
    ON shipbubble_rate_quotes(user_id, expires_at);
CREATE INDEX shipbubble_rate_quotes_order_id_idx
    ON shipbubble_rate_quotes(order_id);

CREATE TABLE shipbubble_validated_addresses (
    address_hash TEXT PRIMARY KEY,
    address_code BIGINT NOT NULL,
    address_data JSONB NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
