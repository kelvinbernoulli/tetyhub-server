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
}) {
    const { data } = await paystack.post('/transaction/initialize', {
        email,
        amount: minorUnits(amount),
        reference,
        currency,
        metadata,
    });
    if (!data.status || !data.data?.authorization_url)
        throw new Error('Payment initialization failed');
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
export const refundPaystack = async ({ reference, amount, merchant_note }) =>
    (
        await paystack.post('/refund', {
            transaction: reference,
            amount: minorUnits(amount),
            merchant_note,
        })
    ).data;
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
    email,
}) {
    const { data } = await paystack.post('/transferrecipient', {
        type: 'nuban',
        name,
        account_number: accountNumber,
        bank_code: bankCode,
        currency: 'NGN',
        email,
    });
    if (!data.status || !data.data?.recipient_code)
        throw new Error('Paystack did not create a transfer recipient');
    return data.data;
}
export async function initiatePaystackTransfer({
    amountMinor,
    recipientCode,
    reference,
    reason,
}) {
    const { data } = await paystack.post('/transfer', {
        source: 'balance',
        amount: amountMinor,
        currency: 'NGN',
        recipient: recipientCode,
        reference,
        reason,
    });
    if (!data.status || !data.data)
        throw new Error('Paystack did not accept the transfer');
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
