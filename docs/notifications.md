# Notifications

The API provides an in-app inbox for customers, vendors, vendor staff and platform administrators. It uses the existing PostgreSQL notification table and session authentication. Email verification, password-reset and invitation emails continue through their existing delivery paths; this change does not add push, SMS or a general email delivery queue.

## Inbox API

The paths below are available under `/v1/api`, `/v1/api/vendor`, and `/v1/api/admin`. Dashboard prefixes retain their role checks. Each inbox only exposes notifications whose `user_id` matches the authenticated user; there is no public notification creation or broadcast endpoint.

| Method | Path | Result |
| --- | --- | --- |
| GET | `/notifications` | Array of notifications, newest ID first |
| GET | `/notifications/unread-count` | `{ "count": 3 }` |
| GET | `/notifications/:notificationId` | One owned notification |
| PATCH | `/notifications/:notificationId/read` | Mark one notification read; safe to repeat |
| PATCH | `/notifications/mark-all-read` | Mark unread notifications read; returns affected count |
| DELETE | `/notifications/:notificationId` | Delete one owned notification |

Mutations require the existing session `X-CSRF-Token`. Invalid IDs and filters return 400; another user's notification is reported as 404.

List filters:

- `limit`: 1�100, default 20.
- `offset`: nonnegative integer, default 0.
- `unread_only`: `true` or `false`.
- `type`: notification type, such as `support` or `booking`.
- `before`: return IDs older than this notification; use the last displayed ID to load older pages without new notifications shifting page boundaries.

`mark-all-read` optionally accepts `{ "through_id": 123 }`. Pass the newest ID displayed in the inbox so notifications arriving afterward remain unread. Without it, all currently unread notifications are marked read.

Responses retain the existing `{ success, message, result, code }` envelope. The list remains an array for compatibility, and `metadata` remains a JSON string (or null). Parse metadata to obtain resource IDs, then fetch the resource through its authorized API. Render message/title values as text.

## Event coverage

| Event | Recipients |
| --- | --- |
| Checkout created awaiting payment | Buyer |
| Free checkout or confirmed payment | Buyer and vendor owners/staff with order read access |
| Order status change | Buyer |
| Order cancelled or unpaid reservation expired | Buyer and related vendor owners/staff |
| Late order payment needing review | Buyer, related vendors, platform payment staff |
| Booking created awaiting payment | Customer |
| Booking confirmed, active, completed or cancelled | Customer and vendor owners/staff with service read access |
| Unpaid booking expired | Customer |
| Late booking payment needing review | Customer, related vendor staff, platform payment staff |
| Verified terminal payment failure | Paying user, with repeated failure states suppressed |
| Shipment created, public details/status changed, tracking event added | Buyer |
| Return submitted | Customer and vendor owners/staff for the returned items |
| Vendor return status change | Customer |
| Platform return status change | Customer and related vendor owners/staff |
| Checkout crosses a product/SKU low-stock threshold | Vendor owner and staff with product read access |
| Account created or email verified | Account owner |
| Password reset completed | Account owner |
| Administrator invited, activated, suspended/reactivated or revoked | Affected administrator |
| Administrator permissions changed | Affected administrator |
| Support ticket, public reply, assignment or status change | Existing support recipients; internal notes remain private |

Recipients are resolved from database ownership and active, unexpired permission grants. Vendor IDs are never treated as user IDs. Vendor messages contain resource IDs/statuses, not entire multi-vendor orders, contact information, payment payloads, private notes or attachments.

Notifications are inserted with the same client and transaction as their business event. Failed transactions leave no notification behind. Payment settlement and reservation expiry retain their existing row locks and retry guards. Reading the inbox never marks notifications read implicitly.

## Migration and verification

Deploy the new `20260924150000_notification_indexes` migration before using the updated return workflow. It adds inbox indexes and the return notes/evidence/timestamp/item-condition fields already accepted by the existing return API. The previously added support migration is also required for support.

The affected whole-order mutation paths now resolve vendor ownership from order items. A vendor can only change a whole order/shipment when every item belongs to that vendor. Per-vendor fulfillment of mixed-vendor orders requires a separate fulfillment design. A return request must contain items from one vendor.

Run:

```powershell
node --test test/notifications.test.js test/support.test.js
```

For PostgreSQL integration checks, set `NOTIFICATION_DATABASE_URL` to a disposable PostgreSQL database with schema creation permission, then run:

```powershell
node --test test/notifications-database.test.js
```

The integration test creates its own schema, verifies migration/query/recipient/workflow behavior, and drops that schema afterward. Existing checkout and booking database tests retain their `CHECKOUT_DATABASE_URL` and `BOOKING_DATABASE_URL` settings.

Automated refunds are disabled by the existing payment model, so an attempted refund does not generate a success notification. Review submission and edits now notify platform review staff; moderation notifies the author, and approval also notifies the listing vendor and eligible staff. See reviews.md for the review workflow. Vendor-verification mutation workflows are not implemented yet.
