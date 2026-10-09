import { majorUnits, minorUnits } from '#utils/checkout.js';

export function commissionAmount(baseMinor, rate) {
    const basisPoints = Math.round(Number(rate) * 100);
    if (
        !Number.isSafeInteger(baseMinor) ||
        baseMinor < 0 ||
        !Number.isSafeInteger(basisPoints) ||
        basisPoints < 0 ||
        basisPoints > 10000
    )
        throw new Error('Invalid commission calculation input');
    return Math.round((baseMinor * basisPoints) / 10000);
}

export function vendorSaleAllocations(items, coupon, discount, rate) {
    const getRate =
        typeof rate === 'function'
            ? rate
            : rate instanceof Map
              ? (vendorId) => rate.get(vendorId)
              : typeof rate === 'object' && rate !== null
                ? (vendorId) => rate[vendorId]
                : () => rate;
    const allocations = new Map();
    for (const item of items) {
        const current = allocations.get(item.vendor_id) ?? 0;
        allocations.set(item.vendor_id, current + item.subtotal_minor);
    }
    return [...allocations.entries()].map(([vendorId, grossMinor]) => {
        const vendorDiscount =
            coupon?.vendor_id === vendorId ? minorUnits(discount) : 0;
        const netBasisMinor = grossMinor - vendorDiscount;
        const commissionRate = getRate(vendorId);
        const feeMinor = commissionAmount(netBasisMinor, commissionRate);
        return {
            vendorId,
            grossAmount: majorUnits(grossMinor),
            commissionRate: Number(commissionRate).toFixed(2),
            commissionAmount: majorUnits(feeMinor),
            netAmount: majorUnits(netBasisMinor - feeMinor),
        };
    });
}
