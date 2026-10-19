import PayoutModel from '#models/payout.model.js';
import { processPendingVendorPayouts, settleVendorPayouts } from '#services/vendor-payout.service.js';

export async function listVendorPayouts(vendorId, query = {}) {
    return PayoutModel.listForVendor(vendorId, query);
}

export async function getVendorPayoutById(vendorId, payoutId) {
    return PayoutModel.findForVendor(vendorId, payoutId);
}

export async function processVendorPayout(vendorId, payoutId) {
    const payout = await PayoutModel.processPending(vendorId, payoutId);
    return {
        ...payout,
        transition: 'processing',
        processed: true,
    };
}

export async function settleVendorPayout(vendorId, payoutId) {
    const payout = await PayoutModel.settlePaid(vendorId, payoutId);
    return {
        ...payout,
        transition: 'paid',
        settled: true,
    };
}

export async function summarizeVendorPayouts(vendorId) {
    const summary = await PayoutModel.summaryForVendor(vendorId);
    return {
        pending_count: Number(summary.pending_count ?? 0),
        processing_count: Number(summary.processing_count ?? 0),
        paid_count: Number(summary.paid_count ?? 0),
        pending_total: Number(summary.pending_total ?? 0),
        processing_total: Number(summary.processing_total ?? 0),
        paid_total: Number(summary.paid_total ?? 0),
    };
}

export function buildVendorPayoutsFromFulfillments(rows = []) {
    return processPendingVendorPayouts(rows).map((row) => ({
        ...row,
        status: 'pending',
    }));
}

export function finalizeVendorPayouts(rows = []) {
    return settleVendorPayouts(rows);
}

export default {
    listVendorPayouts,
    getVendorPayoutById,
    processVendorPayout,
    settleVendorPayout,
    summarizeVendorPayouts,
    buildVendorPayoutsFromFulfillments,
    finalizeVendorPayouts,
};
