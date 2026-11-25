import paystack from '#config/paystack.js';
import { minorUnits } from './checkout.js';

let bankListCache = null;
let bankListCacheExpiresAt = 0;

export async function listPaystackBanks() {
    if (bankListCache && Date.now() < bankListCacheExpiresAt)
        return bankListCache.map((bank) => ({ ...bank }));

    const banks = [];
    const cursors = new Set();
    let next = null;
    do {
        const { data } = await paystack.get('/bank', {
            params: {
                country: 'nigeria',
                currency: 'NGN',
                type: 'nuban',
                use_cursor: true,
                perPage: 100,
                ...(next ? { next } : {}),
            },
        });
        if (!data.status || !Array.isArray(data.data))
            throw new Error('Unable to fetch supported banks');
        banks.push(...data.data);
        next = data.meta?.next ?? null;
        if (next && cursors.has(next))
            throw new Error('Paystack bank list pagination did not advance');
        if (next) cursors.add(next);
    } while (next);

    bankListCache = banks
        .filter((bank) => bank?.name && bank?.code != null)
        .map((bank) => ({ name: String(bank.name), code: String(bank.code) }))
        .sort((a, b) => a.name.localeCompare(b.name));
    bankListCacheExpiresAt = Date.now() + 6 * 60 * 60 * 1000;
    return bankListCache.map((bank) => ({ ...bank }));
}

export async function initializePaystack({
    email,
    amount,
    reference,
    currency,
    metadata,
    planCode,
    channels,
}) {
    const payload = {
        email,
        amount: minorUnits(amount),
        reference,
        currency,
        metadata,
    };
    if (planCode) payload.plan = planCode;
    if (channels) payload.channels = channels;
    const { data } = await paystack.post('/transaction/initialize', payload);
    if (!data.status || !data.data?.authorization_url)
        throw new Error('Payment initialization failed');
    return data.data;
}

export async function createPaystackPlan({ name, amount, interval = 'monthly' }) {
    const { data } = await paystack.post('/plan', {
        name,
        amount: minorUnits(amount),
        interval,
    });
    if (!data.status || !data.data?.plan_code)
        throw new Error('Paystack plan creation failed');
    return data.data;
}

export async function verifyPaystack(reference) {
    const { data } = await paystack.get(
        `/transaction/verify/${encodeURIComponent(reference)}`
    );
    if (!data.status || !data.data)
        throw new Error('Payment verification unavailable');
    return data.data;
}

export async function disablePaystackSubscription({ code, token }) {
    const { data } = await paystack.post('/subscription/disable', { code, token });
    if (!data.status)
        throw new Error('Paystack subscription cancellation failed');
    return data.data;
}

export const refundPaystack = async ({ reference, amount, merchant_note, refundReference }) =>
    (
        await paystack.post('/refund', {
            transaction: reference,
            amount: minorUnits(amount),
            merchant_note,
            ...(refundReference ? { reference: refundReference } : {}),
        })
    ).data;

export const getPaystackRefundByReference = async (refundReference) =>
    (await paystack.get('/refund', { params: { reference: refundReference } })).data;

export async function resolvePaystackBankAccount({ accountNumber, bankCode }) {
    const { data } = await paystack.get('/bank/resolve', {
        params: { account_number: accountNumber, bank_code: bankCode },
    });
    if (!data.status || !data.data?.account_name)
        throw new Error('Unable to verify the bank account');
    return data.data;
}

export async function createPaystackTransferRecipient({
    name,
    accountNumber,
    bankCode,
    currency = 'NGN',
    email,
}) {
    const { data } = await paystack.post('/transferrecipient', {
        type: 'nuban',
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency,
        ...(email ? { email } : {}),
    });
    if (!data.status || !data.data?.recipient_code)
        throw new Error('Paystack recipient creation failed');
    return data.data;
}

export async function initiatePaystackTransfer({
    amountMinor,
    recipientCode,
    reference,
    currency = 'NGN',
    reason,
}) {
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
        throw new Error('Transfer amount must be a positive integer in minor units');
    const { data } = await paystack.post('/transfer', {
        source: 'balance',
        amount: amountMinor,
        currency,
        recipient: recipientCode,
        reference,
        reason,
    });
    if (!data.status || !data.data)
        throw new Error(data.message || 'Paystack transfer initiation failed');
    return data.data;
}

export async function finalizePaystackTransfer({ transferCode, otp }) {
    const { data } = await paystack.post('/transfer/finalize_transfer', {
        transfer_code: transferCode,
        otp,
    });
    if (!data.status || !data.data)
        throw new Error(data.message || 'Paystack transfer finalization failed');
    return data.data;
}

export async function verifyPaystackTransfer(reference) {
    const { data } = await paystack.get(
        `/transfer/verify/${encodeURIComponent(reference)}`
    );
    if (!data.status || !data.data)
        throw new Error('Unable to verify the Paystack transfer');
    return data.data;
}
