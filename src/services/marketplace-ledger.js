export async function recordProductSale(client, orderId) {
    await client.query(
        `INSERT INTO ledger_entries
         (vendor_id, order_id, fulfillment_id, entry_type, amount, currency_id, idempotency_key)
         SELECT vof.vendor_id, vof.order_id, vof.id,
                'vendor_sale_credit', vof.net_amount, o.currency_id,
                'product:' || vof.order_id || ':' || vof.id || ':vendor-credit'
         FROM vendor_order_fulfillments vof
         JOIN orders o ON o.id = vof.order_id
         WHERE vof.order_id = $1
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [orderId]
    );
    await client.query(
        `INSERT INTO ledger_entries
         (vendor_id, order_id, fulfillment_id, entry_type, amount, currency_id, idempotency_key)
         SELECT NULL, vof.order_id, vof.id,
                'platform_commission', vof.commission_amount, o.currency_id,
                'product:' || vof.order_id || ':' || vof.id || ':platform-commission'
         FROM vendor_order_fulfillments vof
         JOIN orders o ON o.id = vof.order_id
         WHERE vof.order_id = $1
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [orderId]
    );
}
