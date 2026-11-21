ALTER TABLE returns
  ADD COLUMN vendor_reserve_amount DECIMAL(10,2) NOT NULL DEFAULT 0
  CHECK (vendor_reserve_amount >= 0);

WITH return_gross AS (
  SELECT r.id, r.order_id, r.vendor_id, r.created_at,
         SUM(oi.subtotal::numeric * ri.quantity / NULLIF(oi.quantity, 0)) AS amount
  FROM returns r
  JOIN return_items ri ON ri.return_id = r.id
  JOIN order_items oi ON oi.id = ri.order_item_id
  WHERE r.vendor_id IS NOT NULL
    AND r.status NOT IN ('rejected', 'cancelled')
  GROUP BY r.id, r.order_id, r.vendor_id, r.created_at
), return_shares AS (
  SELECT rg.id, rg.order_id, rg.vendor_id, rg.created_at, vof.id AS fulfillment_id,
         vof.net_amount,
         ROUND(rg.amount * vof.net_amount / NULLIF(vof.gross_amount, 0), 2) AS reserve_amount
  FROM return_gross rg
  JOIN vendor_order_fulfillments vof
    ON vof.order_id = rg.order_id AND vof.vendor_id = rg.vendor_id
), allocated_reserves AS (
  SELECT rs.*,
         COALESCE(SUM(reserve_amount) OVER (
           PARTITION BY order_id, vendor_id
           ORDER BY created_at, id
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS prior_reserves
  FROM return_shares rs
)
UPDATE returns r
SET vendor_reserve_amount = LEAST(
  ar.reserve_amount,
  GREATEST(ar.net_amount - ar.prior_reserves, 0)
)
FROM allocated_reserves ar
WHERE r.id = ar.id;

INSERT INTO ledger_entries
  (vendor_id, order_id, fulfillment_id, currency_id, entry_type, amount,
   idempotency_key, metadata)
SELECT r.vendor_id, r.order_id, vof.id, o.currency_id, 'vendor_return_reserve',
       -r.vendor_reserve_amount, 'return:' || r.id::text || ':vendor-reserve',
       jsonb_build_object('return_id', r.id, 'source', 'return_reserve_backfill')
FROM returns r
JOIN vendor_order_fulfillments vof
  ON vof.order_id = r.order_id AND vof.vendor_id = r.vendor_id
JOIN orders o ON o.id = r.order_id
WHERE r.vendor_reserve_amount > 0
ON CONFLICT (idempotency_key) DO NOTHING;

WITH reserves AS (
  SELECT r.order_id, r.vendor_id, SUM(r.vendor_reserve_amount) AS amount
  FROM returns r
  WHERE r.status NOT IN ('rejected', 'cancelled')
  GROUP BY r.order_id, r.vendor_id
), pending_payouts AS (
  SELECT p.id, p.amount, r.amount AS reserve_amount,
         COALESCE(SUM(p.amount) OVER (
           PARTITION BY p.fulfillment_id
           ORDER BY p.created_at DESC, p.id DESC
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
         ), 0) AS prior_amount
  FROM vendor_payouts p
  JOIN vendor_order_fulfillments vof ON vof.id = p.fulfillment_id
  JOIN reserves r ON r.order_id = vof.order_id AND r.vendor_id = vof.vendor_id
  WHERE p.status = 'pending'
), adjusted AS (
  UPDATE vendor_payouts p
  SET amount = GREATEST(
        p.amount - GREATEST(pending_payouts.reserve_amount - pending_payouts.prior_amount, 0),
        0
      ),
      status = CASE
        WHEN p.amount <= GREATEST(pending_payouts.reserve_amount - pending_payouts.prior_amount, 0)
        THEN 'cancelled' ELSE p.status
      END
  FROM pending_payouts
  WHERE p.id = pending_payouts.id
  RETURNING p.id
)
SELECT COUNT(*) FROM adjusted;

INSERT INTO ledger_entries
  (vendor_id, order_id, fulfillment_id, currency_id, entry_type, amount,
   idempotency_key, metadata)
SELECT vendor_id, order_id, fulfillment_id, currency_id, 'vendor_payout_debit',
       -amount, 'payout:' || id::text || ':vendor-debit',
       jsonb_build_object('payout_id', id, 'source', 'return_reserve_backfill')
FROM vendor_payouts
WHERE status = 'paid' AND fulfillment_id IS NOT NULL AND amount > 0
ON CONFLICT (idempotency_key) DO NOTHING;
