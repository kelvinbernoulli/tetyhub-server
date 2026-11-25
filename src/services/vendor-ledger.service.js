import { minorUnits } from '#utils/checkout.js';

const money = (value) => minorUnits(String(value ?? '0'));

function allocate(total, weights) {
    const amount = BigInt(total);
    const normalized = weights.map((weight) => BigInt(weight));
    const denominator = normalized.reduce((sum, weight) => sum + weight, 0n);
    if (denominator === 0n) return normalized.map(() => 0n);
    let used = 0n;
    return normalized.map((weight, index) => {
        if (index === normalized.length - 1) return amount - used;
        const part = (amount * weight) / denominator;
        used += part;
        return part;
    });
}

async function insertEntry(client, entry) {
    if (entry.amountMinor === 0n) return;
    await client.query(
        `INSERT INTO vendor_ledger_entries
        (vendor_id,order_id,order_item_id,booking_id,payout_id,entry_type,amount_minor,currency,idempotency_key,metadata)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
        ON CONFLICT (idempotency_key) DO NOTHING`,
        [
            entry.vendorId,
            entry.orderId ?? null,
            entry.orderItemId ?? null,
            entry.bookingId ?? null,
            entry.payoutId ?? null,
            entry.type,
            entry.amountMinor.toString(),
            entry.currency,
            entry.idempotencyKey,
            JSON.stringify(entry.metadata ?? {}),
        ]
    );
}

async function getCommissionPlan(client, vendorId) {
    const { rows } = await client.query(
        `SELECT pv.plan::text AS plan,pv.version,pv.commission_percent::text AS commission_percent
        FROM subscriptions s
        JOIN plan_versions pv ON pv.plan = s.plan AND pv.version = s.plan_version
        WHERE s.provider_id = $1
            AND (
                s.status IN ('active','trialing')
                OR (s.status = 'past_due' AND s.grace_ends_at > NOW())
                OR (s.status = 'cancelled' AND s.cancel_at_period_end = TRUE
                    AND s.current_period_end > NOW())
            )
        ORDER BY s.updated_at DESC,s.id DESC
        LIMIT 1`,
        [vendorId]
    );
    if (rows[0]) return rows[0];

    const fallback = await client.query(
        `SELECT plan::text AS plan,version,commission_percent::text AS commission_percent
        FROM plan_versions
        WHERE plan = 'FREE' AND is_current = TRUE
        ORDER BY version DESC
        LIMIT 1`
    );
    if (!fallback.rows[0])
        throw new Error('No active vendor subscription or current FREE commission plan found');
    return fallback.rows[0];
}

function calculateCommissionMinor(amountMinor, commissionPercent) {
    const percent = String(commissionPercent);
    const [whole, fraction = ''] = percent.split('.');
    if (!/^\d+$/.test(whole) || !/^\d*$/.test(fraction))
        throw new Error(`Invalid commission percentage: ${percent}`);
    const denominator = 100n * 10n ** BigInt(fraction.length);
    const numerator = BigInt(whole + fraction) * BigInt(amountMinor);
    return (numerator + denominator / 2n) / denominator;
}

