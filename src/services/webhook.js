import CustomerModel from "#models/customer.model.js";
import pool from "./pg_pool.js";
import { config } from "dotenv";
config();
import crypto from "crypto";
import ERROR_CODES from "#utils/error.codes.js";

export const paystackWebhook = async (req, res) => {

    const client = await pool.connect();

    try {
        const hash = crypto
            .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
            .update(JSON.stringify(req.body))
            .digest('hex');

        if (hash !== req.headers['x-paystack-signature']) {
            return res.status(401).json({
                success: false,
                message: 'Invalid signature'
            });
        }

        const event = req.body;

        console.log("Paystack webhook:", event);
        const reference = event.data.reference;

        const paymentResult = await client.query(
            `SELECT * FROM payments WHERE gateway_ref = $1 LIMIT 1`,
            [reference]
        );
        console.log("Payment lookup result:", paymentResult.rows);

        if (paymentResult.rowCount === 0) {
            console.warn("Payment not found for reference:", reference);
            return res.status(404).json({
                success: false,
                message: 'Payment not found'
            });
        }

        const existingEvent = await client.query(
            `SELECT id FROM payment_events
            WHERE gateway_event_id = $1`,
            [event.data.id?.toString()]
        );

        if (existingEvent.rowCount > 0) {
            console.log('Duplicate webhook event ignored');
            return;
        }

        await client.query(
            `INSERT INTO payment_events (
                payment_id,
                event_type,
                gateway_ref,
                gateway_event_id,
                payload,
                processed
            )
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                paymentResult.rows[0].id,
                event.event,
                reference,
                event.data.id?.toString(),
                JSON.stringify(event.data),
                false
            ]
        );

        switch (event.event) {

            case "charge.success":

                await handleSuccessfulPayment(client, event.data);

                break;

            case "charge.failed":

                await handleFailedPayment(client, event.data);

                break;

            case "refund.success":

                await handleRefund(client, event.data);

                break;

            default:

                console.log("Unhandled event:", event.event);
        }

        return res.sendStatus(200);

    } catch (error) {
        console.error("Webhook error:", error);
        return res.sendStatus(500);
    } finally {
        client.release();
    }
};

const handleSuccessfulPayment = async (client, data) => {
    console.log("Handling successful payment:", data);

    const {
        id,
        reference,
        amount,
        currency,
        channel,
        paid_at,
        metadata = {}
    } = data;

    try {

        // 1. Find payment
        const existingPayment = await client.query(
            `
            SELECT *
            FROM payments
            WHERE gateway_ref = $1
            LIMIT 1
            `,
            [reference]
        );

        if (!existingPayment.rowCount) {
            throw new Error("Payment not found");
        }

        const paymentRecord = existingPayment.rows[0];

        // 2. Prevent duplicate processing
        if (paymentRecord.status === "success") {
            console.log("Payment already processed:", reference);
            return;
        }

        // 3. Update payment
        const payment = await client.query(
            `
            UPDATE payments
            SET
                status = $1,
                paid_at = $2,
                gateway_transaction_id = $3,
                payment_method = $4,
                meta = $5,
                updated_at = NOW()
            WHERE gateway_ref = $6
            RETURNING *
            `,
            [
                data.status,
                data.paid_at ? new Date(data.paid_at) : new Date(),
                data.id,
                data.channel,
                data,
                reference
            ]
        );

        // 4. Update order
        await client.query(
            `
                UPDATE orders
                SET
                    payment_status = 'paid',
                    status = 'processing',
                    updated_at = NOW()
                WHERE id = $1
            `,
            [payment.rows[0].order_id]
        );

        // 5. Insert order history
        await client.query(
            `
            INSERT INTO order_status_history (
                order_id,
                status,
                note
            )
            VALUES ($1, $2, $3)
            `,
            [
                payment.rows[0].order_id,
                'processing',
                'Payment confirmed via Paystack'
            ]
        );

        console.log("✅ Payment success:", reference);

    } catch (error) {
        console.error("Payment processing failed:", error);
        throw error;
    }
};

// Handle failed payment
const handleFailedPayment = async (client, data) => {

    const { reference, gateway_response, channel } = data;

    await client.query(
        `
            UPDATE payments
            SET
                status = 'failed',
                failure_reason = $1,
                payment_method = $2,
                meta = $3,
                updated_at = NOW()
            WHERE gateway_ref = $4
        `,
        [
            gateway_response,
            channel,
            data,
            reference
        ]
    );

    console.log("❌ Payment failed:", reference);
};

const handleRefund = async (client, data) => {

    await client.query(
        `
            UPDATE payments
            SET
                status = 'refunded',
                refunded_at = NOW(),
                updated_at = NOW()
            WHERE gateway_transaction_id = $1
        `,
        [data.transaction.toString()]
    );

    console.log("Refund processed:", data.transaction);
};

export default paystackWebhook;