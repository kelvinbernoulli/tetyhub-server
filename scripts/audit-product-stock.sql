-- Read-only report. Review physical inventory before changing variant quantities.
SELECT p.id, p.vendor_id, p.name, p.stock AS legacy_product_stock,
       COALESCE(SUM(pv.stock) FILTER (WHERE pv.status = 'active'), 0) AS active_variant_stock,
       p.stock - COALESCE(SUM(pv.stock) FILTER (WHERE pv.status = 'active'), 0) AS difference
FROM products p
LEFT JOIN product_variants pv ON pv.product_id = p.id
WHERE p.has_variants AND p.deleted_at IS NULL
GROUP BY p.id
HAVING p.stock <> COALESCE(SUM(pv.stock) FILTER (WHERE pv.status = 'active'), 0)
ORDER BY p.vendor_id, p.id;