export async function recordOrderEarnings(client, orderId) {
    const order = (
        await client.query(
            `SELECT o.id,o.subtotal,o.discount,o.tax,c.code AS currency
            FROM orders o JOIN currencies c ON c.id = o.currency_id
            WHERE o.id = $1`,
            [orderId]
        )
    ).rows[0];
    if (!order) return;

    const { rows: items } = await client.query(
        `SELECT oi.id,oi.vendor_id,oi.subtotal
        FROM order_items oi
        WHERE oi.order_id = $1 ORDER BY oi.id`,
        [orderId]
    );
    if (!items.length) return;

    const weights = items.map((item) => BigInt(money(item.subtotal)));
    const discounts = allocate(money(order.discount), weights);
    const taxes = allocate(money(order.tax), weights);

    for (let index = 0; index < items.length; index++) {
        const item = items[index];
        const saleMinor = weights[index] - discounts[index];
        const taxMinor = taxes[index];
        const commissionPlan = await getCommissionPlan(client, item.vendor_id);
        const rate = String(commissionPlan.commission_percent);
        const rateNumber = Number(rate);
        if (!Number.isFinite(rateNumber) || rateNumber < 0 || rateNumber > 100)
            throw new Error(`Invalid commission rate for vendor ${item.vendor_id}`);
        const commissionMinor = calculateCommissionMinor(saleMinor, rate);
        await insertEntry(client, {
            vendorId: item.vendor_id,
            orderId,
            orderItemId: item.id,
            type: 'credit_sale',
            amountMinor: saleMinor,
            currency: order.currency,
            idempotencyKey: `order-item:${item.id}:sale`,
        });
        await insertEntry(client, {
            vendorId: item.vendor_id,
            orderId,
            orderItemId: item.id,
            type: 'debit_commission',
            amountMinor: -commissionMinor,
            currency: order.currency,
            idempotencyKey: `order-item:${item.id}:commission`,
            metadata: {
                commission_rate_percent: rate,
                commission_plan: commissionPlan.plan,
                commission_plan_version: commissionPlan.version,
            },
        });
        await insertEntry(client, {
            vendorId: item.vendor_id,
            orderId,
            orderItemId: item.id,
            type: 'debit_tax',
            amountMinor: -taxMinor,
            currency: order.currency,
            idempotencyKey: `order-item:${item.id}:tax`,
        });
    }
}

export async function recordBookingEarnings(client, bookingId) {
    const booking = (
        await client.query(
        `SELECT b.id,b.vendor_id,b.total,c.code AS currency
            FROM service_bookings b
            JOIN currencies c ON c.id = b.currency_id
            WHERE b.id = $1`,
            [bookingId]
        )
    ).rows[0];
    if (!booking) return;
    const saleMinor = BigInt(money(booking.total));
    const commissionPlan = await getCommissionPlan(client, booking.vendor_id);
    const rate = String(commissionPlan.commission_percent);
    const rateNumber = Number(rate);
    if (!Number.isFinite(rateNumber) || rateNumber < 0 || rateNumber > 100)
        throw new Error(`Invalid commission rate for vendor ${booking.vendor_id}`);
    const commissionMinor = calculateCommissionMinor(saleMinor, rate);
    await insertEntry(client, {
        vendorId: booking.vendor_id,
        bookingId,
        type: 'credit_sale',
        amountMinor: saleMinor,
        currency: booking.currency,
        idempotencyKey: `booking:${bookingId}:sale`,
    });
    await insertEntry(client, {
        vendorId: booking.vendor_id,
        bookingId,
        type: 'debit_commission',
        amountMinor: -commissionMinor,
        currency: booking.currency,
        idempotencyKey: `booking:${bookingId}:commission`,
        metadata: {
            commission_rate_percent: rate,
            commission_plan: commissionPlan.plan,
            commission_plan_version: commissionPlan.version,
        },
    });
}

export async function eligibleBalanceMinor(client, vendorId, currency = 'NGN') {
    const { rows } = await client.query(
        `WITH active_return_quantities AS (
            SELECT ri.order_item_id, LEAST(oi.quantity, SUM(ri.quantity)) AS quantity
            FROM return_items ri
            JOIN returns r ON r.id = ri.return_id
            JOIN order_items oi ON oi.id = ri.order_item_id
            WHERE r.status IN ('pending','approved','awaiting_pickup','item_received','processing')
            GROUP BY ri.order_item_id, oi.quantity
        ), eligible_entries AS (
            SELECT le.amount_minor::numeric AS amount_minor,
                CASE
                    WHEN le.order_item_id IS NOT NULL
                        AND o.delivered_at <= NOW() - INTERVAL '7 days'
                        THEN ROUND(
                            le.amount_minor::numeric * (oi.quantity - COALESCE(arq.quantity,0)) / oi.quantity,
                            0
                        )
                    WHEN le.order_item_id IS NOT NULL THEN 0
                    WHEN le.booking_id IS NOT NULL
                        AND b.completed_at <= NOW() - INTERVAL '7 days'
                        THEN le.amount_minor::numeric
                    WHEN le.booking_id IS NOT NULL THEN 0
                    WHEN le.available_at IS NULL OR le.available_at <= NOW()
                        THEN le.amount_minor::numeric
                    ELSE 0
                END AS eligible_minor
            FROM vendor_ledger_entries le
            LEFT JOIN order_items oi ON oi.id = le.order_item_id
            LEFT JOIN orders o ON o.id = le.order_id
            LEFT JOIN active_return_quantities arq ON arq.order_item_id = oi.id
            LEFT JOIN service_bookings b ON b.id = le.booking_id
            WHERE le.vendor_id = $1 AND le.currency = $2
        )
        SELECT ROUND(
            COALESCE(SUM(eligible_minor),0) - COALESCE((
                SELECT SUM(h.amount_minor)::numeric FROM vendor_payout_holds h
                WHERE h.vendor_id = $1 AND h.currency = $2 AND h.status = 'open'
            ),0),
            0
        )::text AS balance_minor
        FROM eligible_entries`,
        [vendorId, currency]
    );
    return BigInt(rows[0].balance_minor);
}

