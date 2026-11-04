import { notifyOrder, notifyLowStock } from '#services/notifications.js';
import { vendorSaleAllocations } from '#utils/commission.js';
import { recordProductSale } from '#services/marketplace-ledger.js';
import {
    getProviderPlan,
    lockProviderEntitlements,
} from '#services/entitlements.js';
import { createHash, randomUUID } from 'node:crypto';
import pool from './pg_pool.js';
import Payment from '#models/payment.model.js';
import {
    shippingCartFingerprint,
    shippingDestinationFingerprint,
} from '#utils/shipping-address.js';
import { groupShippingItems, itemShippingData } from '#utils/shipping-package.js';
import {
    CheckoutError,
    minorUnits,
    majorUnits,
    assertGatewayCurrency,
    transaction,
} from '#utils/checkout.js';

export async function quote(client, userId, data = {}, lock = false) {
    const { rows: carts } = await client.query(
        'SELECT id FROM carts WHERE user_id = $1' + (lock ? ' FOR UPDATE' : ''),
        [userId]
    );
    if (!carts.length) throw new CheckoutError('Cart is empty', 400);
    const { rows: items } = await client.query(
        `SELECT ci.id AS cart_item_id, ci.id, ci.product_id, ci.variant_id, ci.quantity,
        p.vendor_id, p.name AS product_name, p.thumbnail, p.status, p.deleted_at, p.has_variants,
        p.track_inventory, p.free_shipping, p.is_digital, p.weight, p.length, p.width, p.height,
        p.shipbubble_category_id,
        pv.weight AS variant_weight, pv.dimensions AS variant_dimensions,
        pv.length AS variant_length, pv.width AS variant_width, pv.height AS variant_height,
        p.currency_id, c.code AS currency, c.status AS currency_active,
        CASE WHEN ci.variant_id IS NULL THEN p.price ELSE pv.price END AS price,
        CASE WHEN ci.variant_id IS NULL THEN p.stock ELSE pv.stock END AS stock,
        pv.status AS variant_status, pv.product_id AS variant_product_id
        FROM cart_items ci JOIN products p ON p.id = ci.product_id
        LEFT JOIN currencies c ON c.id = p.currency_id
        LEFT JOIN product_variants pv ON pv.id = ci.variant_id
        WHERE ci.cart_id = $1 ORDER BY p.id, ci.id` +
        (lock ? ' FOR UPDATE OF ci, p' : ''),
        [carts[0].id]
    );
    if (!items.length) throw new CheckoutError('Cart is empty', 400);
    const currencies = new Set(items.map((item) => item.currency));
    if (currencies.size !== 1)
        throw new CheckoutError(
            'Check out products with different currencies separately'
        );
    const currency = items[0].currency;
    if (!['NGN'].includes(currency))
        throw new CheckoutError('Unsupported checkout currency');
    for (const item of items) {
        if (lock && item.variant_id) {
            const { rows } = await client.query(
                'SELECT price, stock, status, product_id FROM product_variants WHERE id = $1 FOR UPDATE',
                [item.variant_id]
            );
            Object.assign(item, {
                price: rows[0]?.price,
                stock: rows[0]?.stock,
                variant_status: rows[0]?.status,
                variant_product_id: rows[0]?.product_id,
            });
        }
        if (
            !item.currency_active ||
            item.status !== 'active' ||
            item.deleted_at ||
            (item.has_variants && !item.variant_id) ||
            (item.variant_id &&
                (item.variant_status !== 'active' ||
                    item.variant_product_id !== item.product_id))
        )
            throw new CheckoutError(`${item.product_name} is unavailable`);
        if (
            !Number.isInteger(item.quantity) ||
            item.quantity < 1 ||
            item.quantity > 100
        )
            throw new CheckoutError('Invalid cart quantity');
        if (item.track_inventory && item.stock < item.quantity) {
            throw new CheckoutError(
                `Insufficient stock for ${item.product_name}`,
                409
            );
        }
        item.subtotal_minor = minorUnits(item.price) * item.quantity;
        item.subtotal = majorUnits(item.subtotal_minor);
        minorUnits(item.subtotal);
    }
    const subtotal = items.reduce((sum, item) => sum + item.subtotal_minor, 0);
    minorUnits(majorUnits(subtotal));
    let selectedShippingQuotes = [];
    let shipping;
    const paidShippingItems = items.filter((item) => !item.is_digital && !item.free_shipping);
    if (paidShippingItems.some((item) => !Number.isSafeInteger(Number(item.shipbubble_category_id)) || Number(item.shipbubble_category_id) <= 0))
        throw new CheckoutError('A ShipBubble category is missing from a shippable product', 422);
    const requiredPackageGroups = groupShippingItems(items);
    console.log('Required Package Groups:', requiredPackageGroups);
    const requiredGroupKeys = new Set(requiredPackageGroups.map((group) => group.package_group_key));
    let shippingQuoteIds = Array.isArray(data.shipping_quote_ids)
        ? data.shipping_quote_ids
        : [];
        console.log('Provided shipping quote IDs:', shippingQuoteIds);
    if (requiredPackageGroups.length && shippingQuoteIds.length === 0) {
        const { rows: defaultQuotes } = await client.query(
            `SELECT q.id, q.package_group_key
             FROM shipbubble_rate_quotes q
             JOIN (
                 SELECT DISTINCT ON (package_group_key) id
                 FROM shipbubble_rate_quotes
                 WHERE user_id = $1 AND order_id IS NULL AND expires_at > NOW()
                   AND package_group_key = ANY($2::text[])
                   AND quote_data->>'selected_by_default' = 'true'
                 ORDER BY package_group_key, created_at DESC, id DESC
             ) latest ON latest.id = q.id
             ORDER BY q.package_group_key`,
            [userId, [...requiredGroupKeys]]
        );
        if (defaultQuotes.length !== requiredPackageGroups.length)
            throw new CheckoutError(
                'Shipping rates are missing or expired for one or more packages; request rates again',
                409
            );
        shippingQuoteIds = defaultQuotes.map((quote) => quote.id);
    }
    if (shippingQuoteIds.length) {
        if (shippingQuoteIds.length !== requiredPackageGroups.length)
            throw new CheckoutError(
                'Select one ShipBubble shipping option for each package',
                422
            );
        const selected = await client.query(
            `SELECT id, vendor_id, package_group_key, amount, currency, courier_name, quote_data
             FROM shipbubble_rate_quotes
             WHERE id = ANY($1::uuid[]) AND user_id = $2
               AND order_id IS NULL AND expires_at > NOW()
             ${lock ? 'FOR UPDATE' : ''}`,
            [shippingQuoteIds, userId]
        );
        if (selected.rows.length !== shippingQuoteIds.length)
            throw new CheckoutError(
                'A selected ShipBubble rate expired; request shipping rates again',
                409
            );
        const byPackageGroup = new Map();
        const destinationFingerprint =
            data.address && data.city && data.state && data.country
                ? shippingDestinationFingerprint(data)
                : null;
        for (const selectedQuote of selected.rows) {
            if (byPackageGroup.has(selectedQuote.package_group_key))
                throw new CheckoutError(
                    'Select only one ShipBubble option per package',
                    422
                );
            if (selectedQuote.currency !== currency)
                throw new CheckoutError(
                    'ShipBubble rate currency does not match the order',
                    422
                );
            if (
                destinationFingerprint &&
                selectedQuote.quote_data?.destination_fingerprint !==
                    destinationFingerprint
            )
                throw new CheckoutError(
                    'The delivery address changed; request ShipBubble rates again',
                    409
                );
            const packageGroup = requiredPackageGroups.find(
                (group) => group.package_group_key === selectedQuote.package_group_key
            );
            if (!packageGroup || Number(selectedQuote.vendor_id) !== packageGroup.vendor_id ||
                Number(selectedQuote.quote_data?.category_id) !== packageGroup.category_id)
                throw new CheckoutError(
                    'A selected ShipBubble rate does not match a shipping package in this cart',
                    422
                );
            const packageItems = packageGroup.items;
            const cartFingerprint = shippingCartFingerprint(
                packageItems.map((item) => {
                    const { weight, dimensions } = itemShippingData(item);
                    return {
                        ...item,
                        length: dimensions.length,
                        width: dimensions.width,
                        height: dimensions.height,
                        unit_weight: weight,
                        unit_amount: item.price,
                    };
                })
            );
            if (selectedQuote.quote_data?.cart_fingerprint !== cartFingerprint)
                throw new CheckoutError(
                    'The cart changed; request ShipBubble rates again',
                    409
                );
            byPackageGroup.set(selectedQuote.package_group_key, selectedQuote);
        }
        if (
            [...requiredGroupKeys].some((groupKey) => !byPackageGroup.has(groupKey)) ||
            [...byPackageGroup.keys()].some((groupKey) => !requiredGroupKeys.has(groupKey))
        )
            throw new CheckoutError(
                'Select a ShipBubble option for each shipping package',
                422
            );
        shipping = selected.rows.reduce(
            (total, row) => total + minorUnits(row.amount),
            0
        );
        selectedShippingQuotes = selected.rows;
    } else {
        shipping = 0;
    }
    minorUnits(majorUnits(shipping));
    let discount = 0,
        coupon = null;
    if (data.coupon_code) {
        const vendorIds = [...new Set(items.map((item) => item.vendor_id))];
        const { rows } = await client.query(
            `SELECT * FROM coupons WHERE code = $1 AND vendor_id = ANY($2::int[])
            AND status = 'active' AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY id` +
            (lock ? ' FOR UPDATE' : ''),
            [data.coupon_code, vendorIds]
        );
        if (rows.length !== 1)
            throw new CheckoutError(
                'Coupon is invalid or ambiguous for this cart'
            );
        coupon = rows[0];
        const eligible = items.filter(
            (item) =>
                item.vendor_id === coupon.vendor_id &&
                !coupon.service_id &&
                (!coupon.product_id || item.product_id === coupon.product_id)
        );
        const eligibleTotal = eligible.reduce(
            (sum, item) => sum + item.subtotal_minor,
            0
        );
        if (!eligible.length || eligibleTotal < minorUnits(coupon.min_order))
            throw new CheckoutError(
                'Coupon minimum or product requirements are not met'
            );
        if (
            coupon.usage_limit !== null &&
            coupon.usage_count >= coupon.usage_limit
        )
            throw new CheckoutError('Coupon usage limit reached');
        const used = await client.query(
            'SELECT id FROM coupon_usage WHERE coupon_id = $1 AND user_id = $2',
            [coupon.id, userId]
        );
        if (used.rows.length)
            throw new CheckoutError('You have already used this coupon');
        if (coupon.type === 'percentage') {
            const basisPoints = minorUnits(coupon.value);
            if (basisPoints > 10000)
                throw new CheckoutError('Invalid coupon percentage');
            discount = Math.round((eligibleTotal * basisPoints) / 10000);
        } else if (['fixed', 'fixed_amount'].includes(coupon.type))
            discount = minorUnits(coupon.value);
        else throw new CheckoutError('Unsupported coupon type');
        if (coupon.max_discount !== null)
            discount = Math.min(discount, minorUnits(coupon.max_discount));
        discount = Math.min(discount, eligibleTotal);
    }
    const total = subtotal + shipping - discount;
    minorUnits(majorUnits(total));
    return {
        cart_id: carts[0].id,
        items,
        currency,
        currency_id: items[0].currency_id,
        subtotal: majorUnits(subtotal),
        shipping_fee: majorUnits(shipping),
        shipping_quotes: selectedShippingQuotes,
        discount: majorUnits(discount),
        total: majorUnits(total),
        coupon,
        item_count: items.reduce((sum, item) => sum + item.quantity, 0),
    };
}

