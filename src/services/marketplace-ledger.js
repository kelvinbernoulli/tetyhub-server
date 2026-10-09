export async function recordProductSale(client, orderId) {
    await client.query(
        `INSERT INTO marketplace_ledger_entries
         (vendor_id, order_id, fulfillment_id, entry_type, amount, currency_id, idempotency_key)
         SELECT vendor_id, order_id, id, 'vendor_sale_credit', net_amount, o.currency_id,
                'product:' || order_id || ':' || id || ':vendor-credit'
         FROM vendor_order_fulfillments vof
         JOIN orders o ON o.id = vof.order_id
         WHERE vof.order_id = $1
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [orderId]
    );
    await client.query(
        `INSERT INTO marketplace_ledger_entries
         (vendor_id, order_id, fulfillment_id, entry_type, amount, currency_id, idempotency_key)
         SELECT NULL, order_id, id, 'platform_commission', commission_amount, o.currency_id,
                'product:' || order_id || ':' || id || ':platform-commission'
         FROM vendor_order_fulfillments vof
         JOIN orders o ON o.id = vof.order_id
         WHERE vof.order_id = $1
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [orderId]
    );
}