export async function recordPayoutLedgerEntry(client, {
    vendorId,
    payoutId,
    type,
    amountMinor,
    idempotencyKey,
    metadata = {},
}) {
    await insertEntry(client, {
        vendorId,
        payoutId,
        type,
        amountMinor: BigInt(amountMinor),
        currency: 'NGN',
        idempotencyKey,
        metadata,
    });
}

export async function recordTaxDeduction(client, {
    vendorId,
    amountMinor,
    idempotencyKey,
    reference,
    createdByUserId,
}) {
    await insertEntry(client, {
        vendorId,
        type: 'debit_tax',
        amountMinor: -BigInt(amountMinor),
        currency: 'NGN',
        idempotencyKey,
        metadata: { reference, created_by_user_id: createdByUserId },
    });
}

export async function recordProviderFee(client, payout, feeMinor) {
    const fee = BigInt(feeMinor ?? 0);
    if (fee <= 0n) return;
    await client.query(
        `UPDATE payouts SET transfer_fee_minor = $1, updated_at = NOW() WHERE id = $2`,
        [fee.toString(), payout.id]
    );
    await recordPayoutLedgerEntry(client, {
        vendorId: payout.vendor_id,
        payoutId: payout.id,
        type: 'debit_transfer_fee',
        amountMinor: -fee,
        idempotencyKey: `payout:${payout.id}:transfer-fee`,
        metadata: { provider: 'paystack' },
    });
}

export async function recordRefundDebit(client, {
    transactionReference,
    amountMinor,
    idempotencyKey,
    type = 'debit_refund',
    direction = -1,
}) {
    const { rows: orderRows } = await client.query(
        `SELECT o.id,o.currency_id,c.code AS currency
        FROM payments p JOIN orders o ON o.id = p.order_id
        JOIN currencies c ON c.id = o.currency_id
        WHERE p.gateway = 'paystack' AND (p.gateway_ref = $1 OR p.provider_ref = $1)
        LIMIT 1`,
        [transactionReference]
    );
    const order = orderRows[0];
    if (!order) return false;
    const { rows: items } = await client.query(
        `SELECT oi.id,oi.vendor_id,oi.subtotal,
            COALESCE(SUM(le.amount_minor) FILTER (WHERE le.entry_type IN ('credit_sale','debit_commission','debit_tax')),0)::text AS vendor_net_minor
        FROM order_items oi
        LEFT JOIN vendor_ledger_entries le ON le.order_item_id = oi.id
        WHERE oi.order_id = $1 GROUP BY oi.id ORDER BY oi.id`,
        [order.id]
    );
    if (!items.length) return false;
    const orderGross = items.reduce((sum, item) => sum + BigInt(money(item.subtotal)), 0n);
    if (orderGross <= 0n) return false;
    const refunded = BigInt(amountMinor);
    for (const item of items) {
        const vendorNet = BigInt(item.vendor_net_minor);
        if (vendorNet <= 0n) continue;
        const vendorShare = (refunded * vendorNet) / orderGross;
        if (vendorShare <= 0n) continue;
        await insertEntry(client, {
            vendorId: item.vendor_id,
            orderId: order.id,
            orderItemId: item.id,
            type,
            amountMinor: BigInt(direction) * vendorShare,
            currency: order.currency,
            idempotencyKey: `${idempotencyKey}:item:${item.id}`,
            metadata: { provider: 'paystack', transaction_reference: transactionReference },
        });
    }
    return true;
}

