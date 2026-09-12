export class CheckoutError extends Error {
    constructor(message, code = 422) {
        super(message);
        this.code = code;
    }
}

// This checkout supports two-decimal currencies only. Never convert via floats.
export function minorUnits(value) {
    const text = String(value);
    if (!/^\d+(\.\d{1,2})?$/.test(text))
        throw new CheckoutError('Invalid money amount');
    const [whole, fraction = ''] = text.split('.');
    const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(amount) || amount > 9999999999)
        throw new CheckoutError('Amount exceeds supported range');
    return amount;
}
export const majorUnits = (amount) => (amount / 100).toFixed(2);

export function shippingMinor(
    items,
    currency,
    country,
    rates = process.env.CHECKOUT_SHIPPING_RATES
) {
    if (items.every((item) => item.free_shipping)) return 0;
    let configured;
    try {
        configured = JSON.parse(rates || '{}');
    } catch {
        throw new CheckoutError('Shipping configuration is invalid', 503);
    }
    if (
        !configured ||
        typeof configured !== 'object' ||
        Array.isArray(configured)
    )
        throw new CheckoutError('Shipping configuration is invalid', 503);
    const rate =
        Object.hasOwn(configured, currency) &&
        Object.hasOwn(configured[currency] || {}, country)
            ? configured[currency][country]
            : undefined;
    if (rate === undefined)
        throw new CheckoutError(
            'Shipping is unavailable for this destination and currency',
            422
        );
    // One configured fee per vendor requiring delivery.
    return (
        minorUnits(rate) *
        new Set(
            items
                .filter((item) => !item.free_shipping)
                .map((item) => item.vendor_id)
        ).size
    );
}

export function assertGatewayCurrency(gateway, currency) {
    // Explicit launch currencies prevent accidentally interpreting yen as cents.
    const supported =
        gateway === 'paystack'
            ? ['NGN']
            : gateway === 'stripe'
              ? ['USD', 'EUR', 'GBP']
              : [];
    if (!supported.includes(currency))
        throw new CheckoutError(
            'Payment gateway does not support this order currency'
        );
}

export async function transaction(pool, work) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}