export async function processCheckout(user, data) {
    // A deterministic payload hash catches accidental reuse of a key for another request.
    const requestHash = createHash('sha256')
        .update(
            JSON.stringify(
                Object.fromEntries(
                    Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
                )
            )
        )
        .digest('hex');

    const order = await transaction(pool, async (client) => {
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [
            user.id,
        ]);
        const existing = await client.query(
            'SELECT * FROM orders WHERE user_id = $1 AND checkout_key = $2 FOR UPDATE',
            [user.id, data.idempotency_key]
        );
        if (existing.rows.length) {
            if (existing.rows[0].checkout_hash !== requestHash)
                throw new CheckoutError(
                    'Idempotency key was already used for a different checkout',
                    409
                );
            return existing.rows[0];
        }
        const preview = await quote(client, user.id, data, true);
        assertGatewayCurrency(data.gateway, preview.currency);

        if (data.expected_currency !== preview.currency || minorUnits(data.expected_total) !== minorUnits(preview.total))
        throw new CheckoutError(
            'Checkout total changed; refresh your checkout preview',
            409
        );
        const vendorIds = [
            ...new Set(preview.items.map((item) => item.vendor_id)),
        ].sort((a, b) => a - b);
        const commissionRates = new Map();
        for (const vendorId of vendorIds) {
            await lockProviderEntitlements(client, vendorId);
            const { plan } = await getProviderPlan(client, vendorId);
            commissionRates.set(vendorId, plan.commissionPercent);
        }
        const allocations = vendorSaleAllocations(
            preview.items,
            preview.coupon,
            preview.discount,
            commissionRates
        );

        const { rows } = await client.query(
            `INSERT INTO orders
            (user_id, order_number, subtotal, shipping_fee, discount, total, payment_method, note, currency_id, checkout_key, checkout_hash, contact_email, coupon_id, coupon_code)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
            RETURNING *`,
            [
                user.id,
                `ORD-${randomUUID()}`,
                preview.subtotal,
                preview.shipping_fee,
                preview.discount,
                preview.total,
                data.gateway,
                data.note ?? null,
                preview.currency_id,
                data.idempotency_key,
                requestHash,
                data.email,
                preview.coupon?.id ?? null,
                data.coupon_code ?? null,
            ]
        );
        
        const order = rows[0];
        if (preview.shipping_quotes.length) {
            const consumedQuotes = await client.query(
                `UPDATE shipbubble_rate_quotes SET order_id = $1
                 WHERE id = ANY($2::uuid[]) AND user_id = $3 AND order_id IS NULL
                 RETURNING id`,
                [
                    order.id,
                    preview.shipping_quotes.map((shippingQuote) => shippingQuote.id),
                    user.id,
                ]
            );
            if (consumedQuotes.rows.length !== preview.shipping_quotes.length)
                throw new CheckoutError(
                    'A selected ShipBubble rate was already used; request rates again',
                    409
                );
        }
        for (const item of preview.items) {
            await client.query(
                `INSERT INTO order_items
                    (order_id,vendor_id,product_id,variant_id,quantity,price,subtotal,
                     stock_reserved,shipbubble_category_id)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [
                    order.id,
                    item.vendor_id,
                    item.product_id,
                    item.variant_id,
                    item.quantity,
                    item.price,
                    item.subtotal,
                    item.track_inventory,
                    item.shipbubble_category_id ?? null,
                ]
            );
            if (item.track_inventory) {
                const table = item.variant_id ? 'product_variants' : 'products';
                const result = await client.query(
                    `UPDATE ${table} SET stock = stock - $1, updated_at = NOW() WHERE id = $2 AND stock >= $1 RETURNING id`,
                    [item.quantity, item.variant_id ?? item.product_id]
                );
                if (!result.rowCount)
                    throw new CheckoutError(
                        `Insufficient stock for ${item.product_name}`,
                        409
                    );
                await notifyLowStock(client, item);
            }
        }
        for (const allocation of allocations) {
            await client.query(
                `INSERT INTO vendor_order_fulfillments
                 (order_id, vendor_id, gross_amount, commission_rate, commission_amount, net_amount)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (order_id, vendor_id) DO NOTHING`,
                [
                    order.id,
                    allocation.vendorId,
                    allocation.grossAmount,
                    allocation.commissionRate,
                    allocation.commissionAmount,
                    allocation.netAmount,
                ]
            );
        }
        await client.query(
            `INSERT INTO vendor_order_fulfillment_history
             (fulfillment_id, status, note, changed_by)
             SELECT id, status, 'Checkout created', $2
             FROM vendor_order_fulfillments WHERE order_id = $1`,
            [order.id, user.id]
        );
        await client.query(
            `INSERT INTO shipping_addresses (order_id,user_id,firstname,lastname,phone_one,phone_two,address,city,state,country,zip_code)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
                order.id,
                user.id,
                data.firstname,
                data.lastname,
                data.phone_one,
                data.phone_two ?? null,
                data.address,
                data.city,
                data.state,
                data.country,
                data.zip_code ?? null,
            ]
        );
        if (preview.coupon) {
            await client.query(
                'UPDATE coupons SET usage_count = usage_count + 1 WHERE id = $1',
                [preview.coupon.id]
            );
            await client.query(
                'INSERT INTO coupon_usage (coupon_id,user_id,order_id) VALUES ($1,$2,$3)',
                [preview.coupon.id, user.id, order.id]
            );
        }
        await client.query('DELETE FROM cart_items WHERE cart_id = $1', [
            preview.cart_id,
        ]);
        await client.query(
            "INSERT INTO order_status_history (order_id,status,note,changed_by) VALUES ($1,'pending','Checkout created',$2)",
            [order.id, user.id]
        );

        if (minorUnits(order.total) === 0) {
            await client.query(
                "UPDATE orders SET payment_status = 'paid', status = 'processing' WHERE id = $1",
                [order.id]
            );
            await client.query(
                "UPDATE vendor_order_fulfillments SET status = 'processing', updated_at = NOW() WHERE order_id = $1",
                [order.id]
            );
            await client.query(
                `INSERT INTO vendor_order_fulfillment_history
                 (fulfillment_id, status, note, changed_by)
                 SELECT id, status, 'Zero-total checkout completed', $2
                 FROM vendor_order_fulfillments WHERE order_id = $1`,
                [order.id, user.id]
            );
            await client.query(
                "INSERT INTO order_status_history (order_id, status, note, changed_by) VALUES ($1, 'processing', 'Zero-total checkout completed', $2)",
                [order.id, user.id]
            );
            order.payment_status = 'paid';
            order.status = 'processing';
            await client.query(
                'INSERT INTO checkout_notifications (order_id) VALUES ($1) ON CONFLICT (order_id) DO NOTHING',
                [order.id]
            );
            await recordProductSale(client, order.id);
        }
        await notifyOrder(client, order, order.status, { vendors: order.payment_status === 'paid' });
        return order;
    });
    
    if (order.payment_status === 'paid') {
        return {
            order_id: order.id,
            total: order.total,
            payment_status: 'paid',
            status: order.status,
        };
    }

    try {
        const payment = await Payment.initiatePayment(
            user.id,
            order.id,
            order.payment_method
        );
        return {
            order_id: order.id,
            total: order.total,
            payment_status: payment.payment_status || 'unpaid',
            payment,
        };
    } catch (error) {
        // Creation has committed. Always preserve the order ID for recovery.
        return {
            order_id: order.id,
            total: order.total,
            payment_status: order.payment_status,
            payment: null,
            payment_error:
                error instanceof CheckoutError
                    ? error.message
                    : 'Payment provider unavailable; retry payment for this order',
            retryable:
                order.status === 'pending' &&
                new Date(order.reservation_expires_at) > new Date(),
        };
    }
}

