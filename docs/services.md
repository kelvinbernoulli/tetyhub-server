# Service API

Service management routes are under the configured API version's `/api/vendor` prefix. Every operation uses `req.auth.vendorId` and the existing service permissions/CSRF middleware.

- `POST /service/create`
- `GET /services`
- `GET /service/:id`
- `PATCH /service/update/:id`
- `DELETE /service/delete/:id`

List responses now contain `result.data` and `result.pagination` (total, limit, offset, total_pages, has_more). Limit defaults to 20 and is bounded to 50. Supported filters: search, category_id, subcategory_id, childcategory_id, status, min_price, max_price, is_remote, location_type, sort_by, sort_order, offset, limit. A client-supplied vendor_id is rejected. Deleted services are excluded from all management reads.

Create requires name, description, category_id, base_price and currency_id. Categories must be active and support services; subcategory and child category relationships must match. Slugs are generated and remain stable after renaming. Legacy services can retain null categories until assigned; the migration does not invent a category for existing rows.

All supported create fields can be edited. Updates only change supplied values, validate comparison prices against the current locked row, and enforce ownership in SQL. Prices must be JSON numbers with at most two decimal places. Compare-at price must be strictly higher than base price; null clears it. Null also clears optional descriptions, subcategory/childcategory IDs, thumbnail, and SEO fields. Empty image/tag arrays clear those lists.

`location_type` is authoritative: remote, vendor_location, or customer_location. Setting it derives is_remote. For compatibility, setting is_remote alone sets remote when true; false preserves customer_location when already selected, otherwise selects vendor_location. Conflicting explicit values are rejected. Unrelated updates leave location unchanged.

Media uses HTTP(S) URLs, not base64 uploads. Booking capacity, buffer and cancellation fields are stored configuration; these CRUD endpoints do not implement scheduling or cancellation execution. Deletion is soft and preserves booking/order references and media URLs.

Run `node --test` for local tests. Enable `SERVICE_DATABASE_TESTS=1` and run `node --test test/services-database.test.js` for PostgreSQL integration testing. It requires an existing vendor/currency and the applied migration. All fixture changes roll back; sequence counters can advance.
