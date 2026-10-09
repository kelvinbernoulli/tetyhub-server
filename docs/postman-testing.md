# Postman API testing

The Postman collection and local environment are in [`postman/`](../postman/):

- `TetyHub.postman_collection.json` — import into Postman as a collection.
- `TetyHub.local.postman_environment.json` — import and select as the active environment.

The collection is based on the registered Express routes in the auth, storefront, vendor, and admin routers, plus the health and payment webhook routes. Requests are grouped by feature (for example, all product operations are in **Products**) and named for their action rather than their URL. Each request description identifies its intended audience — **Admin**, **Vendor**, **Customer**, **Web (everyone)**, or **Payment provider** — and documents path/query parameters and body field types and requiredness where applicable. Where validation is controller-specific, the description points to the schema source; check that schema before replacing a placeholder.

## Start-up requirements

1. Configure the server's required environment variables using your local `.env`; do not put production credentials in the Postman collection or environment.
2. Apply the project's pending Prisma migrations to the intended test database and generate the Prisma client as required by the project setup. Do not use a production database for API tests.
3. Seed or create the records required by the tests: categories, currencies, products, services, provider permissions, and any payment configuration. Use accounts with the specific customer, vendor, and admin roles needed for each folder. Admin routes can also require resource permissions and recent authentication.
4. Start the API and set the environment's `baseUrl` to its origin only, without `/v1/api` or a trailing slash (default: `http://localhost:5000`).

Routes that call Paystack, Stripe, email, uploads, or other external services require their test/local configuration. Avoid real payments while testing. A valid test gateway configuration is required for checkout initialization; do not invoke billing or refund operations against live keys.

## Session and CSRF authentication

Authentication uses a session cookie, not a bearer token. Postman stores the cookie received at sign-in in its cookie jar for the configured host.

1. Set `loginEmail` and `testPassword` for the account under test.
2. Run **Auth → POST /v1/api/auth/signin**. The collection test script saves a returned CSRF token when present.
3. If a CSRF token was not returned, run **Auth → GET /v1/api/auth/csrf-token**. Its response script also updates the collection variable.
4. Authenticated mutation requests send `X-CSRF-Token: {{csrfToken}}`. The cookie and token are scoped to the account/session; sign out and sign in again when switching roles, and refresh the token if the server rotates it.

The auth collection also includes customer/vendor signup, password reset, verification, session, and admin invitation routes. Signup requires a valid password with at least eight characters and uppercase, lowercase, number, and special character. Verification or invitation routes may depend on email delivery or an invitation created by an administrator. Use the actual response shape returned by each endpoint; not every legacy route uses the same envelope.

## Suggested test sequence

### Customer and catalog

1. Browse public products and services; select an active record from the test database.
2. Sign in as a customer. If signup is used, finish any required email verification.
3. Add an existing product to the cart, then submit checkout with the current cart total and a valid shipping/contact address. Amounts in API requests are in major currency units (for NGN, naira with up to two decimal places); the server converts to minor units for payment providers.
4. For services, first inspect availability, then submit **Customer & Public → POST /v1/api/service/book** with an existing `service_id`, a valid future offset-aware `scheduled_for`, `gateway: "paystack"`, `expected_currency: "NGN"`, the currently expected total, and a UUIDv4 `idempotency_key`. The collection uses Postman's `{{$guid}}` for the idempotency key. Select a time returned as available; the example `bookingDate` is only a placeholder and must be changed if it is not in the future or available.
5. Create support tickets as a customer and use the separate Admin support-ticket reply requests to test staff responses. Admin accounts must have support permissions and valid staff context.

### Vendor

Sign in using an account that has vendor access and the required permissions. The vendor folder includes service and product creation/updates, service packages, bookings, order fulfillment, returns, and subscription management. Set the IDs in the environment to records owned by the signed-in vendor.

Service and product image fields accept validated base64 data URLs, not arbitrary URLs. Before using the create examples, set `validPngBase64` to the base64 payload of a valid PNG **without** a `data:image/png;base64,` prefix; the collection adds that prefix. Service images are limited to 2 MiB each; support-ticket attachments have their own accepted formats and size rules.

