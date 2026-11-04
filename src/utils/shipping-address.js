import { createHash } from 'node:crypto';

const DESTINATION_FIELDS = ['address', 'city', 'state', 'country', 'zip_code'];

export function shippingDestinationFingerprint(address) {
    const normalized = Object.fromEntries(
        DESTINATION_FIELDS.map((field) => [
            field,
            String(address[field] ?? '').trim().toLowerCase(),
        ])
    );
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function shippingCartFingerprint(items) {
    const normalized = items
        .map((item) => ({
            cart_item_id: String(item.cart_item_id),
            product_id: String(item.product_id),
            variant_id: item.variant_id == null ? null : String(item.variant_id),
            quantity: String(item.quantity),
            unit_weight: String(item.unit_weight ?? ''),
            unit_amount: String(item.unit_amount ?? ''),
            length: item.length == null ? null : String(item.length),
            width: item.width == null ? null : String(item.width),
            height: item.height == null ? null : String(item.height),
            shipbubble_category_id:
                item.shipbubble_category_id == null
                    ? null
                    : String(item.shipbubble_category_id),
            free_shipping: Boolean(item.free_shipping),
            variant_weight:
                item.variant_weight == null ? null : String(item.variant_weight),
            variant_dimensions: item.variant_dimensions ?? null,
        }))
        .sort((a, b) => Number(a.cart_item_id) - Number(b.cart_item_id));
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}
