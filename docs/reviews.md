# Reviews and ratings

Customers can review purchased products and booked services. A product requires a paid, delivered order containing that product. A service requires a paid, completed booking for that service. Eligibility and purchase identifiers are derived server-side; callers cannot claim another purchase or set their own verification status.

There is one review per customer per product/service, enforced by PostgreSQL unique indexes even for concurrent requests. Customers edit their existing review rather than submitting another for the same listing. Product and service IDs can overlap without sharing reviews.

## Public and customer API

Base path: `/v1/api`.

| Method | Path | Access |
| --- | --- | --- |
| GET | `/products/:productId/reviews` | Public approved product reviews |
| GET | `/services/:serviceId/reviews` | Public approved service reviews |
| POST | `/products/:productId/reviews` | Customer with eligible purchase |
| POST | `/services/:serviceId/reviews` | Customer with eligible booking |
| GET | `/reviews/mine` | Customer's own reviews, including pending/rejected |
| GET | `/reviews/:reviewId` | Customer's own review |
| PATCH | `/reviews/:reviewId` | Customer's own review |
| DELETE | `/reviews/:reviewId` | Customer's own review |

Authenticated routes use the existing session cookie. Mutations require `X-CSRF-Token`. Vendor and administrator accounts cannot submit customer reviews through these routes.

Create example:

```json
{
    "rating": 5,
    "title": "Great service",
    "comment": "Everything was completed on time."
}
```

`rating` is required and must be an integer from 1 to 5. The original `rate` field is accepted as an alias; sending both names is rejected. Titles are optional, trimmed, 2–150 characters. Comments are optional, trimmed, 2–500 characters. Title/comment can be null. An update requires at least one of these fields. Unknown/protected fields are rejected.

New reviews have `status: pending` and `verified_purchase: true`. Editing changed content returns the review to pending, clears its previous moderation note, advances its revision and removes it from public rating totals until approved again. An unchanged update does not reset approval. Edits recheck purchase eligibility; deletion remains available to the author even when a listing is unavailable or a purchase is no longer eligible.

## Public results

Public lists accept `offset` (default 0), `limit` (default 20, maximum 100) and optional integer `rating` (1–5). Only active, nondeleted listings belonging to active vendors can be read publicly.

The standard response envelope's `result` contains:

```json
{
    "rows": [],
    "total": 0,
    "offset": 0,
    "limit": 20,
    "summary": {
        "review_count": 0,
        "average_rating": null,
        "ratings": { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 }
    }
}
```

`total` reflects the optional rating filter. `summary` always describes all approved reviews for the listing. Public rows contain review content, the reviewer's first name, verification flag and timestamps; they omit purchase IDs, user IDs and moderation notes. Render user-provided content as text, not HTML.

Product averages already use approved reviews. Service list/detail responses now also provide `avg_rating` and `review_count` using approved reviews. Totals are computed from review rows, so approvals, rejections, edits and deletions take effect without cache maintenance.

## Platform moderation

Base path: `/v1/api/admin`.

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/reviews` | `reviews.can_read` |
| GET | `/reviews/:reviewId` | `reviews.can_read` |
| PATCH | `/reviews/:reviewId/status` | `reviews.can_read` and `reviews.can_update` |
| DELETE | `/reviews/:reviewId` | `reviews.can_read` and `reviews.can_delete` |

These routes retain platform administrator authentication and CSRF protection. Vendors cannot moderate reviews. The migration registers a platform-scoped `reviews` permission; regular staff need explicit grants through existing admin permission management. Super administrators retain their existing bypass.

The moderation and own-review lists accept pagination, `rating`, `status`, and either `product_id` or `service_id`. Responses contain `rows`, `total`, `limit` and `offset`.

Moderation example:

```json
{
    "status": "approved",
    "revision": 1,
    "moderation_note": null
}
```

Statuses are `pending`, `approved`, and `rejected`. Supply the revision returned by the latest review read. A stale revision returns 409, requiring a refresh before moderation. This prevents approving content changed by the author or another moderator. Approval rechecks purchase eligibility. Moderators cannot moderate their own reviews. A moderation note is visible to the review's author, but never included in public lists.

Notification writes are transactional: submissions/edits notify platform staff with review read access; status changes/removal notify the author; approval also notifies the listing vendor and staff with product/service read permissions. Notifications contain resource references, not review text or moderation notes.

## Database and verification

Apply `prisma/migrations/20260924170000_reviews_and_ratings/migration.sql` using the existing Prisma deployment workflow before enabling these routes. It adds booking provenance, revision and moderation-note fields, uniqueness/indexes, target/rating/status constraints and the moderation permission resource.

The migration stops if legacy reviews have invalid targets/ratings/statuses or duplicates. It does not silently delete or rewrite those reviews. Review and reconcile conflicting legacy records before retrying.

Run unit/controller/model checks:

```powershell
node --test test/reviews.test.js
```

For PostgreSQL integration testing, set `REVIEW_DATABASE_URL` to a separate test database whose account can create schemas, then run:

```powershell
node --test test/reviews-database.test.js
```

The database test creates and removes an isolated schema and checks migration preflight, concurrent duplicate submissions, eligibility, moderation, ownership, notifications, rating summaries and database constraints. It is skipped when no test database is configured.
