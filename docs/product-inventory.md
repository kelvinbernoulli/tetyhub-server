# Product inventory

Simple products accept product `stock`, required on creation. For products with variants, response `stock` is calculated from active variant quantities. Archived variants are excluded. Lists, stock sorting, wishlists and vendor stock reports use these quantities.

Product and variant responses include `in_stock`. Frontends should disable variants with `in_stock: false`. With inventory tracking disabled, active variants remain purchasable at zero stock. A product with no active variants is unavailable even with tracking disabled.

On variant creation or replacement, omit top-level `stock`. For compatibility, top-level stock supplied alongside variants is ignored. A stock edit without variants on an existing variant product is rejected with 422. When switching to a simple product, explicitly supply its stock; otherwise it starts at zero so old product quantities cannot accidentally become sellable.

Checkout reserves only the selected SKU. Calculated totals immediately reflect reservations and releases, without a second product deduction. Cart additions and quantity updates require a variant for variant products.

Existing database `products.stock` values for variant products are retained as legacy data, not used as sellable inventory. Use [the read-only audit report](../scripts/audit-product-stock.sql) for vendor review. Differences are not automatically allocated to variants. No database migration is required.
