# Automated vendor payouts

Automated transfers use Paystack and the append-only `vendor_ledger_entries` ledger. Money is stored as integer minor units. The existing `vendor_payouts` and decimal `ledger_entries` tables remain for backward compatibility; new automated payouts use `payout_batches` and `payouts`.

## Eligibility and accounting

A payout requires an active, verified vendor, a Paystack recipient, a delivered fulfillment whose seven-day confirmation hold has been released, and a positive balance above the vendor's minimum. Active return reserves and chargeback holds reduce the balance. Vendors choose `manual` or `automatic` payout mode. Automatic mode supports weekly, bi-weekly, or monthly cadence; manual mode pays only when the vendor requests a payout.

At payment settlement, the ledger records gross sale credit, commission debit, and an equal delivery hold. Delivery confirmation releases the hold. At payout time, the configured vendor tax and transfer fee are deducted from the eligible balance. Return requests reserve vendor funds; settled refunds reclassify the reserve as a refund debit. Disputes create vendor chargeback holds; a dispute resolved in the merchant's favor releases the hold.

The vendor's `tax_rate_bps` is configured by an authorized admin. The rate applies to the eligible vendor balance before transfer and defaults to zero. Transfer charges are debited from vendor earnings using `PAYSTACK_TRANSFER_FEE_SCHEDULE`; configure the current Paystack fee bands per currency in minor units. The payout worker refuses to create a batch for a currency with no configured fee schedule.

Example shape (replace values with the current Paystack tariff):

```json
{"NGN":{"tiers":[{"max_minor":500000,"fee_minor":1000},{"max_minor":5000000,"fee_minor":2500},{"fee_minor":5000}],"stamp_duty":{"threshold_minor":1000000,"fee_minor":5000}}}
```

## Vendor endpoints

- `POST /v1/api/vendor/payouts/recipient` sends bank details to Paystack and stores only the provider recipient code. The response masks the account number.
- `PATCH /v1/api/vendor/payouts/preferences` accepts `payout_mode` (`manual` or `automatic`), `payout_cadence` (`weekly`, `bi_weekly`, or `monthly`), and/or `minimum_payout_minor`. Automatic schedules use Africa/Lagos time: weekly runs on Monday, bi-weekly runs every 14 days from the first upcoming Monday after the schedule is set, and monthly runs on the first day of the next month. Changing mode or cadence resets the next due date; manual mode clears it.
- `GET /v1/api/vendor/payouts`, `GET /v1/api/vendor/payouts/:payoutId`, and `GET /v1/api/vendor/payouts/summary` show only the authenticated vendor's payout records.
- `POST /v1/api/vendor/payouts/request` requests an on-demand batch in manual mode. Automatic-mode vendors receive a conflict response if they try to request a manual payout.

## Admin endpoints

- `GET /v1/api/admin/payouts` lists payout records under the existing transaction read permission.
- `PATCH /v1/api/admin/vendors/:vendorId/payout-tax-rate` sets `tax_rate_bps` from 0 through 10000 and requires recent authentication plus transaction update permission.

## Operations

The payout worker checks due automatic vendors every five minutes and initiates Paystack transfers. `next_payout_at` is persisted and advanced transactionally with batch creation, so repeated worker runs do not duplicate a scheduled batch. The existing signature-verified webhook queue handles `transfer.success`, `transfer.failed`, `transfer.reversed`, and dispute events. Ambiguous API timeouts keep funds reserved for reconciliation rather than automatically retrying a transfer.

Apply the new migration before starting the updated application. This repository currently has a previously failed migration recorded in the database (`20261112120000_product_returns_refunds`, Prisma P3009); resolve that migration state before deploying any later migrations. The application does not run migrations automatically.
