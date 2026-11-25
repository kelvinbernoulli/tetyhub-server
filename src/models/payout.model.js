import { randomUUID } from 'node:crypto';
import pool from '#services/pg_pool.js';
import {
    createPaystackTransferRecipient,
    initiatePaystackTransfer,
    listPaystackBanks,
    resolvePaystackBankAccount,
    verifyPaystackTransfer,
} from '#utils/payment.js';
import {
    eligibleBalanceMinor,
    createChargebackHold,
    recordPayoutLedgerEntry,
    recordProviderFee,
    recordRefundDebit,
    recordTaxDeduction,
    resolveChargebackHold,
} from '#services/vendor-ledger.service.js';

const MINIMUM_PAYOUT_MINOR = BigInt(
    process.env.MIN_VENDOR_PAYOUT_MINOR || 100000
);
const MAX_ATTEMPTS = 3;

const formatNaira = (minorUnits) => {
    const value = BigInt(minorUnits ?? 0);
    const absoluteValue = value < 0n ? -value : value;
    const formatted = `${absoluteValue / 100n}.${String(absoluteValue % 100n).padStart(2, '0')}`;
    return value < 0n ? `-${formatted}` : formatted;
};

const payoutDto = (row) => {
    if (!row) return row;
    const { amount_minor, transfer_fee_minor, ...fields } = row;
    return {
        ...fields,
        amount: formatNaira(amount_minor),
        transfer_fee: formatNaira(transfer_fee_minor),
    };
};

const ledgerEntryDto = ({ amount_minor, ...fields }) => ({
    ...fields,
    amount: formatNaira(amount_minor),
});

const safeError = (error) => ({
    code: String(error.response?.data?.code || error.code || 'paystack_error').slice(0, 80),
    message: String(error.response?.data?.message || error.message || 'Paystack transfer failed').slice(0, 300),
    httpStatus: error.response?.status ?? null,
});

const isRecoverable = (error) => {
    const { code, httpStatus, message } = safeError(error);
    return httpStatus === 429
        || httpStatus >= 500
        || ['ETIMEDOUT', 'ECONNRESET', 'ECONNABORTED', 'EAI_AGAIN'].includes(code)
        || /temporar|insufficient balance|try again/i.test(message);
};

const batchStatus = async (client, batchId) => {
    await client.query(
        `UPDATE payout_batches SET
            status = CASE
                WHEN EXISTS (SELECT 1 FROM payouts WHERE batch_id = $1 AND status IN ('pending','processing')) THEN 'processing'
                WHEN EXISTS (SELECT 1 FROM payouts WHERE batch_id = $1 AND status = 'paid') THEN 'completed'
                ELSE 'failed'
            END,
            completed_at = CASE
                WHEN EXISTS (SELECT 1 FROM payouts WHERE batch_id = $1 AND status IN ('pending','processing')) THEN NULL
                ELSE COALESCE(completed_at,NOW())
            END
        WHERE id = $1`,
        [batchId]
    );
};

export default class Payout {
    static async banks() {
        return listPaystackBanks();
    }

    static async verifyBankAccount({ accountNumber, bankCode }) {
        const verified = await resolvePaystackBankAccount({
            accountNumber,
            bankCode,
        });
        return {
            account_name: verified.account_name,
            account_number_last4: accountNumber.slice(-4),
            bank_code: bankCode,
        };
    }

    static async preferences(vendorId) {
        const { rows } = await pool.query(
            `SELECT payout_mode,payout_interval,payout_next_at,payout_currency,
                payout_account_name,payout_bank_code,payout_bank_name,payout_account_last4,
                payout_verified_at,verification_status
            FROM vendors WHERE id = $1`,
            [vendorId]
        );
        return rows[0] ?? null;
    }

