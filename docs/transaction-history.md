# Transaction history

Existing customer, vendor, and platform-admin transaction routes are unchanged. Vendor owners and staff require the transactions read permission and use the vendor resolved by authentication. Customers can list and retrieve only their own payments. Platform-admin lists retain the existing platform-role and permission middleware.

All lists support `status`, `payment_status`, `type=order|booking`, `offset`, and `limit` (1–100). Platform admins may also filter by `vendor_id`. Malformed IDs and unsupported filters return 400. Customer detail returns 404 for both missing and other customers' payments.

Each result includes public payment fields, currency code, a transaction `type`, and the applicable order or booking context. `status` describes the payment record; `payment_status` describes the associated order or booking. Internal gateway initialization data, Stripe client secrets, provider metadata, and initialization leases are excluded.

Order ownership comes from `order_items`; booking ownership comes from `service_bookings`. A multi-vendor payment appears once per list, without duplicate rows for multiple items. The `vendors` array includes store names from `vendor_settings.store_name`; vendor views restrict this array to the authenticated vendor.

`amount` is the full payment amount, not vendor earnings or a payout. `vendor_item_subtotal` is the scoped vendor's order-item subtotal before allocation of order-level discounts, tax, or shipping. No payout allocation is inferred. Booking payments include `booking_total` and `booking_status`.

## Database rollout

Apply `20260925140000_restore_booking_payment_history` before deploying this code. It restores the `payments.booking_id` relationship and uniqueness removed by the later bookings migration, matching the existing booking-payment writer. Historical links deleted by that old migration cannot be recovered automatically; reconcile those from trusted payment records if necessary.

Validation:

- `node --test test/transaction-history.test.js`
- `node --test test/transaction-history-database.test.js` with a dedicated `TRANSACTION_DATABASE_URL` for PostgreSQL coverage. The database test uses a temporary schema and never falls back to the application database URL.
