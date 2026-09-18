// These SQL expressions require the products table to be aliased as p.
// float8 returns a JavaScript number and accommodates totals above int4.
export const productStockSql = `(CASE WHEN p.has_variants THEN
    (SELECT COALESCE(SUM(sv.stock), 0)::double precision FROM product_variants sv
     WHERE sv.product_id = p.id AND sv.status = 'active')
    ELSE p.stock END)`;

export const productAvailableSql = `(CASE WHEN p.has_variants THEN
    EXISTS (SELECT 1 FROM product_variants sv WHERE sv.product_id = p.id
        AND sv.status = 'active' AND (NOT p.track_inventory OR sv.stock > 0))
    ELSE (NOT p.track_inventory OR p.stock > 0) END)`;