    static async updatePreferences(vendorId, { mode, interval }) {
        const { rows } = await pool.query(
            `UPDATE vendors SET payout_mode = $2,payout_interval = $3,
                payout_next_at = CASE
                    WHEN $2 = 'manual' THEN NULL
                    WHEN $3 = 'weekly' THEN NOW() + INTERVAL '1 week'
                    WHEN $3 = 'bi_weekly' THEN NOW() + INTERVAL '2 weeks'
                    WHEN $3 = 'monthly' THEN NOW() + INTERVAL '1 month'
                END,
                updated_at = NOW()
            WHERE id = $1
            RETURNING payout_mode,payout_interval,payout_next_at,payout_currency,
                payout_account_name,payout_bank_code,payout_bank_name,payout_account_last4,
                payout_verified_at,verification_status`,
            [vendorId, mode, mode === 'automatic' ? interval : null]
        );
        return rows[0] ?? null;
    }

    static async setBankAccount(vendorId, { accountNumber, bankCode, email }) {
        const verified = await resolvePaystackBankAccount({
            accountNumber,
            bankCode,
        });
        const recipient = await createPaystackTransferRecipient({
            name: verified.account_name,
            accountNumber,
            bankCode,
            email,
        });
        const bankName = recipient.details?.bank_name ?? null;
        const { rows } = await pool.query(
            `UPDATE vendors SET paystack_recipient_code = $2,
                payout_account_name = $3,payout_bank_code = $4,payout_bank_name = $5,
                payout_account_last4 = $6,payout_currency = 'NGN',payout_verified_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            RETURNING payout_account_name,payout_bank_code,payout_bank_name,
                payout_account_last4,payout_currency,payout_verified_at`,
            [
                vendorId,
                recipient.recipient_code,
                verified.account_name,
                bankCode,
                bankName,
                accountNumber.slice(-4),
            ]
        );
        return rows[0] ?? null;
    }

    static async summary(vendorId) {
        const [balanceResult, payoutResult, countResult] = await Promise.all([
            pool.query(
                `SELECT COALESCE(SUM(amount_minor),0)::text AS balance_minor
                FROM vendor_ledger_entries WHERE vendor_id = $1 AND currency = 'NGN'`,
                [vendorId]
            ),
            pool.query(
                `SELECT COALESCE(SUM(amount_minor),0)::text AS pending_minor
                FROM payouts WHERE vendor_id = $1 AND status IN ('pending','processing')`,
                [vendorId]
            ),
            pool.query(
                `SELECT COUNT(*)::int AS count FROM payouts WHERE vendor_id = $1`,
                [vendorId]
            ),
        ]);
        const eligibleMinor = await eligibleBalanceMinor(pool, vendorId, 'NGN');
        return {
            currency: 'NGN',
            balance: formatNaira(balanceResult.rows[0].balance_minor),
            available: formatNaira(eligibleMinor),
            pending: formatNaira(payoutResult.rows[0].pending_minor),
            minimum_payout: formatNaira(MINIMUM_PAYOUT_MINOR),
            payout_count: countResult.rows[0].count,
        };
    }

