# Checkout deployment and client contract

The checkout endpoints now share one implementation. The migration is
`prisma/migrations/20260911120000_checkout_reliability/migration.sql`.
Apply pending migrations in staging, run the integration test, then deploy the migration before the server.
No migration is applied automatically by the application.

## Client integration

1. GET `/v1/api/cart/preview-checkout?country=Nigeria&coupon_code=...`.
   Omit coupon_code when unused. Monetary values are decimal strings; currency is explicit.
2. POST `/v1/api/cart/checkout` with the existing flat contact/address fields plus:
    - `gateway`: `paystack` or `stripe`.
    - `expected_currency`: the currency from the preview.
    - `expected_total`: the preview total as a JSON number.
    - `idempotency_key`: a new UUID v4 per checkout, or pass it in `Idempotency-Key`.
      Keep the same key and exact payload when retrying a timed-out request.
      A changed payload with the same key returns 409.
3. A successful response means the order was saved. Only `payment_status: paid`
   means payment has completed. Persist `order_id` even when `payment` is null.
4. Resume payment with POST `/v1/api/orders/:order_id/payment`, body `{ "gateway": "paystack" }`.
   Orders keep their original gateway/currency. Initialization is serialized and uses one stable provider reference.
5. GET `/v1/api/payment/verify/:reference?gateway=paystack` with the reference returned
   by the server. This authenticated endpoint only verifies the customer's own payment.
   A pending provider result remains unpaid. Do not infer success from HTTP 200 alone.
6. `/orders/place` is now an alias of checkout and requires the same flat request body.
   Order history is `/orders/:orderId/history`. Cancellation is restricted to unpaid pending orders.

Checkout creation is limited to 10 requests/minute per authenticated user per server instance; payment endpoints allow 30. Use an edge/distributed limiter when scaling horizontally.

Prices are read afresh at checkout. A changed total returns 409 before creating an order.
Mixed-currency carts are rejected. Launch support is NGN via Paystack and USD/EUR/GBP via Stripe;
no implicit exchange or zero-decimal currency conversion is performed.

## Configuration

Set `CHECKOUT_SHIPPING_RATES` to JSON mapping currency to exact country names and
major-unit fees. Fees are charged once per vendor with non-free-shipping products.
Example shape only (replace with approved business rates):
`{"NGN":{"Nigeria":"1500.00"},"USD":{"United States":"5.00"}}`.
An empty configuration rejects paid-shipping destinations. Free-shipping products remain free.
This does not calculate taxes, carrier quotes, or duties; those require the business's destination rules.

Configure payment-provider credentials, `STRIPE_WEBHOOK_SECRET`, and SMTP settings.
Register Paystack `/v1/api/webhook/paystack` and Stripe `/v1/api/webhook/stripe`
(`payment_intent.succeeded`). These routes consume raw JSON bytes before session/JSON middleware.
Signature verification and amount/currency checks are mandatory. Repeated events are acknowledged;
event insertion and order/payment updates commit together.

## Recovery and operations

- Pending orders reserve tracked inventory for 30 minutes. The server's 30-second worker releases
  expired reservations and coupon usage in a transaction. Multiple server instances can run the worker.
- Late payments for cancelled orders become `payment_review`; they must be reviewed/refunded by an operator.
  They never re-enter fulfillment. Monitor `orders.status = 'payment_review'` and worker error logs.
- Provider initialization timeouts retain the same reference. Paystack verification recovers successful
  charges. If a pending accepted transaction has lost its authorization URL, the API returns
  `verification_required`; verify it or cancel/recheck out instead of issuing another charge for that order.
- Payment confirmation queues email durably. Email failures retry independently with a five-minute lease;
  delivery is at-least-once, so a crash after SMTP acceptance can produce a duplicate email.
- The previous automatic refund path is disabled with 503: it could mark credit as issued without a ledger
  and restock the whole order for partial refunds. Use the provider dashboard and reconcile the order
  manually until a dedicated refund/returns workflow is implemented. Refund webhooks are not automated here.
- Legacy orders have null currency/reservation metadata and cannot be charged by the new flow without
  explicit reconciliation. Legacy stock reservations are not guessed or restored by the worker.
- Existing installations with manual tables/schema changes must compare them with the migration first;
  the migration follows the checked-in history and creates the previously missing event/history/usage tables.

## Validation

`npm test` runs the regression suite with provider and database calls mocked.
For real SQL, migration, row locking and concurrent checkout tests, point `CHECKOUT_DATABASE_URL`
at a disposable PostgreSQL database and run `node --test test/checkout-database.test.js`.
This test creates a uniquely named schema, applies the checkout migration against fixtures,
and removes that schema after testing. It never falls back to the application database URL.

Provider behavior references: [Paystack verification](https://paystack.com/docs/payments/verify-payments/),
[Paystack webhooks](https://paystack.com/docs/payments/webhooks/), and
[Stripe idempotency](https://docs.stripe.com/api/idempotent_requests).
