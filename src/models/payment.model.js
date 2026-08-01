import pool from "#services/pg_pool.js";
import { generateOrderReference } from "#utils/helpers.js";
import { initializePaystack, initializeStripe } from "#utils/payment.js";
import Order from "./order.model.js";

class Payment {
    static async initiatePayment(userId, orderId, gateway) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Fetch order
            const { rows: orderRows } = await client.query(
                `SELECT o.*, u.email FROM orders o
                JOIN users u ON u.id = o.user_id
                WHERE o.id = $1 AND o.user_id = $2
                AND o.payment_status = 'unpaid'`,
                [orderId, userId]
            );

            if (orderRows.length === 0) {
                return { error: 'Order not found or already paid', code: 404 };
            }

            const order = orderRows[0];
            const reference = generateOrderReference(orderId);

            let gatewayResponse;
            let gatewayRef;

            if (gateway === 'paystack') {
                gatewayResponse = await initializePaystack({
                    email: order.email,
                    amount: order.total,
                    reference,
                    metadata: { 
                        order_id: orderId, 
                        user_id: userId 
                    }
                });
                gatewayRef = reference;
            } else if (gateway === 'stripe') {
                gatewayResponse = await initializeStripe({
                    amount: order.total,
                    orderId,
                    email: order.email,
                    metadata: { order_id: orderId, user_id: userId }
                });
                gatewayRef = gatewayResponse.id; // stripe payment intent id
            } else {
                return { error: 'Invalid payment gateway', code: 400 };
            }

            // 2. Create payment record
            await client.query(
                `INSERT INTO payments (order_id, user_id, vendor_id, gateway, gateway_ref, amount, currency, meta)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (gateway_ref) DO NOTHING`,
                [
                    orderId, userId, order.vendor_id,
                    gateway, gatewayRef, order.total,
                    gateway === 'paystack' ? 'NGN' : 'USD',
                    JSON.stringify(gatewayResponse)
                ]
            );

            // 3. Update order payment method
            await client.query(
                `UPDATE orders SET payment_method = $1, updated_at = NOW() WHERE id = $2`,
                [gateway, orderId]
            );

            await client.query('COMMIT');

