# Service bookings

Orders and cart checkout handle products only. A service booking is a separate
reservation owned by the customer and the service's vendor. Apply pending Prisma
migrations before deploying; migrations do not run automatically at startup.

## Booking flow

1. A customer requests a slot. The request is held for up to 24 hours, capped at
   the service start time, while the vendor decides.
2. The vendor accepts or declines. A decline requires a reason and does not
   charge the customer.
3. Acceptance opens a payment window of up to 15 minutes, capped at the service
   start time. The customer can then initialize Paystack payment.
4. Only verified payment confirms the booking. Vendors can start a confirmed,
   paid booking at or after its start and mark it completed at or after its end.
5. For a future, paid booking, the vendor can propose a different time. The
   existing time remains in force until the customer accepts; the proposed slot
   is checked again for capacity when accepted.

The application currently launches with Paystack and NGN. Payment confirmation
does not mean funds are held in escrow or that vendor payout is delayed; refund
amounts are recorded for reconciliation and must be issued through the payment
provider until a supported marketplace hold-and-release arrangement is in
place.

## Customer API

Paths below use the existing `/v1/api` prefix (or configured API version).
Authenticated mutations require the session CSRF token in `X-CSRF-Token`.

- `GET /services/:serviceId/availability?scheduled_for=2027-01-15T10%3A00%3A00Z`
  returns price, currency, end time, location type, and remaining capacity.
  Availability is advisory; booking creation checks it again.
- `POST /service/book` submits a booking request:

  ```json
  {
    "service_id": 3,
    "scheduled_for": "2027-01-15T10:00:00Z",
    "gateway": "paystack",
    "expected_currency": "NGN",
    "expected_total": 5000,
    "idempotency_key": "4691a072-9c05-4555-a9d8-7c20753e2131",
    "note": "Initial consultation"
  }
  ```

  Supply `location` when the service takes place at the customer's location.
  Times require an explicit UTC offset or `Z`, must be in the future and within
  one year. Reuse the same UUID idempotency key and payload on retries; a
  different payload with the same key returns 409. The server snapshots price
  and booking policy. The request is not payable until the vendor accepts.
- `GET /bookings` and `GET /bookings/:bookingId` return the customer's bookings.
- `POST /bookings/:bookingId/payment` initializes or resumes Paystack payment.
  It is payable only after vendor acceptance and before `reservation_expires_at`.
- `PATCH /bookings/:bookingId/reschedule` responds to a vendor proposal with
  `{ "accept": true }` or `{ "accept": false }`. Accepting rechecks capacity.
- `PATCH /bookings/:bookingId/cancel` with `{ "reason": "Plans changed" }`
  cancels a pending, accepted, or confirmed booking before its start. Paid
  cancellations record `refund_due`; this is not confirmation that Paystack
  issued a refund.

Booking creation shares the existing checkout rate limit, and payment
initialization shares the payment rate limit. Paystack webhooks confirm bookings;
late payments after cancellation or expiry enter `payment_review` for
reconciliation.

## Vendor API

Under `/v1/api/vendor`, using the authenticated vendor scope (including vendor
admins with service permissions):

- `GET /bookings` and `GET /bookings/:bookingId` list only bookings belonging
  to that vendor.
- `PATCH /bookings/:bookingId/decision` accepts or declines a pending request:

  ```json
  { "decision": "accept" }
  ```

  Or decline with a required reason:

  ```json
  { "decision": "decline", "reason": "Unavailable at that time" }
  ```

- `PATCH /bookings/:bookingId/reschedule` proposes a time:

  ```json
  { "scheduled_for": "2027-01-16T10:00:00Z" }
  ```

  Only one proposal can be pending at a time. The buyer must accept it before
  the confirmed time changes.
- `PATCH /bookings/:bookingId/status` with `{ "status": "active" }` starts a
  paid, confirmed booking at or after its scheduled start. `completed` is
  allowed from active at or after its scheduled end.
- `PATCH /bookings/:bookingId/cancel` with a reason cancels pending, accepted,
  or confirmed bookings. Vendor cancellation records the full paid amount as
  `refund_due`.

## Capacity, expiry, and migrations

Service-row locks serialize overlapping reservations and reschedule approval.
Capacity includes pending vendor decisions, accepted payment windows, confirmed
and active bookings, and session buffers. A proposed time does not reserve
capacity until the buyer accepts it; approval rechecks availability. The
30-second checkout worker expires unpaid requests and accepted payment windows.

The new `20261008180000_vendor_booking_lifecycle` migration adds vendor response
and proposed-reschedule data, and preserves already-initialized payment sessions
from the previous flow. The earlier separation migration refuses to discard
legacy service order items; reconcile those sales, order totals, and payments
before applying it.

Run `node --test test/bookings.test.js` for unit coverage. Set
`BOOKING_DATABASE_URL` to a disposable PostgreSQL database and run
`node --test test/bookings-database.test.js` for migration, concurrency, and
payment integration coverage. The database test creates and drops an isolated
schema; without the explicit URL it skips.