export async function createChargebackHold(client, {
    transactionReference,
    disputeId,
    amountMinor,
    currency = 'NGN',
}) {
    const { rows: orderRows } = await client.query(
        `SELECT o.id,c.code AS currency
        FROM payments p JOIN orders o ON o.id = p.order_id
        JOIN currencies c ON c.id = o.currency_id
        WHERE p.gateway = 'paystack' AND (p.gateway_ref = $1 OR p.provider_ref = $1)
        LIMIT 1`,
        [transactionReference]
    );
    const order = orderRows[0];
    if (!order) return false;
    const { rows: items } = await client.query(
        `SELECT oi.id,oi.vendor_id,oi.subtotal,
            COALESCE(SUM(le.amount_minor) FILTER (WHERE le.entry_type IN ('credit_sale','debit_commission','debit_tax')),0)::text AS vendor_net_minor
        FROM order_items oi
        LEFT JOIN vendor_ledger_entries le ON le.order_item_id = oi.id
        WHERE oi.order_id = $1 GROUP BY oi.id ORDER BY oi.id`,
        [order.id]
    );
    if (!items.length) return false;
    const orderGross = items.reduce((sum, item) => sum + BigInt(money(item.subtotal)), 0n);
    if (orderGross <= 0n) return false;
    for (const item of items) {
        const vendorNet = BigInt(item.vendor_net_minor);
        const share = (BigInt(amountMinor) * vendorNet) / orderGross;
        if (share <= 0n) continue;
        await client.query(
            `INSERT INTO vendor_payout_holds
                (vendor_id,order_id,order_item_id,provider_dispute_id,amount_minor,currency)
            VALUES ($1,$2,$3,$4,$5,$6)
            ON CONFLICT (provider_dispute_id,order_item_id) DO NOTHING`,
            [item.vendor_id, order.id, item.id, String(disputeId), share.toString(), currency]
        );
    }
    return true;
}

export async function resolveChargebackHold(client, {
    disputeId,
    resolution,
    amountMinor = null,
}) {
    const status = resolution === 'declined'
        ? 'released'
        : resolution === 'merchant-accepted'
            ? 'debited'
            : null;
    if (!status) return false;
    const { rows: holds } = await client.query(
        `SELECT * FROM vendor_payout_holds
        WHERE provider_dispute_id = $1 AND status = 'open' FOR UPDATE`,
        [String(disputeId)]
    );
    const totalHeld = holds.reduce((sum, hold) => sum + BigInt(hold.amount_minor), 0n);
    const resolutionAmount = amountMinor == null
        ? totalHeld
        : BigInt(amountMinor);
    let allocated = 0n;
    for (let index = 0; index < holds.length; index++) {
        const hold = holds[index];
        if (status === 'debited') {
            const debitAmount = index === holds.length - 1
                ? resolutionAmount - allocated
                : totalHeld > 0n
                    ? (resolutionAmount * BigInt(hold.amount_minor)) / totalHeld
                    : 0n;
            allocated += debitAmount;
            await insertEntry(client, {
                vendorId: hold.vendor_id,
                orderId: hold.order_id,
                orderItemId: hold.order_item_id,
                type: 'debit_chargeback',
                amountMinor: -debitAmount,
                currency: hold.currency,
                idempotencyKey: `chargeback:${disputeId}:item:${hold.order_item_id}`,
                metadata: { provider: 'paystack', resolution_amount_minor: resolutionAmount.toString() },
            });
        }
        await client.query(
            `UPDATE vendor_payout_holds SET status = $2,updated_at = NOW() WHERE id = $1`,
            [hold.id, status]
        );
    }
    return true;
}
