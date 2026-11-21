import { randomUUID } from 'node:crypto';
import pool from '#services/pg_pool.js';
import { transaction } from '#utils/checkout.js';
import Notification from '#models/notification.model.js';
import { platformRecipients, vendorRecipients } from '#services/notifications.js';
import { createPaystackTransferRecipient, finalizePaystackTransfer, initiatePaystackTransfer } from '#utils/payment.js';

async function notifyPayoutStatus(client,payout,status,message) {
    const vendors=await vendorRecipients(client,[Number(payout.vendor_id)],'transactions');
    const admins=await platformRecipients(client,'transactions');
    await Notification.createMany([...new Set([...vendors,...admins])],'transactions',
        status==='paid'?'Vendor payout sent':status==='reversed'?'Vendor payout reversed':'Vendor payout failed',
        message,{payout_id:String(payout.id),status},client);
}

async function addLedgerEntry(client,{vendorId,batchId,payoutId,currencyId,entryType,amountMinor,key,metadata=null}) {
    if(!Number.isSafeInteger(Number(amountMinor))||Number(amountMinor)===0)return;
    await client.query(
        `INSERT INTO vendor_ledger_entries
         (vendor_id,payout_batch_id,payout_id,currency_id,entry_type,amount_minor,idempotency_key,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (idempotency_key) DO NOTHING`,
        [vendorId,batchId,payoutId,currencyId,entryType,amountMinor,key,metadata?JSON.stringify(metadata):null]);
}

function transferFeeMinor(currency, amountMinor) {
    let schedules;
    try {
        schedules = JSON.parse(process.env.PAYSTACK_TRANSFER_FEE_SCHEDULE || '{}');
    } catch {
        throw new Error('PAYSTACK_TRANSFER_FEE_SCHEDULE must be valid JSON');
    }
    const schedule = schedules[currency];
    if (!schedule || !Array.isArray(schedule.tiers) || !schedule.tiers.length)
        throw new Error(`No Paystack transfer fee schedule is configured for ${currency}`);
    const tier = schedule.tiers.find((item) => item.max_minor == null || amountMinor <= Number(item.max_minor));
    if (!tier || !Number.isSafeInteger(Number(tier.fee_minor)) || Number(tier.fee_minor) < 0)
        throw new Error(`Paystack transfer fee schedule is invalid for ${currency}`);
    const stampDuty = schedule.stamp_duty && amountMinor >= Number(schedule.stamp_duty.threshold_minor)
        ? Number(schedule.stamp_duty.fee_minor)
        : 0;
    return Number(tier.fee_minor) + stampDuty;
}

export function canCreatePayoutBatch(vendor, { onDemand = false, now = new Date() } = {}) {
    if (onDemand) return vendor?.payout_mode === 'manual';
    if (vendor?.payout_mode !== 'automatic' || !vendor.next_payout_at) return false;
    const nextPayoutAt = new Date(vendor.next_payout_at);
    return !Number.isNaN(nextPayoutAt.getTime()) && nextPayoutAt <= now;
}

export function normalizePayoutPreferences(current, input) {
    const validModes = ['manual', 'automatic'];
    const validCadences = ['weekly', 'bi_weekly', 'monthly'];
    if (input.payoutMode !== undefined && !validModes.includes(input.payoutMode))
        throw Object.assign(new Error('payout_mode must be manual or automatic'), { status: 400 });
    if (input.payoutCadence !== undefined && !validCadences.includes(input.payoutCadence))
        throw Object.assign(new Error('payout_cadence must be weekly, bi_weekly, or monthly'), { status: 400 });
    if (input.minimumPayoutMinor !== undefined &&
        (!Number.isSafeInteger(input.minimumPayoutMinor) || input.minimumPayoutMinor < 0))
        throw Object.assign(new Error('minimum_payout_minor must be a non-negative integer'), { status: 400 });

    return {
        payoutMode: input.payoutMode ?? current.payout_mode ?? 'manual',
        payoutCadence: input.payoutCadence ?? current.payout_cadence ?? 'weekly',
        minimumPayoutMinor: input.minimumPayoutMinor,
        resetSchedule: input.payoutMode !== undefined || input.payoutCadence !== undefined,
    };
}