Subscription requests use:

- `POST /v1/api/vendor/subscriptions/trial` for the one-time trial.
- `POST /v1/api/vendor/subscriptions/checkout` with `{"plan":"PRO","renewalMode":"manual"}` or `"automatic"`.
- `POST /v1/api/vendor/subscriptions/downgrade` with a plan (`FREE`, `PRO`, or `BUSINESS`).
- `POST /v1/api/vendor/subscriptions/cancel` to request cancellation.

Checkout initializes a Paystack transaction. It does not activate a paid plan on the basis of the browser redirect; the verified server-side payment/webhook flow determines activation. Use Paystack test credentials and a test account.

### Admin

Admin endpoints require an admin/staff session and may require explicit per-resource permissions, recent authentication, or both. Use the seeded test administrator or an invitation flow configured for the test environment. Never put admin credentials in a shared Postman export.

The admin folder covers support, commission settings, subscription plans, returns, users, and the other registered admin routes. Where a route accepts an ID, provide an existing test record; an empty example body (`{}`) is intentionally a placeholder, not a valid request for every endpoint.

### Payment webhooks

The Paystack and Stripe webhook requests are server-to-server endpoints. The collection includes raw JSON bodies and signature headers, but empty payloads or placeholder signatures are expected to fail verification. Exercise webhooks through the provider's test webhook tooling or a local test harness that signs the exact raw request body with the configured test secret. Never paste a live secret into Postman, commit it, or send live customer/payment data to a test endpoint.

## Environment variables

Set the values required for your local data and account:

| Variable | Purpose |
| --- | --- |
| `baseUrl` | Server origin, e.g. `http://localhost:5000` |
| `customerEmail`, `vendorEmail`, `adminEmail` | Account emails for signup and role-specific tests |
| `loginEmail`, `testPassword` | Credentials used by the sign-in example |
| `productId`, `serviceId`, `serviceCategoryId`, `productCategoryId`, `currencyId` | Existing catalog IDs |
| `bookingId`, `orderId`, `orderItemId`, `vendorId`, `packageId`, `shipmentId`, `paymentId`, `returnId`, `ticketId`, `reviewId` | Existing records for parameterized routes |
| `bookingDate` | Future, offset-aware service booking/reschedule timestamp that is available for the selected service |
| `couponCode` | Existing valid test coupon, if coupon validation is being tested |
| `validPngBase64` | Valid PNG bytes encoded as base64, without a data-URL prefix |
| `csrfToken` | Maintained by the collection script after sign-in or fetching a CSRF token |
| `paystackSignature`, `stripeSignature` | For provider-generated test signatures only; do not use live secrets |

IDs in the imported environment are example placeholders, not guaranteed to exist. Replace them with IDs from your test database. The example account email values are also placeholders; they do not create accounts automatically.

The environment also contains generic placeholders for route-specific IDs and references (for example `id`, `sessionId`, `notificationId`, `addressId`, `categoryId`, `subcategoryId`, `couponId`, `faqId`, `order_id`, and `reference`). Set the variable corresponding to the request you are testing; placeholder values such as `1` and `TEST_REFERENCE` are not inferred from previous responses.

## Reading failures

- `401` or `403`: confirm the session cookie, selected account role, route permissions, and current `csrfToken`.
- `400` or `422`: compare the request body and query parameters with that endpoint's Joi schema; many collection bodies intentionally start as `{}`.
- `404`: verify the route path and that the referenced resource exists and belongs to the authenticated account.
- Payment/webhook errors: confirm test-mode credentials, configured webhook secret, exact raw body, and provider-side event status.
- Database relation/table errors: verify the pending Prisma migrations have been applied to the same database used by the running server.

Successful responses commonly include `success`, `message`, `result`, and `code`; older endpoints may differ. Use the collection response and server logs to inspect the exact behavior rather than assuming all routes have identical response shapes.
