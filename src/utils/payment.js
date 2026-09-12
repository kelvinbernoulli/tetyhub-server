import Stripe from 'stripe';
import paystack from '#config/paystack.js';
import { minorUnits } from './checkout.js';
let stripe;
export const stripeClient = () =>
    (stripe ??= new Stripe(process.env.STRIPE_SECRET_KEY, {
        timeout: 15000,
        maxNetworkRetries: 1,
    }));
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
export const initializeStripe = ({
    email,
    amount,
    currency,
    reference,
    metadata,
}) =>
    stripeClient().paymentIntents.create(
        {
            amount: minorUnits(amount),
            currency: currency.toLowerCase(),
            receipt_email: email,
            metadata,
        },
        { idempotencyKey: reference }
    );
export const verifyStripe = (reference) =>
    stripeClient().paymentIntents.retrieve(reference);
export const refundPaystack = async ({ reference, amount, merchant_note }) =>
    (
        await paystack.post('/refund', {
            transaction: reference,
            amount: minorUnits(amount),
            merchant_note,
        })
    ).data;
export const refundStripe = ({ paymentIntentId, amount, reason }) =>
    stripeClient().refunds.create({
        payment_intent: paymentIntentId,
        amount: minorUnits(amount),
        reason: reason ?? 'requested_by_customer',
    });
