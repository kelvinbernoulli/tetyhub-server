# Service API

Service management routes are under the configured API version's `/api/vendor` prefix. Every operation uses `req.auth.vendorId` and the existing service permissions/CSRF middleware.

- `POST /service/create`
- `GET /services`
- `GET /service/view/:id`
- `PATCH /service/update/:id`
- `DELETE /service/delete/:id`

List responses now contain `result.data` and `result.pagination` (total, limit, offset, total_pages, has_more). Limit defaults to 20 and is bounded to 50. Supported filters: search, category_id, subcategory_id, childcategory_id, status, min_price, max_price, is_remote, location_type, sort_by, sort_order, offset, limit. A client-supplied vendor_id is rejected. Deleted services are excluded from all management reads.

Create requires name, description, category_id, base_price, currency_id and thumbnail. Categories must be active and support services; subcategory and child category relationships must match. Slugs are generated and remain stable after renaming. Legacy services can retain null categories until assigned; the migration does not invent a category for existing rows.

All supported create fields can be edited. Updates only change supplied values, validate comparison prices against the current locked row, and enforce ownership in SQL. Prices must be JSON numbers with at most two decimal places. Compare-at price must be strictly higher than base price; null clears it. Null also clears optional descriptions, subcategory/childcategory IDs, thumbnail, and SEO fields. Empty image/tag arrays clear those lists.

`location_type` is authoritative: remote, vendor_location, or customer_location. Setting it derives is_remote. For compatibility, setting is_remote alone sets remote when true; false preserves customer_location when already selected, otherwise selects vendor_location. Conflicting explicit values are rejected. Unrelated updates leave location unchanged.

Media uploads use JSON base64 data URLs (PNG, JPEG or WebP, at most 2 MiB each). Creation requires `thumbnail`; `images` accepts up to five images. Both create and update upload supplied media to S3 and store/return the resulting URLs. Omit media fields on update to preserve them; `thumbnail: null` and `images: []` clear their references. A supplied gallery replaces the entire gallery. Failed uploads or database saves trigger cleanup of newly uploaded objects. Previously stored objects are retained. The default JSON body limit is 20 MiB to accommodate six maximum-size base64 images; an explicit REQUEST_SIZE_LIMIT setting overrides it. Booking capacity, buffer and cancellation fields are stored configuration; these CRUD endpoints do not implement scheduling or cancellation execution. Deletion is soft and preserves booking/order references and media URLs.

Run `node --test` for local tests. Enable `SERVICE_DATABASE_TESTS=1` and run `node --test test/services-database.test.js` for PostgreSQL integration testing. It requires an existing vendor/currency and the applied migration. All fixture changes roll back; sequence counters can advance.

## Customer browsing

These public web endpoints require no login:

- `GET /v1/api/services` lists services across vendors. Read `result.data` and `result.pagination` from the response.
- `GET /v1/api/service/view/:id` returns one service in `result`, or 404 when unavailable.

Only active, non-deleted services from active vendors with enabled currencies are visible. Responses include thumbnail/gallery URLs, vendor/category names and the currency code. Public requests cannot select paused/deleted services or supply vendor_id. Vendor management endpoints retain their vendor ownership checks.

Example: `GET /v1/api/services?search=design&category_id=2&limit=20&offset=0`. The list supports category_id, subcategory_id, childcategory_id, min_price, max_price, is_remote, location_type, sort_by and sort_order as well. Limit defaults to 20 (maximum 50). Booking creation still requires customer authentication.
Service list and detail responses (public and vendor) join categories, subcategories, childcategories and currencies. Each service includes `category_name`, `subcategory_name`, `childcategory_name`, `currency_code` and `currency_name`, alongside the existing IDs. `currency` remains an alias for the currency code. Missing optional categories return null names without excluding the service.
