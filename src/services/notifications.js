import Notification from '#models/notification.model.js';

// Resolve vendor IDs to user IDs; the two identifiers are not interchangeable.
export async function vendorRecipients(client, vendorIds, resource) {
    if (!vendorIds.length) return [];
    const { rows } = await client.query(
        `SELECT u.id FROM users u JOIN vendors v ON v.user_id = u.id
         WHERE v.id = ANY($1::integer[]) AND u.status::text = 'active' AND v.status = 'active'
         UNION
         SELECT u.id FROM users u JOIN admins a ON a.user_id = u.id
         JOIN vendors v ON v.id = a.vendor_id
         JOIN admin_permissions ap ON ap.admin_id = a.id
         JOIN admin_types at ON at.id = ap.admin_type_id
         WHERE a.vendor_id = ANY($1::integer[]) AND a.scope::text = 'vendor'
         AND a.status::text = 'active' AND u.status::text = 'active' AND u.role::text = 'vendor_admin'
         AND v.status = 'active' AND ap.status = true AND ap.can_read = true
         AND (ap.expires_at IS NULL OR ap.expires_at > NOW())
         AND at.status = true AND at.slug = $2 AND at.scope::text IN ('vendor', 'both')`,
        [vendorIds, resource]
    );
    return rows.map((row) => row.id);
}

export async function platformRecipients(client, resource) {
    const { rows } = await client.query(
        `SELECT u.id FROM users u JOIN admins a ON a.user_id = u.id
         WHERE u.status::text = 'active' AND a.status::text = 'active' AND a.scope::text = 'platform'
         AND (u.role::text = 'super_admin' OR (u.role::text = 'admin' AND EXISTS (
             SELECT 1 FROM admin_permissions ap JOIN admin_types at ON at.id = ap.admin_type_id
             WHERE ap.admin_id = a.id AND ap.status = true AND ap.can_read = true
             AND (ap.expires_at IS NULL OR ap.expires_at > NOW())
             AND at.slug = $1 AND at.status = true AND at.scope::text IN ('platform', 'both')
         )))`,
        [resource]
    );
    return rows.map((row) => row.id);
}

export async function notifyOrder(
    client,
    order,
    status,
    { vendors = true } = {}
) {
    await Notification.notifyOrderStatusChange(
        order.id,
        order.user_id,
        null,
        status,
        client
    );
    if (!vendors) return;
    const { rows } = await client.query(
        'SELECT DISTINCT vendor_id FROM order_items WHERE order_id = $1',
        [order.id]
    );
    const recipients = await vendorRecipients(
        client,
        rows.map((row) => row.vendor_id),
        'orders'
    );
    await Notification.createMany(
        recipients.filter((id) => id !== order.user_id),
        'order',
        'Order updated',
        `Order #${order.id} is ${status.replaceAll('_', ' ')}.`,
        { order_id: order.id, status },
        client
    );
    if (status === 'payment_review') {
        await Notification.createMany(
            await platformRecipients(client, 'payments'),
            'payment_review',
            'Payment needs review',
            'An order payment arrived after its reservation ended. Review it before fulfillment.',
            { order_id: order.id },
            client
        );
    }
}

export async function notifyBooking(
    client,
    booking,
    status,
    { vendors = true } = {}
) {
    const metadata = { booking_id: booking.id, status };
    const message =
        status === 'payment_review'
            ? 'Your booking payment needs review because the reservation is no longer available.'
            : `Your booking is ${status.replaceAll('_', ' ')}.`;
    await Notification.createNotification(
        booking.user_id,
        'booking',
        'Booking updated',
        message,
        metadata,
        client
    );
    if (vendors) {
        const recipients = await vendorRecipients(
            client,
            [booking.vendor_id],
            'services'
        );
        await Notification.createMany(
            recipients.filter((id) => id !== booking.user_id),
            'booking',
            'Booking updated',
            `Booking #${booking.id} is ${status.replaceAll('_', ' ')}.`,
            metadata,
            client
        );
    }
    if (status === 'payment_review') {
        await Notification.createMany(
            await platformRecipients(client, 'payments'),
            'payment_review',
            'Booking payment needs review',
            'A booking payment arrived after its reservation ended. Review the payment.',
            metadata,
            client
        );
    }
}

export async function notifyReturn(
    client,
    request,
    status,
    { vendors = false } = {}
) {
    await Notification.notifyReturnStatusUpdate(
        request.id,
        request.user_id,
        status,
        client
    );
    if (vendors) {
        // A return can contain items from multiple vendors. Scope recipients to its actual items.
        const { rows } = await client.query(
            `SELECT DISTINCT oi.vendor_id FROM return_items ri
             JOIN order_items oi ON oi.id = ri.order_item_id WHERE ri.return_id = $1`,
            [request.id]
        );
        const recipients = await vendorRecipients(
            client,
            rows.map((row) => row.vendor_id),
            'returns'
        );
        await Notification.createMany(
            recipients.filter((id) => id !== request.user_id),
            'return_status',
            'Return request updated',
            `Return #${request.id} is ${status.replaceAll('_', ' ')}.`,
            { return_id: request.id, order_id: request.order_id, status },
            client
        );
    }
}

export async function notifyLowStock(client, item) {
    const table = item.variant_id ? 'product_variants' : 'products';
    const { rows } = await client.query(
        `SELECT stock, low_stock_threshold FROM ${table} WHERE id = $1`,
        [item.variant_id ?? item.product_id]
    );
    const stock = rows[0];
    if (
        !stock ||
        stock.stock > stock.low_stock_threshold ||
        stock.stock + item.quantity <= stock.low_stock_threshold
    )
        return;
    await Notification.createMany(
        await vendorRecipients(client, [item.vendor_id], 'products'),
        'low_stock',
        'Stock is running low',
        'A product has reached its low-stock threshold.',
        {
            product_id: item.product_id,
            variant_id: item.variant_id ?? null,
            stock: stock.stock,
        },
        client
    );
}

// The payment row is locked by each settlement workflow before calling this helper.
export async function notifyPaymentFailure(
    client,
    payment,
    providerStatus,
    metadata
) {
    if (
        !['failed', 'canceled', 'cancelled', 'abandoned'].includes(
            providerStatus
        )
    )
        return;
    let previous = {};
    try {
        previous =
            typeof payment.meta === 'string'
                ? JSON.parse(payment.meta)
                : (payment.meta ?? {});
    } catch {
        /* Legacy metadata may not be JSON. */
    }
    if (previous.notification_failure_status === providerStatus) return;
    await Notification.createNotification(
        payment.user_id,
        'payment',
        'Payment was not completed',
        'Your payment attempt was unsuccessful. You can retry from your order or booking.',
        metadata,
        client
    );
    await client.query(
        'UPDATE payments SET meta = $1, updated_at = NOW() WHERE id = $2',
        [
            JSON.stringify({
                ...previous,
                status: providerStatus,
                notification_failure_status: providerStatus,
            }),
            payment.id,
        ]
    );
}
