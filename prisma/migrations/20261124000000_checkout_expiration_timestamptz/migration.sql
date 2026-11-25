-- Checkout expiry is an absolute instant. The original TIMESTAMP column
-- stored database-local wall time, which Node could reinterpret in its own
-- timezone and mistakenly treat a fresh reservation as expired.
ALTER TABLE orders
    ALTER COLUMN reservation_expires_at TYPE TIMESTAMPTZ(3)
    USING reservation_expires_at AT TIME ZONE current_setting('TimeZone');