            return {
                gateway,
                reference: gatewayRef,
                ...(gateway === 'paystack' && {
                    authorization_url: gatewayResponse.data.authorization_url
                }),
                ...(gateway === 'stripe' && {
                    client_secret: gatewayResponse.client_secret
                })
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error initiating payment:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async verifyPayment(gateway, reference) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Find payment record
            const { rows: paymentRows } = await client.query(
                `SELECT * FROM payments WHERE gateway_ref = $1 AND gateway = $2`,
                [reference, gateway]
            );

            if (paymentRows.length === 0) {
                return { error: 'Payment record not found', code: 404 };
            }

            const payment = paymentRows[0];

            if (payment.status === 'success') {
                return { error: 'Payment already verified', code: 409 };
            }

            // 2. Verify with gateway
            let isSuccess = false;
            let gatewayData;

            if (gateway === 'paystack') {
                gatewayData = await Payment.verifyPaystack(reference);
                isSuccess = gatewayData.data.status === 'success';
            } else if (gateway === 'stripe') {
                gatewayData = await Payment.verifyStripe(reference);
                isSuccess = gatewayData.status === 'succeeded';
            }

            const paymentStatus = isSuccess ? 'success' : 'failed';
            const orderPaymentStatus = isSuccess ? 'paid' : 'failed';
            const orderStatus = isSuccess ? 'processing' : 'pending';

            // 3. Update payment record
            await client.query(
                `UPDATE payments SET
                    status = $1,
                    paid_at = $2,
                    meta = $3,
                    updated_at = NOW()
                WHERE gateway_ref = $4`,
                [
                    paymentStatus,
                    isSuccess ? new Date() : null,
                    JSON.stringify(gatewayData),
                    reference
                ]
            );

            // 4. Update order status
            await client.query(
                `UPDATE orders SET
                    payment_status = $1,
                    status = $2,
                    updated_at = NOW()
                WHERE id = $3`,
                [orderPaymentStatus, orderStatus, payment.order_id]
            );

            await client.query('COMMIT');

            return await Order.getOrderById(payment.order_id, payment.user_id);
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error verifying payment:", error);
            throw error;
        } finally {
            client.release();
        }
    }

    static async processRefund(userId, { order_id, amount, reason, refund_method = 'original_payment' }) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            // 1. Fetch payment for the order
            const { rows: paymentRows } = await client.query(
                `SELECT p.* FROM payments p
                JOIN orders o ON o.id = p.order_id
                WHERE p.order_id = $1
                AND p.status = 'success'
                AND o.user_id = $2`,
                [order_id, userId]
            );

            if (paymentRows.length === 0) {
                return { error: 'No successful payment found for this order', code: 404 };
            }

            const payment = paymentRows[0];

            // 2. Check if already refunded
            const { rows: existingRefund } = await client.query(
                `SELECT id FROM refunds 
                WHERE order_id = $1 AND status = 'success'`,
                [order_id]
            );

            if (existingRefund.length > 0) {
                return { error: 'Order has already been refunded', code: 409 };
            }

            // 3. Check order status
            const { rows: orderRows } = await client.query(
                `SELECT * FROM orders WHERE id = $1`,
                [order_id]
            );

            if (orderRows.length === 0) {
                return { error: 'Order not found', code: 404 };
            }

            const order = orderRows[0];

            if (!['pending', 'processing'].includes(order.status)) {
                return { error: `Cannot refund an order with status: ${order.status}`, code: 422 };
            }

            // 4. Determine refund amount
            const refundAmount = amount ?? payment.amount;
            if (refundAmount > payment.amount) {
                return { error: `Refund amount cannot exceed original payment of ${payment.amount}`, code: 422 };
            }

            // 5. Process refund with gateway or store credit
            let gatewayData = null;
            let gatewayRef = null;
            let isSuccess = false;
            const refundGateway = refund_method === 'store_credit' ? 'store_credit' : payment.gateway;

            if (refund_method === 'store_credit') {
                gatewayData = {
                    method: 'store_credit',
                    amount: refundAmount,
                    reason: reason ?? null,
                    status: 'success'
                };
                isSuccess = true;
            } else if (payment.gateway === 'paystack') {
                gatewayData = await Payment.refundPaystack({
                    reference: payment.gateway_ref,
                    amount: refundAmount,
                    merchant_note: reason ?? 'Customer refund request'
                });
                gatewayRef = gatewayData.data.id.toString();
                isSuccess = gatewayData.status === true;
            } else if (payment.gateway === 'stripe') {
                gatewayData = await Payment.refundStripe({
                    paymentIntentId: payment.gateway_ref,
                    amount: refundAmount,
                    reason
                });
                gatewayRef = gatewayData.id;
                isSuccess = gatewayData.status === 'succeeded' || gatewayData.status === 'pending';
            }

            if (!isSuccess) {
                const refundStatus = gatewayData?.status || 'failed';
                await client.query(
                    `INSERT INTO refunds 
                    (payment_id, order_id, user_id, gateway, gateway_ref, amount, reason, status, refunded_at, meta)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                    [
                        payment.id, order_id, userId,
                        refundGateway, gatewayRef,
                        refundAmount, reason ?? null,
                        refundStatus,
                        null,
                        JSON.stringify(gatewayData)
                    ]
                );

                await client.query('COMMIT');

                return {
                    refund_status: refundStatus,
                    gateway: payment.gateway,
                    amount: refundAmount,
                    order_id,
                    reason: reason ?? null
                };
            }

            const refundStatus = isSuccess ? 'success' : 'failed';

            // 6. Insert refund record
            await client.query(
                `INSERT INTO refunds 
                (payment_id, order_id, user_id, gateway, gateway_ref, amount, reason, status, refunded_at, meta)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
                [
                    payment.id, order_id, userId,
                    refundGateway, gatewayRef,
                    refundAmount, reason ?? null,
                    refundStatus,
                    isSuccess ? new Date() : null,
                    JSON.stringify(gatewayData)
                ]
            );

            if (isSuccess) {
                // 7. Update payment status
                await client.query(
                    `UPDATE payments SET
                        status = 'refunded',
                        updated_at = NOW()
                    WHERE id = $1`,
                    [payment.id]
                );

                // 8. Update order status
                await client.query(
                    `UPDATE orders SET
                        status = 'refunded',
                        payment_status = 'refunded',
                        updated_at = NOW()
                    WHERE id = $1`,
                    [order_id]
                );

                // 9. Restore stock
                const { rows: orderItems } = await client.query(
                    `SELECT * FROM order_items WHERE order_id = $1`,
                    [order_id]
                );

                for (const item of orderItems) {
                    if (item.variant_id) {
                        await client.query(
                            `UPDATE product_variants
                            SET stock = stock + $1, updated_at = NOW()
                            WHERE id = $2`,
                            [item.quantity, item.variant_id]
                        );
                    } else {
                        await client.query(
                            `UPDATE products
                            SET stock = stock + $1, updated_at = NOW()
                            WHERE id = $2`,
                            [item.quantity, item.product_id]
                        );
                    }
                }
            }

            await client.query('COMMIT');

            return {
                refund_status: refundStatus,
                gateway: payment.gateway,
                amount: refundAmount,
                order_id,
                reason: reason ?? null
            };
        } catch (error) {
            await client.query('ROLLBACK');
            console.error("Error processing refund:", error);
            throw error;
        } finally {
            client.release();
        }
    }
}

export default Payment;