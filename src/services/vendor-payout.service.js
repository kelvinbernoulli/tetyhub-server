export function buildVendorPayoutsFromFulfillments(rows = []) {
    return rows
        .filter((row) => row?.payout_status === 'eligible')
        .map((row) => ({
            fulfillment_id: row.id,
            vendor_id: row.vendor_id,
            order_id: row.order_id,
            amount: Number(row.net_amount ?? 0),
            status: 'pending',
        }));
}

export function processPendingVendorPayouts(rows = []) {
    return rows
        .filter((row) => row?.status === 'pending')
        .map((row) => ({
            ...row,
            status: 'processing',
        }));
}

export function settleVendorPayouts(rows = []) {
    return rows.map((row) => {
        if (row?.status !== 'processing') return row;
        return {
            ...row,
            status: 'paid',
            paid_at: new Date(),
        };
    });
}

export function summarizePayouts(rows = []) {
    return rows.reduce(
        (summary, row) => {
            if (row.status === 'pending') summary.pending += Number(row.amount ?? 0);
            if (row.status === 'paid') summary.paid += Number(row.amount ?? 0);
            return summary;
        },
        { pending: 0, paid: 0 }
    );
}

export default {
    buildVendorPayoutsFromFulfillments,
    processPendingVendorPayouts,
    settleVendorPayouts,
    summarizePayouts,
};
