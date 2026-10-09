BEGIN;

ALTER TABLE service_bookings
  ALTER COLUMN reservation_expires_at
    SET DEFAULT (NOW() + INTERVAL '24 hours'),
  ADD COLUMN vendor_response_note TEXT,
  ADD COLUMN proposed_scheduled_for TIMESTAMPTZ(3),
  ADD COLUMN proposed_ends_at TIMESTAMPTZ(3),
  ADD CONSTRAINT service_bookings_reschedule_pair_check
    CHECK (
      (proposed_scheduled_for IS NULL AND proposed_ends_at IS NULL)
      OR (
        proposed_scheduled_for IS NOT NULL
        AND proposed_ends_at IS NOT NULL
        AND proposed_ends_at > proposed_scheduled_for
      )
    );

-- Preserve payment sessions already issued under the previous booking flow.
UPDATE service_bookings b
SET booking_status = 'accepted'
WHERE b.booking_status = 'pending'
  AND b.payment_status = 'unpaid'
  AND EXISTS (
    SELECT 1 FROM payments p
    WHERE p.booking_id = b.id
      AND p.status = 'pending'
      AND p.checkout_data IS NOT NULL
  );

COMMIT;