export async function createTransferRecipient(vendorId, data) {
    const { rows: [vendor] } = await pool.query(
        `SELECT v.id, v.verification_status, v.status, u.email
         FROM vendors v JOIN users u ON u.id = v.user_id WHERE v.id = $1`,
        [vendorId]
    );
    if (!vendor || vendor.status !== 'active' || vendor.verification_status !== 'verified')
        throw Object.assign(new Error('A verified active vendor is required for payouts.'), { status: 409 });
    const recipient = await createPaystackTransferRecipient(data);
    await pool.query(
        `UPDATE vendors SET paystack_recipient_code = $2, updated_at = NOW() WHERE id = $1`,
        [vendorId, recipient.recipient_code]
    );
    return {
        recipient_code: recipient.recipient_code,
        recipient_name: recipient.name,
        account_name: recipient.details?.account_name ?? null,
        account_number_last4: String(recipient.details?.account_number ?? '').slice(-4),
        bank_name: recipient.details?.bank_name ?? null,
    };
}

export async function createPayoutBatch(vendorId, { onDemand = false } = {}) {
    return transaction(pool, async (client) => {
        const { rows: [vendor] } = await client.query(
            `SELECT id, verification_status, status, paystack_recipient_code,
                    payout_mode, payout_cadence, next_payout_at,
                    minimum_payout_minor, tax_rate_bps
             FROM vendors WHERE id = $1 FOR UPDATE`, [vendorId]
        );
        if (!vendor || vendor.status !== 'active' || vendor.verification_status !== 'verified')
            throw Object.assign(new Error('Vendor is not eligible for payouts.'), { status: 409 });
        if (!vendor.paystack_recipient_code)
            throw Object.assign(new Error('Add and verify a payout bank account first.'), { status: 409 });
        if (!canCreatePayoutBatch(vendor, { onDemand })) {
            const message = onDemand
                ? 'Switch to manual payout mode to request an on-demand payout.'
                : 'An automatic payout is not due.';
            throw Object.assign(new Error(message), { status: 409 });
        }

        const { rows: balances } = await client.query(
            `SELECT le.currency_id, c.code AS currency,
                    COALESCE(SUM(le.amount_minor), 0)::bigint AS ledger_balance
             FROM vendor_ledger_entries le
             JOIN currencies c ON c.id = le.currency_id
             WHERE le.vendor_id = $1
             GROUP BY le.currency_id, c.code
             HAVING SUM(le.amount_minor) > 0
`, [vendorId]
        );
        const created = [];
        for (const balance of balances) {
            const available = Number(balance.ledger_balance);
            if (!Number.isSafeInteger(available) || available <= 0) continue;
            const tax = Math.round(available * Number(vendor.tax_rate_bps) / 10000);
            const fee = transferFeeMinor(balance.currency, available - tax);
            const transferAmount = available - tax - fee;
            if (transferAmount < Number(vendor.minimum_payout_minor) || transferAmount <= 0) continue;
            const reference = `batch-${vendorId}-${balance.currency_id}-${randomUUID()}`;
            const { rows: [batch] } = await client.query(
                `INSERT INTO payout_batches
                 (vendor_id, currency_id, reference, cadence, status, gross_amount_minor,
                  transfer_fee_minor, tax_amount_minor, payout_amount_minor)
                 VALUES ($1,$2,$3,$4,'pending',$5,$6,$7,$8) RETURNING *`,
                [vendorId, balance.currency_id, reference, onDemand ? 'on_demand' : vendor.payout_cadence,
                    available, fee, tax, transferAmount]
            );
            const payoutReference = `transfer-${batch.id}-${vendorId}`;
            const { rows: [payout] } = await client.query(
                `INSERT INTO payouts
                 (vendor_id, batch_id, currency_id, reference, amount_minor, transfer_fee_minor, tax_amount_minor, status)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
                [vendorId, batch.id, balance.currency_id, payoutReference, transferAmount, fee, tax]
            );
            await addLedgerEntry(client,{vendorId,batchId:batch.id,payoutId:payout.id,currencyId:balance.currency_id,entryType:'vendor_payout_debit',amountMinor:-transferAmount,key:'payout:'+payout.id+':principal'});
            await addLedgerEntry(client,{vendorId,batchId:batch.id,payoutId:payout.id,currencyId:balance.currency_id,entryType:'vendor_transfer_fee_debit',amountMinor:-fee,key:'payout:'+payout.id+':transfer-fee'});
            await addLedgerEntry(client,{vendorId,batchId:batch.id,payoutId:payout.id,currencyId:balance.currency_id,entryType:'vendor_tax_withholding',amountMinor:-tax,key:'payout:'+payout.id+':tax'});
            created.push({ ...payout, batch_id: batch.id });
        }
        if (!onDemand) {
            await client.query(
                `UPDATE vendors
                 SET next_payout_at = CASE payout_cadence
                     WHEN 'weekly' THEN
                         ((date_trunc('week', NOW() AT TIME ZONE 'Africa/Lagos') + INTERVAL '1 week') AT TIME ZONE 'Africa/Lagos')
                     WHEN 'bi_weekly' THEN
                         next_payout_at + ((FLOOR(GREATEST(0, EXTRACT(EPOCH FROM (NOW() - next_payout_at))) / 1209600) + 1)::double precision * INTERVAL '14 days')
                     WHEN 'monthly' THEN
                         ((date_trunc('month', NOW() AT TIME ZONE 'Africa/Lagos') + INTERVAL '1 month') AT TIME ZONE 'Africa/Lagos')
                     ELSE NULL
                 END,
                 updated_at = NOW()
                 WHERE id = $1`, [vendorId]
            );
        }
        if (!created.length && onDemand)
            throw Object.assign(new Error('There is no eligible balance above the payout threshold.'), { status: 409 });
        return created;
    });
}

export async function scheduleDuePayoutBatches() {
    const { rows } = await pool.query(
        `SELECT id FROM vendors WHERE status = 'active' AND verification_status = 'verified'
         AND payout_mode = 'automatic' AND next_payout_at <= NOW()
         AND paystack_recipient_code IS NOT NULL
         ORDER BY next_payout_at, id`
    );
    let count = 0;
    for (const vendor of rows) {
        try {
            count += (await createPayoutBatch(vendor.id)).length;
        } catch (error) {
            if (error.status !== 409)
                console.error('Scheduled vendor payout batch failed:', vendor.id, error.message);
        }
    }
    return count;
}

export async function processPendingTransfers({ batchSize = 20 } = {}) {
    const { rows } = await pool.query(
        `WITH ready AS (
            SELECT p.id FROM payouts p JOIN vendors v ON v.id = p.vendor_id
            WHERE p.status = 'pending' AND v.paystack_recipient_code IS NOT NULL
              AND v.verification_status = 'verified' AND v.status = 'active'
            ORDER BY p.created_at FOR UPDATE OF p SKIP LOCKED LIMIT $1
         )
         UPDATE payouts p SET status = 'processing', attempts = attempts + 1,
             processed_at = COALESCE(processed_at, NOW()), updated_at = NOW()
         FROM ready WHERE p.id = ready.id RETURNING p.*`, [batchSize]
    );
    for (const payout of rows) {
        try {
            const { rows: [vendor] } = await pool.query(
                `SELECT v.paystack_recipient_code, c.code AS currency
                 FROM vendors v JOIN currencies c ON c.id = $2 WHERE v.id = $1`,
                [payout.vendor_id, payout.currency_id]
            );
            const transfer = await initiatePaystackTransfer({
                amountMinor: Number(payout.amount_minor),
                recipientCode: vendor.paystack_recipient_code,
                reference: payout.reference,
                currency: vendor.currency,
                reason: `Vendor payout ${payout.reference}`,
            });
            await pool.query(
                `UPDATE payouts SET provider_reference = $2, transfer_code = $3,
                    failure_message = CASE WHEN $4 = 'otp' THEN 'Paystack requires transfer authorization' ELSE NULL END,
                    updated_at = NOW() WHERE id = $1`,
                [payout.id, transfer.reference ?? payout.reference, transfer.transfer_code ?? null, transfer.status ?? 'pending']
            );

            await pool.query(`UPDATE payout_batches SET status = 'processing', processed_at = COALESCE(processed_at, NOW()) WHERE id = $1`, [payout.batch_id]);        } catch (error) {
            if (!error.response || Number(error.response.status) >= 500 || Number(error.response.status) === 429) {
                await pool.query(
                    `UPDATE payouts SET failure_message = $2, updated_at = NOW()
                     WHERE id = $1 AND status = 'processing'`,
                    [payout.id, 'Transfer result is uncertain; awaiting provider reconciliation']
                );
            } else {
                await failPayout(payout, error);
            }
        }
    }
    return rows.length;
}

async function failPayout(payout, error) {
    await transaction(pool, async (client) => {
        const { rows: [current] } = await client.query('SELECT * FROM payouts WHERE id = $1 FOR UPDATE', [payout.id]);
        if (!current || current.status !== 'processing') return;
        await client.query(
            `UPDATE payouts SET status = 'failed', failure_code = $2, failure_message = $3, updated_at = NOW()
             WHERE id = $1`, [payout.id, error.code ? String(error.code).slice(0, 80) : null, String(error.message).slice(0, 500)]
        );
        await addLedgerEntry(client,{vendorId:current.vendor_id,batchId:current.batch_id,payoutId:current.id,currencyId:current.currency_id,entryType:'payout_failure_release',amountMinor:Number(current.amount_minor),key:'payout:'+current.id+':principal-release',metadata:{failure_code:error.code??null}});
        await addLedgerEntry(client,{vendorId:current.vendor_id,batchId:current.batch_id,payoutId:current.id,currencyId:current.currency_id,entryType:'payout_fee_failure_release',amountMinor:Number(current.transfer_fee_minor),key:'payout:'+current.id+':fee-release'});
        await client.query(`UPDATE payout_batches SET status = 'failed' WHERE id = $1`, [current.batch_id]);
        await notifyPayoutStatus(client,current,'failed','A vendor payout failed and needs review.');
        console.error('Vendor payout failed:', String(current.id), error.code ?? '', error.message);
    });
}

export async function reconcileTransferEvent(event) {
    const payoutReference = event.reference;
    if (!payoutReference) throw new Error('Paystack transfer event has no reference');
    return transaction(pool, async (client) => {
        const { rows: [payout] } = await client.query(
            `SELECT p.* FROM payouts p WHERE p.reference = $1 OR p.provider_reference = $1 FOR UPDATE`,
            [payoutReference]
        );
        if (!payout) return;
        if (event.event_type === 'transfer.success') {
            if (['failed', 'reversed', 'paid'].includes(payout.status)) return;
            await client.query(
                `UPDATE payouts SET status = 'paid', paid_at = NOW(), updated_at = NOW(),
                    failure_code = NULL, failure_message = NULL WHERE id = $1`, [payout.id]
            );
            await client.query(
                `UPDATE payout_batches SET status = 'paid', completed_at = NOW() WHERE id = $1`, [payout.batch_id]
            );
            await notifyPayoutStatus(client,payout,'paid','Your vendor payout has been sent.');
        } else if (event.event_type === 'transfer.failed') {
            if (['failed', 'paid', 'reversed'].includes(payout.status)) return;
            await client.query(
                `UPDATE payouts SET status = 'failed', failure_code = $2, failure_message = $3,
                    updated_at = NOW() WHERE id = $1`,
                [payout.id, event.event_status ?? 'transfer_failed', 'Paystack reported transfer failure']
            );
            await addLedgerEntry(client,{vendorId:payout.vendor_id,batchId:payout.batch_id,payoutId:payout.id,currencyId:payout.currency_id,entryType:'payout_failure_release',amountMinor:Number(payout.amount_minor),key:'payout:'+payout.id+':principal-release'});
            await addLedgerEntry(client,{vendorId:payout.vendor_id,batchId:payout.batch_id,payoutId:payout.id,currencyId:payout.currency_id,entryType:'payout_fee_failure_release',amountMinor:Number(payout.transfer_fee_minor),key:'payout:'+payout.id+':fee-release'});
            await client.query(`UPDATE payout_batches SET status = 'failed' WHERE id = $1`, [payout.batch_id]);
            await notifyPayoutStatus(client,payout,'failed','A vendor payout failed and needs review.');
            console.error('Paystack transfer failed:', payout.reference, event.event_status ?? 'unknown');
        } else if (event.event_type === 'transfer.reversed') {
            if (payout.status !== 'paid') return;
            await client.query(
                `UPDATE payouts SET status = 'reversed', reversed_at = NOW(), updated_at = NOW()
                 WHERE id = $1`, [payout.id]
            );
            await client.query(
                `INSERT INTO vendor_ledger_entries
                 (vendor_id, payout_batch_id, payout_id, currency_id, entry_type, amount_minor, idempotency_key)
                 VALUES ($1,$2,$3,$4,'payout_reversal_credit',$5,$6)
                 ON CONFLICT (idempotency_key) DO NOTHING`,
                [payout.vendor_id, payout.batch_id, payout.id, payout.currency_id, payout.amount_minor,
                    `payout:${payout.id}:reversal-credit`]
            );
            await client.query(`UPDATE payout_batches SET status = 'reversed' WHERE id = $1`, [payout.batch_id]);
            await notifyPayoutStatus(client,payout,'reversed','Paystack reversed a vendor payout; the amount was returned to your balance.');
        }
    });
}

export async function payoutSummary(vendorId) {
    const { rows: payouts } = await pool.query(
        `SELECT p.status, p.currency_id, c.code AS currency, COUNT(*)::int AS count,
                COALESCE(SUM(p.amount_minor),0)::bigint AS amount_minor
         FROM payouts p JOIN currencies c ON c.id=p.currency_id
         WHERE p.vendor_id=$1 GROUP BY p.status,p.currency_id,c.code`, [vendorId]
    );
    const { rows: balances } = await pool.query(
        `SELECT c.id AS currency_id,c.code AS currency,COALESCE(SUM(le.amount_minor),0)::bigint AS available_minor
         FROM vendor_ledger_entries le JOIN currencies c ON c.id=le.currency_id
         WHERE le.vendor_id=$1 GROUP BY c.id,c.code HAVING SUM(le.amount_minor)<>0`, [vendorId]
    );
    const { rows: [payout_preferences] } = await pool.query(
        `SELECT payout_mode, payout_cadence, next_payout_at, minimum_payout_minor
         FROM vendors WHERE id = $1`, [vendorId]
    );
    return { payouts, available_balances: balances, payout_preferences: payout_preferences ?? null };
}

export async function listPayouts(vendorId, { limit = 20, offset = 0 } = {}) {
    const { rows } = await pool.query(
        `SELECT p.id, p.batch_id, p.reference, p.amount_minor, p.transfer_fee_minor,
                p.status, p.failure_code, p.failure_message, p.created_at, p.processed_at,
                p.paid_at, p.reversed_at, p.currency_id, c.code AS currency
         FROM payouts p JOIN currencies c ON c.id = p.currency_id
         WHERE p.vendor_id = $1 ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
        [vendorId, Math.min(100, Math.max(1, Number(limit) || 20)), Math.max(0, Number(offset) || 0)]
    );
    return rows;
}
export async function listAllPayouts({ status, limit = 50, offset = 0 } = {}) {
    const params=[];let where='';
    if(status){params.push(status);where='WHERE p.status = $1';}
    params.push(Math.min(100,Math.max(1,Number(limit)||50)),Math.max(0,Number(offset)||0));
    const limitIndex=params.length-1;const offsetIndex=params.length;
    const {rows}=await pool.query(
        'SELECT p.id,p.vendor_id,p.batch_id,p.reference,p.provider_reference,p.amount_minor,'+
        'p.transfer_fee_minor,p.status,p.failure_code,p.failure_message,p.created_at,p.paid_at,'+
        'c.code AS currency FROM payouts p JOIN currencies c ON c.id=p.currency_id '+where+
        ' ORDER BY p.created_at DESC LIMIT $'+limitIndex+' OFFSET $'+offsetIndex,params);
    return rows;
}

export async function updateVendorTaxRate(vendorId, taxRateBps) {
    if(!Number.isInteger(taxRateBps)||taxRateBps<0||taxRateBps>10000)
        throw Object.assign(new Error('tax_rate_bps must be an integer from 0 to 10000'),{status:400});
    const {rows}=await pool.query(
        'UPDATE vendors SET tax_rate_bps=$2,updated_at=NOW() WHERE id=$1 RETURNING id,tax_rate_bps',
        [vendorId,taxRateBps]);
    if(!rows[0])throw Object.assign(new Error('Vendor not found'),{status:404});
    return rows[0];
}

export async function updatePayoutPreferences(vendorId, { payoutMode, payoutCadence, minimumPayoutMinor }) {
    return transaction(pool,async(client)=>{
        const {rows:[current]}=await client.query(
            'SELECT payout_mode,payout_cadence FROM vendors WHERE id=$1 FOR UPDATE',[vendorId]);
        if(!current)throw Object.assign(new Error('Vendor not found'),{status:404});
        const preferences=normalizePayoutPreferences(current,{payoutMode,payoutCadence,minimumPayoutMinor});
        const {payoutMode:mode,payoutCadence:cadence,resetSchedule}=preferences;
        const {rows:[updated]}=await client.query(
            `UPDATE vendors SET payout_mode=$2,payout_cadence=$3,
                minimum_payout_minor=COALESCE($4,minimum_payout_minor),
                next_payout_at=CASE
                    WHEN $2='manual' THEN NULL
                    WHEN NOT $5 THEN next_payout_at
                    WHEN $3='weekly' THEN
                        ((date_trunc('week', NOW() AT TIME ZONE 'Africa/Lagos') + INTERVAL '1 week') AT TIME ZONE 'Africa/Lagos')
                    WHEN $3='bi_weekly' THEN
                        ((date_trunc('week', NOW() AT TIME ZONE 'Africa/Lagos') + INTERVAL '1 week') AT TIME ZONE 'Africa/Lagos')
                    WHEN $3='monthly' THEN
                        ((date_trunc('month', NOW() AT TIME ZONE 'Africa/Lagos') + INTERVAL '1 month') AT TIME ZONE 'Africa/Lagos')
                    ELSE NULL
                END,
                updated_at=NOW()
             WHERE id=$1
             RETURNING payout_mode,payout_cadence,next_payout_at,minimum_payout_minor`,
            [vendorId,mode,cadence,preferences.minimumPayoutMinor??null,resetSchedule]);
        return updated;
    });
}

export async function processChargebackEvent(event) {
    const disputeId=String(event.event_id ?? event.event_key ?? '');
    const reference=event.reference;
    if(!disputeId||!reference)throw new Error('Paystack dispute event is missing its ID or transaction reference');
    return transaction(pool,async(client)=>{
        if(event.event_type==='charge.dispute.create'){
            const {rows: [payment]}=await client.query(
                `SELECT p.order_id,p.currency_id FROM payments p
                 WHERE p.gateway_ref=$1 OR p.provider_ref=$1 LIMIT 1`,[reference]);
            if(!payment?.order_id)return;
            const {rows: allocations}=await client.query(
                `SELECT vendor_id,id AS fulfillment_id,gross_amount
                 FROM vendor_order_fulfillments WHERE order_id=$1 ORDER BY vendor_id`,[payment.order_id]);
            const grossTotal=allocations.reduce((sum,row)=>sum+Number(row.gross_amount),0);
            const disputed=Number(event.amount_minor);
            if(!Number.isSafeInteger(disputed)||disputed<=0||grossTotal<=0)return;
            let allocated=0;
            for(let i=0;i<allocations.length;i++){
                const item=allocations[i];const amount=i===allocations.length-1?disputed-allocated:Math.round(disputed*Number(item.gross_amount)/grossTotal);allocated+=amount;
                if(amount<=0)continue;
                await client.query(
                    `INSERT INTO vendor_ledger_entries
                     (vendor_id,order_id,fulfillment_id,currency_id,entry_type,amount_minor,idempotency_key,metadata)
                     VALUES ($1,$2,$3,$4,'vendor_chargeback_hold',-$5,$6,$7)
                     ON CONFLICT (idempotency_key) DO NOTHING`,
                    [item.vendor_id,payment.order_id,item.fulfillment_id,payment.currency_id,amount,
                        'chargeback:'+disputeId+':vendor:'+item.vendor_id,
                        JSON.stringify({dispute_id:disputeId,transaction_reference:reference})]);
            }
            return;
        }
        if(event.event_type==='charge.dispute.resolve' && event.resolution==='declined'){
            const {rows: entries}=await client.query(
                `SELECT * FROM vendor_ledger_entries WHERE idempotency_key LIKE $1`,['chargeback:'+disputeId+':vendor:%']);
            for(const entry of entries){
                await client.query(
                    `INSERT INTO vendor_ledger_entries
                     (vendor_id,order_id,fulfillment_id,currency_id,entry_type,amount_minor,idempotency_key,metadata)
                     VALUES ($1,$2,$3,$4,'vendor_chargeback_release',-$5,$6,$7)
                     ON CONFLICT (idempotency_key) DO NOTHING`,
                    [entry.vendor_id,entry.order_id,entry.fulfillment_id,entry.currency_id,entry.amount_minor,
                        'chargeback:'+disputeId+':vendor:'+entry.vendor_id+':release',
                        JSON.stringify({dispute_id:disputeId,resolution:event.resolution})]);
            }
        }
    });
}

export async function getPayout(vendorId,payoutId) {
    const {rows}=await pool.query(
        `SELECT p.id,p.batch_id,p.reference,p.amount_minor,p.transfer_fee_minor,p.status,
                p.failure_code,p.failure_message,p.created_at,p.processed_at,p.paid_at,
                p.reversed_at,p.currency_id,c.code AS currency
         FROM payouts p JOIN currencies c ON c.id=p.currency_id
         WHERE p.vendor_id=$1 AND p.id=$2 LIMIT 1`,[vendorId,payoutId]);
    return rows[0]??null;
}

export async function retryFailedPayout(payoutId) {
    return transaction(pool,async(client)=>{
        const {rows:[payout]}=await client.query('SELECT * FROM payouts WHERE id=$1 FOR UPDATE',[payoutId]);
        if(!payout)throw Object.assign(new Error('Payout not found'),{status:404});
        if(payout.status!=='failed'||payout.provider_reference)
            throw Object.assign(new Error('Only a definitively failed transfer with no provider reference can be retried.'),{status:409});
        const retryNumber=Number(payout.attempts)+1;
        await addLedgerEntry(client,{vendorId:payout.vendor_id,batchId:payout.batch_id,payoutId:payout.id,currencyId:payout.currency_id,entryType:'vendor_payout_debit',amountMinor:-Number(payout.amount_minor),key:'payout:'+payout.id+':retry:'+retryNumber+':principal'});
        await addLedgerEntry(client,{vendorId:payout.vendor_id,batchId:payout.batch_id,payoutId:payout.id,currencyId:payout.currency_id,entryType:'vendor_transfer_fee_debit',amountMinor:-Number(payout.transfer_fee_minor),key:'payout:'+payout.id+':retry:'+retryNumber+':fee'});
        const {rows:[updated]}=await client.query(
            `UPDATE payouts SET status='pending',failure_code=NULL,failure_message=NULL,
                attempts=$2,processed_at=NULL,updated_at=NOW() WHERE id=$1 RETURNING *`,[payout.id,retryNumber]);
        await client.query(`UPDATE payout_batches SET status='pending',completed_at=NULL WHERE id=$1`,[payout.batch_id]);
        return updated;
    });
}

export async function finalizeTransfer(payoutId,otp) {
    const {rows:[payout]}=await pool.query('SELECT * FROM payouts WHERE id=$1',[payoutId]);
    if(!payout)throw Object.assign(new Error('Payout not found'),{status:404});
    if(payout.status!=='processing'||!payout.transfer_code||payout.failure_message!=='Paystack requires transfer authorization')
        throw Object.assign(new Error('This payout is not awaiting Paystack authorization.'),{status:409});
    const transfer=await finalizePaystackTransfer({transferCode:payout.transfer_code,otp});
    await pool.query(
        `UPDATE payouts SET failure_message=NULL,provider_reference=COALESCE($2,provider_reference),updated_at=NOW()
         WHERE id=$1 AND status='processing'`,[payout.id,transfer.reference??null]);
    return {id:payout.id,status:'processing',reference:payout.reference};
}
