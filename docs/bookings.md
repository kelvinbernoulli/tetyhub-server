# Service bookings

Orders and cart checkout handle products only. Bookings are independent service
reservations. Apply the pending Prisma migrations before running the updated
server; no migrations run automatically on application startup.

## Customer API

Paths below use the existing `/v1/api` prefix (or configured API version).
Authenticated mutations require the session CSRF token in `X-CSRF-Token`.

1. `GET /services/:serviceId/availability?scheduled_for=2027-01-15T10%3A00%3A00Z`
   returns price, currency, end time, location type and remaining capacity for that
   start time. Availability is advisory; reservation creation checks it again.
2. `POST /bookings` reserves a slot for 15 minutes, capped at the service start:

    ```json
    {
        "service_id": 3,
        "scheduled_for": "2027-01-15T10:00:00Z",
        "gateway": "paystack",
        "expected_currency": "NGN",
        "expected_total": 5000,
        "idempotency_key": "4691a072-9c05-4555-a9d8-7c20753e2131",
        "additional_notes": "Initial consultation"
    }
    ```

    Supply `location` when the service takes place at the customer's location.
    Times require an explicit UTC offset or `Z`, must be in the future and within
    one year. A successful response saves a booking; it does not mean payment
    succeeded. Reuse the same key and payload on retries; changed payloads return 409. Product IDs, order IDs, prices other than the expected total, and owner
    overrides are rejected. The server snapshots the service price and policy.

3. `POST /bookings/:bookingId/payment` initializes or resumes the selected gateway.
   No body is required. Paystack returns `authorization_url`; Stripe returns
   `client_secret`. Both return `reference`. NGN uses Paystack; USD/EUR/GBP use Stripe.
4. `GET /payment/verify/:reference?gateway=paystack` uses the existing authenticated
   payment verification endpoint. Provider-signed webhooks also confirm bookings.
   Only `payment_status: paid` and `status: confirmed` mean a paid reservation is
   ready for fulfillment. Late payments produce `payment_review`, not a new slot.
5. `GET /bookings?status=confirmed&limit=20&offset=0` and `GET /bookings/:bookingId`
   return the customer's own bookings.
6. `PATCH /bookings/:bookingId/cancel` with `{ "reason": "Plans changed" }`
   cancels pending/confirmed bookings before the scheduled start. Paid cancellations
   record `refund_due`; within the snapshotted cancellation window, the configured
   percentage is retained as the cancellation fee. This is a reconciliation amount,
   not confirmation that the gateway has issued a refund.

Booking creation shares the existing 10 requests/minute checkout limit; payment
initialization shares the existing 30 requests/minute payment limit.

## Vendor API

Under `/v1/api/vendor`, using the authenticated vendor scope:

- `GET /bookings` and `GET /bookings/:bookingId` require service read permission.
- `PATCH /bookings/:bookingId/status` with `{ "status": "active" }` starts a paid,
  confirmed booking at or after its scheduled start. `completed` is allowed from
  active at or after its scheduled end. Requires service update permission.
- `PATCH /bookings/:bookingId/cancel` with a reason cancels pending/confirmed
  bookings. Vendor cancellation records the full paid amount as `refund_due`.

Bookings are confirmed only by verified payment, not a vendor status override.
Customers receive in-app notifications for confirmation, cancellation, status
changes and payments requiring refund review. Automated refund disbursement is
unavailable, consistent with product-order refunds; reconcile refunds through
Paystack/Stripe. There is no rescheduling endpoint: cancel and create a new booking.

## Capacity, expiry and migration

Service-row locks serialize overlapping reservation creation and payment
confirmation. Capacity uses maximum simultaneous overlap, including each session's
buffer. Expired unpaid reservations release availability immediately, even before
the existing 30-second checkout worker marks them expired. The worker starts with the server and keeps list statuses current. Paid/active bookings remain independent of later
service price or policy edits. With no opening-hours calendar in the service
model, any future time meeting the capacity rules is bookable.

The separation migration refuses to discard legacy service order items. Reconcile
those sales, order totals and payments before applying it. The workflow migration
marks existing bookings' payment status `review` so they cannot be charged again
without reconciliation. Both migrations use explicit transactions. Legacy scheduling timestamps are assumed
to be UTC when converting them to timezone-aware storage.

Run `npm.cmd test` for unit tests. Set `BOOKING_DATABASE_URL` to a disposable
PostgreSQL database and run `node --test test/bookings-database.test.js` for migration,
concurrent capacity, payment replay and cancellation coverage. The test creates
and drops an isolated schema. Without that explicit URL the database test skips.

Gateway contracts follow the existing integrations:
[Paystack transactions](https://paystack.com/docs/api/transaction/) and
[Stripe PaymentIntents](https://docs.stripe.com/api/payment_intents/create).
