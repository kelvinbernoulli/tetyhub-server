import crypto from 'node:crypto';
import Payment from '#models/payment.model.js';
import Payout from '#models/payout.model.js';

export async function paystackWebhook(req, res) {
    const signature = req.headers['paystack-signature'] ?? req.headers['x-paystack-signature'];
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
        if (!event.event || !event.data) return res.sendStatus(400);
        const eventData = event.data;
        if (event.event === 'charge.success') {
            if (!eventData.id) return res.sendStatus(400);
            await Payment.settle('paystack', eventData, `${event.event}:${eventData.id}`);
        } else if (['transfer.success', 'transfer.failed', 'transfer.reversed'].includes(event.event)) {
            const reference = eventData.reference;
            if (!reference) return res.sendStatus(400);
            await Payout.applyTransferStatus(
                `paystack:${event.event}:${eventData.id ?? reference}`,
                event.event.slice('transfer.'.length),
                eventData
            );
        } else if (['refund.processed', 'charge.dispute.create', 'charge.dispute.resolve'].includes(event.event)) {
            await Payout.applyFinancialWebhook(
                `paystack:${event.event}:${eventData.id ?? eventData.refund_reference ?? eventData.transaction_reference ?? eventData.reference ?? 'unknown'}`,
                event.event,
                eventData
            );
        }
        return res.sendStatus(200);
    } catch (error) {
        console.error('Paystack webhook processing failed:', error.message);
        return res.sendStatus(500);
    }
}
export default paystackWebhook;
