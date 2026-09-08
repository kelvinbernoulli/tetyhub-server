# Product API behavior

Public routes under `/v1/api` (use your configured API version) only return active, nondeleted products. They never include product or variant cost prices. Public browsing does not require login. Optional `vendor_id` filters public lists, search, featured products, and filter metadata. Vendor routes under `/v1/api/vendor` use `req.auth.vendorId` set by authentication; callers cannot override this scope.

- `GET /products`: paginated list; default limit 20.
- `GET /products/search`: search with `q`; default limit 40.
- `GET /product/:productId`: public detail; vendor detail uses `:id`.
- `GET /products/featured`: public featured products; default limit 10.
- `GET /products/related/:productId`: active related products from the source vendor; default limit 8.
- `GET /products/filters`: public filter metadata.
- Vendor writes: `POST /product/create`, `PATCH /product/update/:id`, `DELETE /product/delete/:id`.

Lists/search accept `offset`, `limit` (1–100), category/subcategory/childcategory IDs, `brand`, price bounds, `tags`, stock/featured/digital flags and sort options. Vendor lists can filter any supported product status. Public status is always active. Product reads currently use the database directly; the old shared Redis product cache is no longer read or written.

## Product updates

Only supplied product fields change. SKU, barcode, currency and child category IDs are persisted. Comparison prices are checked against the stored price during a locked transaction. Category relationships must match, including after partial category changes. Product slugs remain stable when names change.

Images replace the gallery when supplied; `images: []` clears it. `thumbnail: null` clears the thumbnail. New image uploads are cleaned up after failed writes; replaced uploads are deleted after commit using S3 object keys. Cleanup failures are retried and logged. Product deletion is soft: rows and media are retained for historical orders.

## Variants and options

`has_variants: true` requires a nonempty variants array. `has_variants: false` rejects nonempty variants and archives the existing variants on update. Omitting both fields preserves existing variants.

A supplied variants array describes the desired active set. Include each existing variant's `id` to update it; omit `id` only when creating a new variant. Each item requires numeric `price` and integer `stock`. Omitted existing variants are archived, preserving their IDs and cart/order references. Archived variants are not returned in the active variants list. Include all variants that should remain active.

```json
{
  "has_variants": true,
  "options": [{ "name": "Size", "values": ["M", "L"] }],
  "variants": [
    { "id": 123, "sku": "SHIRT-M", "price": 2500, "stock": 10, "options": { "Size": "M" } },
    { "sku": "SHIRT-L", "price": 2500, "stock": 5, "options": { "Size": "L" } }
  ]
}
```

For creation omit all variant IDs. Top-level options add missing names/values without deleting historical option IDs. Variants can reference options by name/value mappings or `option_values` IDs belonging to the same product. Omitted mappings preserve existing links; an empty `option_values` array clears them. Attributes are a bounded array of `{ "name", "value" }` objects and replace the attribute list when supplied.

## Verification

Run `node --test` for the local suite. `test/products-database.test.js` is opt-in with `PRODUCT_DATABASE_TESTS=1`; it requires a migrated PostgreSQL database with an existing vendor and currency, creates temporary fixtures, and rolls all fixture data back. Sequence counters may advance. It performs no S3 uploads.
