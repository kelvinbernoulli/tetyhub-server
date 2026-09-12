BEGIN;
-- Legacy scheduling timestamps are interpreted as UTC.
ALTER TABLE service_bookings ALTER COLUMN scheduled_for TYPE TIMESTAMPTZ(3)
  USING scheduled_for AT TIME ZONE 'UTC';
ALTER TABLE service_bookings
  ADD COLUMN vendor_id INTEGER,
  ADD COLUMN currency_id INTEGER,
  ADD COLUMN service_name TEXT,
  ADD COLUMN total DECIMAL(10,2),
  ADD COLUMN ends_at TIMESTAMPTZ(3),
  ADD COLUMN buffer_mins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN location_type TEXT,
  ADD COLUMN location TEXT,
  ADD COLUMN cancellation_window_hours INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN cancellation_fee_percent DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'unpaid',
  ADD COLUMN payment_method TEXT,
  ADD COLUMN reservation_expires_at TIMESTAMPTZ(3),
  ADD COLUMN checkout_key TEXT,
  ADD COLUMN checkout_hash TEXT,
  ADD COLUMN cancellation_reason TEXT,
  ADD COLUMN refund_due DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN updated_at TIMESTAMPTZ(3);

-- Legacy payment history is unknown: do not enable charging these bookings.
UPDATE service_bookings b SET vendor_id = s.vendor_id, currency_id = s.currency_id,
  service_name = s.name, total = s.base_price,
  ends_at = b.scheduled_for + make_interval(mins => s.duration_mins),
  buffer_mins = s.buffer_mins, location_type = s.location_type,
  cancellation_window_hours = s.cancellation_window_hours,
  cancellation_fee_percent = s.cancellation_fee_percent, payment_status = 'review'
FROM services s WHERE s.id = b.service_id;
ALTER TABLE service_bookings
  ALTER COLUMN vendor_id SET NOT NULL,
  ALTER COLUMN currency_id SET NOT NULL,
  ALTER COLUMN service_name SET NOT NULL,
  ALTER COLUMN total SET NOT NULL,
  ALTER COLUMN ends_at SET NOT NULL,
  ALTER COLUMN location_type SET NOT NULL,
  ADD CONSTRAINT service_bookings_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT service_bookings_currency_id_fkey FOREIGN KEY (currency_id) REFERENCES currencies(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT service_bookings_time_check CHECK (ends_at > scheduled_for),
  ADD CONSTRAINT service_bookings_money_check CHECK (total >= 0 AND refund_due >= 0 AND refund_due <= total),
  ADD CONSTRAINT service_bookings_policy_check CHECK (buffer_mins >= 0 AND cancellation_window_hours >= 0 AND cancellation_fee_percent BETWEEN 0 AND 100);
CREATE UNIQUE INDEX service_bookings_user_id_checkout_key_key ON service_bookings(user_id, checkout_key);
CREATE INDEX service_bookings_vendor_id_booking_status_idx ON service_bookings(vendor_id, booking_status);
CREATE INDEX service_bookings_service_id_scheduled_for_ends_at_idx ON service_bookings(service_id, scheduled_for, ends_at);
ALTER TABLE payments ADD COLUMN booking_id INTEGER,
  ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES service_bookings(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT payments_booking_order_check CHECK (booking_id IS NULL OR order_id IS NULL);
CREATE UNIQUE INDEX payments_booking_id_key ON payments(booking_id);
COMMIT;
