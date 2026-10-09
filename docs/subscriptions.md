# Provider plans and subscriptions

Plan definitions are versioned in `plan_versions`. The values in
`src/config/plans.js` are the initial catalog and the fallback definitions for
FREE providers; the migration seeds the same values in the database. Provider
entitlements should use the plan-version snapshot attached to their
subscription, not a newer catalog version. This lets administrators publish
new versions without changing an existing paid period.

Plan prices are represented in naira as decimal strings. The Paystack checkout
flow must convert naira to integer kobo immediately before making the Paystack
request; plan prices and admin-facing plan values remain in naira.
`activeServices: null` means there is no service count limit; all other numeric
limits are non-negative integers. Providers without a subscription row are
entitled to FREE.

Service creation and reactivation are checked against the provider's current
active-service limit. Gallery images in `services.images` count toward the
provider-wide portfolio image limit; service thumbnails do not. Providers can
create, list, update, and soft-delete service packages through
`/services/:serviceId/packages`; every non-deleted package counts toward that
service's package limit, and soft deletion releases the slot. Limit violations
return HTTP 403 with `code: "PLAN_LIMIT_REACHED"` and include the limit,
current count, requested count, and next qualifying plan.

`getEffectivePlan` grants TRIALING and ACTIVE access through the current period,
PAST_DUE access through the grace end, and CANCELLED access through the paid
period end. It returns FREE after the applicable entitlement period expires.

## Provider subscription API

Provider subscription routes are under `/v1/api/vendor/subscriptions`:

- `GET /me` returns the subscription and current effective plan.
- `POST /trial` starts the one-time 14-day PRO trial.
- `POST /checkout` accepts `{ "plan": "PRO" | "BUSINESS", "renewalMode": "automatic" | "manual" }`
  and returns the Paystack authorization URL. Automatic recurring checkout is
  restricted to card payments. Use manual mode for bank transfer, USSD, or other
  payment methods that cannot create an auto-renewing Paystack subscription.
- `POST /downgrade` accepts `{ "plan": "FREE" | "PRO" }` and schedules the
  lower plan for the next renewal.
- `POST /cancel` schedules cancellation for the end of the paid period.

Platform administrators can inspect versions with `GET
/v1/api/admin/subscription-plans` and publish an updated plan definition with
`PATCH /v1/api/admin/subscription-plans/:plan` (`FREE`, `PRO`, or `BUSINESS`).
Publishing is additive: it creates a new version and queues the updated
definition for current subscribers at renewal without changing their existing
plan snapshot or commission.

The hourly lifecycle job marks expired active periods as `past_due` with a
five-day grace period, moves expired trials and providers beyond that grace
period to FREE, and deactivates (never deletes) the oldest active services over
the current FREE limit. The newest services remain active by default. Providers
can choose a different active set by changing a service's status through
`PATCH /v1/api/vendor/service/update/:id`; the same FREE-plan limit is enforced
when activating a service. Three days before renewal, active subscribers receive
both an in-app notification and an email. Email delivery uses an idempotent
queue with bounded retries and an advisory database lock prevents overlapping
job runs across server instances. Configure `MAILER_HOST`, `MAILER_PORT`,
`MAILER_USER`, `MAILER_PASSWORD`, `MAIL_SECURE`, and `EMAIL_USER` for the
existing SMTP transport.

When a downgrade or plan-version change is scheduled, the existing Paystack
recurring authorization is disabled while the provider keeps the terms and
entitlements of the already-paid period. At period end, the provider enters the
normal five-day grace period and must complete checkout for the scheduled paid
plan; checkout for a different plan is rejected while that change is pending.
The scheduled plan and version become current only after Paystack verifies the
new payment. A scheduled downgrade to FREE takes effect at period end without
another charge. Renewal notifications explain when fresh checkout is required.

Plan prices remain naira decimal values in the database and are converted to
integer kobo only for Paystack API calls. Paystack plan records are created
lazily per plan version and their `plan_code` is stored on that version.
Manual renewal checkout uses a one-time Paystack transaction and extends the
period by one month after server-side transaction verification.

The Paystack webhook endpoint remains `/v1/api/webhook/paystack`. It validates
the HMAC-SHA512 signature against the original request bytes, stores only
minimal event identifiers in a durable queue, then acknowledges the delivery.
The worker verifies every successful transaction through Paystack before
applying subscription or order changes. Subscription event names handled are
`charge.success`, `invoice.create`, `invoice.payment_failed`, `invoice.update`,
`subscription.create`, `subscription.disable`, and `subscription.not_renew`,
as documented at
[Paystack subscriptions](https://paystack.com/docs/payments/subscriptions/).
Set `PAYSTACK_SECRET_KEY` in the server environment and configure that webhook
URL in the Paystack dashboard.