export async function releaseReservation(client, order, reason) {
    const { rows } = await client.query(
        'SELECT * FROM order_items WHERE order_id = $1 AND stock_reserved = true ORDER BY product_id, id FOR UPDATE',
        [order.id]
    );
    for (const item of rows) {
        const table = item.variant_id ? 'product_variants' : 'products';
        await client.query(
            `UPDATE ${table} SET stock = stock + $1, updated_at = NOW() WHERE id = $2`,
            [item.quantity, item.variant_id ?? item.product_id]
        );
    }
    await client.query(
        'UPDATE order_items SET stock_reserved = false WHERE order_id = $1',
        [order.id]
    );
    const usage = await client.query(
        'DELETE FROM coupon_usage WHERE order_id = $1 RETURNING coupon_id',
        [order.id]
    );
    for (const row of usage.rows)
        await client.query(
            'UPDATE coupons SET usage_count = GREATEST(0, usage_count - 1) WHERE id = $1',
            [row.coupon_id]
        );
    await client.query(
        "UPDATE orders SET status = 'cancelled', reservation_expires_at = NULL, updated_at = NOW() WHERE id = $1",
        [order.id]
    );
    await client.query(
        `UPDATE shipbubble_rate_quotes
         SET booking_status = 'failed', processing_until = NULL,
             booking_error = COALESCE(booking_error, $2)
         WHERE order_id = $1 AND booking_status = 'unpaid'`,
        [order.id, String(reason).slice(0, 500)]
    );
    await client.query(
        "UPDATE vendor_order_fulfillments SET status = 'cancelled', updated_at = NOW() WHERE order_id = $1",
        [order.id]
    );
    await client.query(
        `INSERT INTO vendor_order_fulfillment_history
         (fulfillment_id, status, note)
         SELECT id, status, $2 FROM vendor_order_fulfillments WHERE order_id = $1`,
        [order.id, reason]
    );
    await client.query(
        "INSERT INTO order_status_history (order_id,status,note) VALUES ($1,'cancelled',$2)",
        [order.id, reason]
    );
    await notifyOrder(client, order, 'cancelled');
}

export async function expireReservations() {
    return transaction(pool, async (client) => {
        const { rows } =
            await client.query(`SELECT * FROM orders WHERE status = 'pending' AND payment_status = 'unpaid'
            AND reservation_expires_at <= NOW() ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`);
        for (const order of rows)
            await releaseReservation(
                client,
                order,
                'Unpaid reservation expired'
            );
        return rows.length;
    });
}
