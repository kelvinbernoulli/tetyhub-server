-- Restore the relationship removed by 20260912145208_bookings.
-- Deleted historical links cannot be inferred safely and are not fabricated.
ALTER TABLE payments ADD COLUMN booking_id INTEGER;
ALTER TABLE payments ADD CONSTRAINT payments_booking_id_fkey
    FOREIGN KEY (booking_id) REFERENCES service_bookings(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_booking_order_check CHECK (booking_id IS NULL OR order_id IS NULL);
CREATE UNIQUE INDEX payments_booking_id_key ON payments(booking_id);