    static async ledger(vendorId, { limit = 40, offset = 0 }) {
        const [entries, total] = await Promise.all([
            pool.query(
            `SELECT id,order_id,order_item_id,booking_id,payout_id,entry_type,
                amount_minor::text,currency,created_at
            FROM vendor_ledger_entries WHERE vendor_id = $1
            ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
            [vendorId, limit, offset]
            ),
            pool.query('SELECT COUNT(*)::int AS total FROM vendor_ledger_entries WHERE vendor_id = $1', [vendorId]),
        ]);
        return { items: entries.rows.map(ledgerEntryDto), total: total.rows[0].total };
    }

    static async history(vendorId, { limit = 40, offset = 0 }) {
        const [result, count] = await Promise.all([
            pool.query(
                `SELECT id,batch_id,currency,amount_minor::text,transfer_fee_minor::text,
                    transfer_reference,transfer_code,status,attempt_count,retryable,
                    last_error_code,created_at,updated_at,completed_at
                FROM payouts WHERE vendor_id = $1
                ORDER BY created_at DESC,id DESC LIMIT $2 OFFSET $3`,
                [vendorId, limit, offset]
            ),
            pool.query('SELECT COUNT(*)::int AS total FROM payouts WHERE vendor_id = $1', [vendorId]),
        ]);
        return { items: result.rows.map(payoutDto), total: count.rows[0].total };
    }

    static async createForVendor(vendorId, {
        mode,
        createdByUserId = null,
        batchId = null,
        amountMinor = null,
    }) {
        const client = await pool.connect();
        let payout;
        try {
            await client.query('BEGIN');
            if (mode === 'automatic' && amountMinor != null)
                throw Object.assign(new Error('Automatic payouts always use the full eligible balance'), { status: 400 });
            if (amountMinor != null && (!Number.isSafeInteger(amountMinor) || amountMinor <= 0))
                throw Object.assign(new Error('Requested payout amount is invalid'), { status: 400 });
            const vendor = (
                await client.query(
                    `SELECT id,status,verification_status,payout_mode,payout_interval,
                        payout_next_at,paystack_recipient_code,payout_currency
                    FROM vendors WHERE id = $1 FOR UPDATE`,
                    [vendorId]
                )
            ).rows[0];
            
            if (!vendor) throw Object.assign(new Error('Vendor not found'), { status: 404 });
            if (vendor.status !== 'active' || vendor.verification_status !== 'verified')
                throw Object.assign(new Error('Vendor verification is required before payout'), { status: 409 });
            if (!vendor.paystack_recipient_code || vendor.payout_currency !== 'NGN')
                throw Object.assign(new Error('Set up a verified Nigerian bank account before requesting payout'), { status: 409 });
            if (vendor.payout_mode !== mode)
                throw Object.assign(new Error(`Vendor payout mode is ${vendor.payout_mode}`), { status: 409 });

            if (mode === 'automatic') {
                const due = vendor.payout_next_at && new Date(vendor.payout_next_at) <= new Date();
                if (!due) {
                    await client.query('ROLLBACK');
                    return null;
                }
            }

            const balanceMinor = await eligibleBalanceMinor(client, vendorId, 'NGN');
            const payoutAmountMinor = amountMinor == null
                ? balanceMinor
                : BigInt(amountMinor);

            if (payoutAmountMinor > balanceMinor)
                throw Object.assign(new Error('Requested payout exceeds the eligible balance'), { status: 409 });

            if (payoutAmountMinor > BigInt(Number.MAX_SAFE_INTEGER))
                throw Object.assign(new Error('Available balance exceeds the supported Paystack transfer amount'), { status: 409 });

            if (mode === 'automatic') {
                await client.query(
                    `UPDATE vendors SET payout_next_at = CASE payout_interval
                        WHEN 'weekly' THEN NOW() + INTERVAL '1 week'
                        WHEN 'bi_weekly' THEN NOW() + INTERVAL '2 weeks'
                        WHEN 'monthly' THEN NOW() + INTERVAL '1 month'
                    END WHERE id = $1`,
                    [vendorId]
                );
            }

            if (payoutAmountMinor < MINIMUM_PAYOUT_MINOR) {
                if (amountMinor != null)
                    throw Object.assign(new Error('Requested payout is below the minimum payout amount'), { status: 400 });
                await client.query('COMMIT');
                return null;
            }

            const transferReference = `payout_${randomUUID()}`;
            let effectiveBatchId = batchId;
            if (!effectiveBatchId) {
                effectiveBatchId = (
                    await client.query(
                        `INSERT INTO payout_batches (batch_key,mode,cadence,created_by_user_id)
                        VALUES ($1,$2,$3,$4) RETURNING id`,
                        [randomUUID(), mode, mode === 'automatic' ? vendor.payout_interval : null, createdByUserId]
                    )
                ).rows[0].id;
            }

            payout = (
                await client.query(
                    `INSERT INTO payouts (batch_id,vendor_id,currency,amount_minor,transfer_reference)
                    VALUES ($1,$2,'NGN',$3,$4) RETURNING *`,
                    [effectiveBatchId, vendorId, payoutAmountMinor.toString(), transferReference]
                )
            ).rows[0];

            await recordPayoutLedgerEntry(client, {
                vendorId,
                payoutId: payout.id,
                type: 'debit_payout',
                amountMinor: -payoutAmountMinor,
                idempotencyKey: `payout:${payout.id}:attempt:1:debit`,
                metadata: { transfer_reference: transferReference },
            });

            await client.query('COMMIT');

        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }

        if (payout) await this.dispatch(payout.id);
        return payout ? this.payoutById(payout.id) : null;
    }

    static async payoutById(id) {
        const { rows } = await pool.query(
            `SELECT p.id,p.batch_id,p.vendor_id,p.currency,p.amount_minor::text,
                p.transfer_fee_minor::text,p.transfer_reference,p.transfer_code,p.status,
                p.attempt_count,p.retryable,p.last_error_code,p.created_at,p.updated_at,p.completed_at
            FROM payouts p WHERE p.id = $1`,
            [id]
        );
        return payoutDto(rows[0] ?? null);
    }

    static async dispatch(id) {
        const client = await pool.connect();
        let payout;

        try {
            await client.query('BEGIN');
            payout = (
                await client.query(
                    `SELECT p.*,v.paystack_recipient_code FROM payouts p
                    JOIN vendors v ON v.id = p.vendor_id
                    WHERE p.id = $1 FOR UPDATE OF p`,
                    [id]
                )
            ).rows[0];

            if (!payout || payout.status !== 'pending') {
                await client.query('ROLLBACK');
                return payout;
            }

            await client.query(
                `UPDATE payouts SET status = 'processing',attempt_count = attempt_count + 1,
                    retryable = false,last_error_code = NULL,last_error_message = NULL,updated_at = NOW()
                WHERE id = $1`,
                [id]
            );

            payout.attempt_count += 1;
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }

        try {
            const result = await initiatePaystackTransfer({
                amountMinor: Number(payout.amount_minor),
                recipientCode: payout.paystack_recipient_code,
                reference: payout.transfer_reference,
                reason: `Vendor payout ${payout.id}`,
            });

            if (result.transfer_code) {
                await pool.query(
                    `UPDATE payouts SET transfer_code = $2,updated_at = NOW()
                    WHERE id = $1 AND status = 'processing'`,
                    [payout.id, result.transfer_code]
                );
            }

            if (!['success', 'pending', 'failed', 'reversed'].includes(String(result.status).toLowerCase())) {
                await pool.query(
                    `UPDATE payouts SET last_error_code = 'approval_required',
                        last_error_message = 'Paystack requires transfer approval',updated_at = NOW()
                    WHERE id = $1 AND status = 'processing'`,
                    [payout.id]
                );
                return Payout.payoutById(id);
            }

            await Payout.applyTransferStatus(
                `api:${payout.transfer_reference}:${result.status}`,
                result.status,
                result
            );
        } catch (error) {
            const { code, message, httpStatus } = safeError(error);
            const recoverable = isRecoverable(error);
            const status = httpStatus && httpStatus < 500 && httpStatus !== 429
                ? 'failed'
                : 'processing';
            await Payout.recordTransferError(
                id,
                status,
                status === 'processing' ? 'provider_uncertain' : code,
                `${code}: ${message}`,
                recoverable
            );
        }
        return Payout.payoutById(id);
    }

    static async recordTransferError(id, status, code, message, retryable) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const payout = (
                await client.query('SELECT * FROM payouts WHERE id = $1 FOR UPDATE', [id])
            ).rows[0];

            if (!payout || payout.status !== 'processing') {
                await client.query('ROLLBACK');
                return;
            }

            await client.query(
                `UPDATE payouts SET status = $2,last_error_code = $3,
                    last_error_message = $4,retryable = $5,updated_at = NOW(),
                    completed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE NULL END
                WHERE id = $1`,
                [id, status, code, message, retryable]
            );

            if (status === 'failed') {
                await recordPayoutLedgerEntry(client, {
                    vendorId: payout.vendor_id,
                    payoutId: payout.id,
                    type: 'credit_payout_reversal',
                    amountMinor: BigInt(payout.amount_minor),
                    idempotencyKey: `payout:${payout.id}:attempt:${payout.attempt_count}:release`,
                    metadata: { error_code: code },
                });
            }

            await batchStatus(client, payout.batch_id);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    static async applyTransferStatus(eventKey, providerStatus, data) {
        const reference = data.reference;
        if (!reference) return false;
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const inserted = await client.query(
                `INSERT INTO payout_webhook_events (event_key,transfer_reference,event_type,payload)
                VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (event_key) DO NOTHING RETURNING id`,
                [eventKey, reference, `transfer.${providerStatus}`, JSON.stringify(data)]
            );

            if (!inserted.rowCount) {
                await client.query('COMMIT');
                return true;
            }

            const payout = (
                await client.query(
                    'SELECT * FROM payouts WHERE transfer_reference = $1 FOR UPDATE',
                    [reference]
                )
            ).rows[0];

            if (!payout) {
                await client.query('COMMIT');
                return false;
            }

            const status = String(providerStatus).toLowerCase();
            if (status === 'success') {
                if (['pending', 'processing', 'paid'].includes(payout.status)) {
                    await client.query(
                        `UPDATE payouts SET status = 'paid',transfer_code = COALESCE($2,transfer_code),
                            completed_at = COALESCE(completed_at,NOW()),updated_at = NOW(),
                            retryable = false,last_error_code = NULL,last_error_message = NULL
                        WHERE id = $1`,
                        [payout.id, data.transfer_code ?? null]
                    );
                    await recordProviderFee(client, payout, data.fee_charged ?? 0);
                }
                
            } else if (status === 'failed') {
                if (['pending', 'processing'].includes(payout.status)) {
                    const providerMessage = String(data.failures?.message ?? data.message ?? 'Transfer failed');
                    const retryable = /temporar|insufficient balance|try again/i.test(providerMessage);

                    await client.query(
                        `UPDATE payouts SET status = 'failed',transfer_code = COALESCE($2,transfer_code),
                            completed_at = NOW(),updated_at = NOW(),retryable = $3,
                            last_error_code = 'provider_transfer_failed',last_error_message = $4
                        WHERE id = $1`,
                        [payout.id, data.transfer_code ?? null, retryable, providerMessage.slice(0, 300)]
                    );

                    await recordPayoutLedgerEntry(client, {
                        vendorId: payout.vendor_id,
                        payoutId: payout.id,
                        type: 'credit_payout_reversal',
                        amountMinor: BigInt(payout.amount_minor),
                        idempotencyKey: `payout:${payout.id}:attempt:${payout.attempt_count}:release`,
                        metadata: { error_code: 'provider_transfer_failed' },
                    });
                }
            } else if (status === 'reversed' && payout.status !== 'reversed') {
                await client.query(
                    `UPDATE payouts SET status = 'reversed',transfer_code = COALESCE($2,transfer_code),
                        completed_at = NOW(),updated_at = NOW(),retryable = false
                    WHERE id = $1`,
                    [payout.id, data.transfer_code ?? null]
                );

                if (['pending', 'processing', 'paid'].includes(payout.status)) {
                    await recordPayoutLedgerEntry(client, {
                        vendorId: payout.vendor_id,
                        payoutId: payout.id,
                        type: 'credit_payout_reversal',
                        amountMinor: BigInt(payout.amount_minor),
                        idempotencyKey: `payout:${payout.id}:reversed`,
                        metadata: { provider: 'paystack' },
                    });
                }
            }

            await batchStatus(client, payout.batch_id);
            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    static async applyFinancialWebhook(eventKey, eventType, data) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const inserted = await client.query(
                `INSERT INTO payout_webhook_events (event_key,transfer_reference,event_type,payload)
                VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (event_key) DO NOTHING RETURNING id`,
                [eventKey, data.reference ?? data.transaction_reference ?? null, eventType, JSON.stringify(data)]
            );

            if (!inserted.rowCount) {
                await client.query('COMMIT');
                return true;
            }

            if (eventType === 'refund.processed') {
                const transactionReference = data.transaction?.reference
                    ?? data.transaction_reference
                    ?? data.reference;
                if (transactionReference && data.amount != null) {
                    await recordRefundDebit(client, {
                        transactionReference,
                        amountMinor: data.amount,
                        idempotencyKey: `refund:${data.id ?? data.refund_reference ?? eventKey}`,
                    });
                }
            } else if (eventType === 'charge.dispute.create') {
                const transactionReference = data.transaction?.reference
                    ?? data.transaction_reference
                    ?? data.reference;
                if (transactionReference && data.id != null && data.amount != null) {
                    await createChargebackHold(client, {
                        transactionReference,
                        disputeId: data.id,
                        amountMinor: data.amount,
                        currency: data.currency ?? 'NGN',
                    });
                }
            } else if (eventType === 'charge.dispute.resolve' && data.id != null) {
                await resolveChargebackHold(client, {
                    disputeId: data.id,
                    resolution: data.resolution ?? data.status,
                    amountMinor: data.refund_amount ?? data.amount ?? null,
                });
            }
            await client.query('COMMIT');
            return true;
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
    }

    static async reconcileUncertain(limit = 20) {
        const { rows } = await pool.query(
            `SELECT id,transfer_reference FROM payouts
            WHERE status = 'processing' AND last_error_code = 'provider_uncertain'
                AND updated_at < NOW() - INTERVAL '2 minutes'
            ORDER BY updated_at LIMIT $1`,
            [limit]
        );
        for (const payout of rows) {
            try {
                const transfer = await verifyPaystackTransfer(payout.transfer_reference);
                await this.applyTransferStatus(
                    `verify:${payout.transfer_reference}:${transfer.status}`,
                    transfer.status,
                    transfer
                );
            } catch (error) {
                if (error.response?.status === 404) {
                    await pool.query(
                        `UPDATE payouts SET status = 'pending',updated_at = NOW()
                        WHERE id = $1 AND status = 'processing' AND last_error_code = 'provider_uncertain'`,
                        [payout.id]
                    );
                    await this.dispatch(payout.id);
                } else {
                    console.error('Payout verification failed:', error.message);
                }
            }
        }
    }

    static async runDueAutomatic(limit = 50) {
        const { rows } = await pool.query(
            `SELECT id FROM vendors WHERE payout_mode = 'automatic'
                AND payout_next_at <= NOW() AND status = 'active'
                AND verification_status = 'verified' AND paystack_recipient_code IS NOT NULL
            ORDER BY payout_next_at,id LIMIT $1`,
            [limit]
        );
        let batchId = null;
        if (rows.length) {
            const { rows: batchRows } = await pool.query(
                `INSERT INTO payout_batches (batch_key,mode,cadence)
                VALUES ($1,'automatic',NULL) RETURNING id`,
                [randomUUID()]
            );
            batchId = batchRows[0].id;
        }
        for (const { id } of rows) {
            try {
                await this.createForVendor(id, { mode: 'automatic', batchId });
            } catch (error) {
                console.error(`Automatic payout failed for vendor ${id}:`, error.message);
            }
        }
        if (batchId) {
            await pool.query(
                `DELETE FROM payout_batches WHERE id = $1
                AND NOT EXISTS (SELECT 1 FROM payouts WHERE batch_id = $1)`,
                [batchId]
            );
        }
        await this.reconcileUncertain(limit);
        return rows.length;
    }

    static async retry(id, adminUserId) {
        const client = await pool.connect();
        const nextTransferReference = `payout_${randomUUID()}`;
        try {
            await client.query('BEGIN');
            const payout = (
                await client.query(
                    `SELECT p.*,v.status AS vendor_status,v.verification_status,
                        v.paystack_recipient_code
                    FROM payouts p JOIN vendors v ON v.id = p.vendor_id
                    WHERE p.id = $1 FOR UPDATE OF p`,
                    [id]
                )
            ).rows[0];
            if (!payout) throw Object.assign(new Error('Payout not found'), { status: 404 });
            if (payout.status !== 'failed' || !payout.retryable || payout.attempt_count >= MAX_ATTEMPTS)
                throw Object.assign(new Error('This payout is not eligible for retry'), { status: 409 });
            if (payout.vendor_status !== 'active' || payout.verification_status !== 'verified' || !payout.paystack_recipient_code)
                throw Object.assign(new Error('Vendor payout eligibility is no longer valid'), { status: 409 });
            const balanceMinor = await eligibleBalanceMinor(client, payout.vendor_id, 'NGN');
            if (balanceMinor < BigInt(payout.amount_minor))
                throw Object.assign(new Error('Vendor available balance is insufficient for retry'), { status: 409 });
            await client.query(
                `INSERT INTO payout_webhook_events
                    (event_key,transfer_reference,event_type,payload)
                VALUES ($1,$2,'retry',$3::jsonb)`,
                [
                    `retry:${payout.id}:${payout.attempt_count + 1}`,
                    payout.transfer_reference,
                    JSON.stringify({ new_transfer_reference: nextTransferReference, retried_by_user_id: adminUserId }),
                ]
            );
            await client.query(
                `UPDATE payouts SET status = 'pending',transfer_reference = $2,
                    retryable = false,last_error_code = NULL,last_error_message = NULL,
                    completed_at = NULL,updated_at = NOW()
                WHERE id = $1`,
                [id, nextTransferReference]
            );
            await recordPayoutLedgerEntry(client, {
                vendorId: payout.vendor_id,
                payoutId: payout.id,
                type: 'debit_payout',
                amountMinor: -BigInt(payout.amount_minor),
                idempotencyKey: `payout:${payout.id}:attempt:${payout.attempt_count + 1}:debit`,
                metadata: { retried_by_user_id: adminUserId },
            });
            await batchStatus(client, payout.batch_id);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
        return this.dispatch(id);
    }

    static async addTaxDeduction(vendorId, amountMinor, note, userId) {
        if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
            throw Object.assign(new Error('amount must be a positive naira amount'), { status: 400 });
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const vendor = await client.query('SELECT id FROM vendors WHERE id = $1 FOR UPDATE', [vendorId]);
            if (!vendor.rowCount) throw Object.assign(new Error('Vendor not found'), { status: 404 });
            await recordTaxDeduction(client, {
                vendorId,
                amountMinor,
                idempotencyKey: `tax-adjustment:${randomUUID()}`,
                reference: note,
                createdByUserId: userId,
            });
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK').catch(() => {});
            throw error;
        } finally {
            client.release();
        }
        return this.summary(vendorId);
    }

    static async adminList({ limit = 40, offset = 0, status }) {
        const [result, count] = await Promise.all([
            pool.query(
                `SELECT p.id,p.batch_id,p.vendor_id,
                    COALESCE(NULLIF(CONCAT_WS(' ',u.firstname,u.lastname),''),'Vendor #' || v.id::text) AS store_name,
                    p.currency,p.amount_minor::text,
                    p.transfer_fee_minor::text,p.transfer_reference,p.transfer_code,p.status,
                    p.attempt_count,p.retryable,p.last_error_code,p.created_at,p.updated_at,p.completed_at
                FROM payouts p JOIN vendors v ON v.id = p.vendor_id
                JOIN users u ON u.id = v.user_id
                WHERE ($1::text IS NULL OR p.status = $1)
                ORDER BY p.created_at DESC,p.id DESC LIMIT $2 OFFSET $3`,
                [status ?? null, limit, offset]
            ),
            pool.query(
                `SELECT COUNT(*)::int AS total FROM payouts WHERE ($1::text IS NULL OR status = $1)`,
                [status ?? null]
            ),
        ]);
        return { items: result.rows.map(payoutDto), total: count.rows[0].total };
    }
}