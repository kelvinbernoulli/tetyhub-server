import crypto from 'node:crypto';
import Payment from '#models/payment.model.js';
import { stripeClient } from '#utils/payment.js';

export async function paystackWebhook(req, res) {
    const signature = req.headers['x-paystack-signature'];
    if (
        !process.env.PAYSTACK_SECRET_KEY ||
        !Buffer.isBuffer(req.body) ||
        typeof signature !== 'string' ||
        !/^[a-f0-9]{128}$/i.test(signature)
    )
        return res.sendStatus(401);
    const expected = crypto
        .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
        .update(req.body)
        .digest();
    if (!crypto.timingSafeEqual(expected, Buffer.from(signature, 'hex')))
        return res.sendStatus(401);
    try {
        const event = JSON.parse(req.body.toString('utf8'));
        if (event.event !== 'charge.success') return res.sendStatus(200);
        if (!event.data?.id) return res.sendStatus(400);
        await Payment.settle(
            'paystack',
            event.data,
            `${event.event}:${event.data.id}`
        );
        return res.sendStatus(200);
    } catch (error) {
        console.error('Paystack webhook processing failed:', error.message);
        return res.sendStatus(500);
    }
}
export async function stripeWebhook(req, res) {
    let event;
    try {
        event = stripeClient().webhooks.constructEvent(
            req.body,
            req.headers['stripe-signature'],
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch {
        return res.sendStatus(400);
    }
    try {
        if (event.type === 'payment_intent.succeeded')
            await Payment.settle('stripe', event.data.object, event.id);
        return res.sendStatus(200);
    } catch (error) {
        console.error('Stripe webhook processing failed:', error.message);
        return res.sendStatus(500);
    }
}
export default paystackWebhook;
