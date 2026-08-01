import Stripe from 'stripe';
import { config } from 'dotenv';
import paystack from '#config/paystack.js';
import ERROR_CODES from '#utils/error.codes.js';
import { respondWithError } from './response.js';
config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const initializePaystack = async ({ email, amount, reference, currency, metadata = {} }) => {
    const response = await paystack.post('/transaction/initialize', {
        email,
        amount: Math.round(amount * 100),
        reference,
        currency,
        metadata: {
            //
        },
    });

    console.log("Paystack initialize response:", response.data);

    if (!response.data.status) {
        return {
            message: 'Payment initialization failed',
            code: ERROR_CODES.PAYMENT_FAILED
        };
    }

    return {
        message: 'Payment initialized successfully',
        data: {
            authorization_url: response.data.data.authorization_url,
            access_code: response.data.data.access_code,
            reference: response.data.data.reference
        }
    };
};

const verifyPayment = async (req, res) => {
    try {
        const { session, params } = req;
        const user = session?.user;
        const { reference } = params;

        const response = await paystack.get(`/transaction/verify/${reference}`);

        const payment = response.data.data;

        if (payment.status === 'success') {
            return respondWithSuccess(res, 200, "Payment verified", payment);
        }

        return respondWithError(res, 400, "Payment verification failed", ERROR_CODES.PAYMENT_VERIFICATION_FAILED);

    } catch (error) {
        console.error(error.response?.data || error.message);
        return respondWithError(res, 500, error.message, ERROR_CODES.INTERNAL_SERVER_ERROR);
    }
};

export const refundPaystack = async ({ reference, amount, merchant_note }) => {
    const response = await paystack.post('/refund',
        {
            transaction: reference,
            amount: Math.round(amount * 100), // kobo
            merchant_note
        },
        {
            headers: {
                Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        }
    );

    console.log("Paystack refund response:", response.data);
    return response.data;
};

export const initializeStripe = async ({ amount, currency = 'usd', orderId, email, metadata = {} }) => {
    const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // stripe uses cents
        currency,
        receipt_email: email,
        metadata: { order_id: orderId, ...metadata },
    });
    return paymentIntent;
};

export const verifyStripe = async (paymentIntentId) => {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return paymentIntent;
};

export const refundStripe = async ({ paymentIntentId, amount, reason }) => {
    const refund = await stripe.refunds.create({
        payment_intent: paymentIntentId,
        amount: Math.round(amount * 100), // cents
        reason: reason ?? 'requested_by_customer'
    });
    return refund;
};