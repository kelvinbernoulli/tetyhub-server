import pool from "#services/pg_pool.js";
import { idFingerprint } from '#utils/kyc.js';

const KYC_TYPES = ['identity', 'business', 'address'];
const SORTABLE_COLUMNS = ['created_at', 'updated_at', 'id'];
const MAX_PAGE_SIZE = 100;

// Namespaces for pg_advisory_xact_lock(namespace, user_id): serialises submissions
// per user and per KYC type without relying on unique constraints being present.
const LOCK_NAMESPACE = { identity: 7101, business: 7102, address: 7103 };

// Admin listings and detail views select explicit columns: never SELECT * on
// tables that hold identity numbers, biometric keys and provider payloads.
const LIST_COLUMNS = {
    identity: 'k.id, k.user_id, k.id_type, k.id_number, k.country, k.verification_status, k.review_reasons, k.created_at, k.updated_at',
    business: 'k.id, k.user_id, k.business_name, k.registration_number, k.verification_status, k.review_reason, k.created_at, k.updated_at',
    address: 'k.id, k.user_id, k.city, k.state, k.country, k.review_status, k.review_reason, k.provider_status, k.provider_checked_at, k.created_at, k.updated_at',
};

const DETAIL_COLUMNS = {
    identity: `${LIST_COLUMNS.identity}, k.document_number`,
    business: `${LIST_COLUMNS.business}, k.business_address, k.business_document`,
    address: `${LIST_COLUMNS.address}, k.address_line1, k.address_line2, k.house_number, k.landmark, k.lga, k.street, k.verification_type, k.address_verification_due_date`,
};

const maskValue = value =>
    typeof value === 'string' && value.length > 4 ? '*'.repeat(value.length - 4) + value.slice(-4) : '****';

const maskIdMap = map =>
    map && typeof map === 'object'
        ? Object.fromEntries(Object.entries(map).map(([key, value]) => [key, maskValue(value)]))
        : map;

const present = (row, kycType, detailed) => {
    if (kycType === 'identity') {
        row.id_number = maskIdMap(row.id_number);
        if (detailed) row.document_number = maskIdMap(row.document_number);
    }
    return row;
};

const withUserLock = async (kind, userId, work) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock($1::int, $2::int)', [LOCK_NAMESPACE[kind], userId]);
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('KYC database operation failed', { errorCode: err?.code ?? null });
        throw err;
    } finally {
        client.release();
    }
};

const safeRow = async (query, params) => {
    try {
        const result = await pool.query(query, params);
        const row = result.rows[0];
        if (row) delete row.verification_data;
        return row;
    } catch (err) {
        console.error('KYC database operation failed', { errorCode: err?.code ?? null });
        throw err;
    }
};

export class KYC {
    /**
     * Returns { row, previousKeys } on success, or null when this ID type already has a
     * pending/approved submission. previousKeys are S3 keys that were just replaced and
     * should be deleted by the caller after a successful save.
     * Throws { code: 'KYC_ID_IN_USE' } if the ID already belongs to another user.
     */
    static async insertIdentity(userId, data, verificationData, fingerprint) {
        const { id_type, id_number, id_document, country, selfie_image, document_number } = data;
        const type = id_type.toLowerCase();
        const now = new Date();

        return withUserLock('identity', userId, async client => {
            const { rows: previousRows } = await client.query(
                'SELECT verification_status FROM kyc_identity WHERE user_id = $1',
                [userId]
            );
            const previous = previousRows[0];
            const previousStatus = previous?.verification_status?.[type];
            if (previousStatus && previousStatus !== 'declined') return null;

            const { rows: previousEvidenceRows } = await client.query(
                'SELECT selfie, id_document FROM kyc_identity_evidence WHERE user_id = $1 AND id_type = $2 FOR UPDATE',
                [userId, type]
            );
            const previousEvidence = previousEvidenceRows[0];

            // Claim the ID for this user. A concurrent claim by another user blocks on the
            // unique index until that transaction ends, then reports a different owner.
            await client.query(
                'INSERT INTO kyc_id_fingerprints (id_type, fingerprint, user_id) VALUES ($1, $2, $3) ON CONFLICT (id_type, fingerprint) DO NOTHING',
                [type, fingerprint, userId]
            );
            const { rows: ownerRows } = await client.query(
                'SELECT user_id FROM kyc_id_fingerprints WHERE id_type = $1 AND fingerprint = $2',
                [type, fingerprint]
            );
            if (ownerRows[0]?.user_id !== userId) {
                throw Object.assign(new Error('ID is already linked to another account'), { code: 'KYC_ID_IN_USE' });
            }

            const { rows } = await client.query(
                `INSERT INTO kyc_identity (
                    user_id, id_type, id_number, id_document, country, document_number,
                    verification_status, selfie, verification_data, created_at, updated_at
                )
                VALUES (
                    $1, $2::jsonb, $3::jsonb, $4, $5, $6::jsonb,
                    $7::jsonb, $8, jsonb_build_object($11::text, $9::jsonb), $10, $10
                )
                ON CONFLICT (user_id)
                DO UPDATE SET
                    id_type = COALESCE(kyc_identity.id_type, '{}'::jsonb) || EXCLUDED.id_type,
                    id_number = COALESCE(kyc_identity.id_number, '{}'::jsonb) || EXCLUDED.id_number,
                    document_number = COALESCE(kyc_identity.document_number, '{}'::jsonb) || EXCLUDED.document_number,
                    verification_status = COALESCE(kyc_identity.verification_status, '{}'::jsonb) || EXCLUDED.verification_status,
                    review_reasons = COALESCE(kyc_identity.review_reasons, '{}'::jsonb) - $11::text,
                    verification_data = COALESCE(kyc_identity.verification_data, '{}'::jsonb) || EXCLUDED.verification_data,
                    updated_at = EXCLUDED.updated_at
                RETURNING *`,
                [
                    userId,
                    JSON.stringify({ [type]: id_type }),
                    JSON.stringify({ [type]: id_number }),
                    id_document || null,
                    country,
                    JSON.stringify(document_number ? { [type]: document_number } : {}),
                    JSON.stringify({ [type]: 'pending' }),
                    selfie_image || '',
                    JSON.stringify(verificationData),
                    now,
                    type,
                ]
            );

            await client.query(
                `INSERT INTO kyc_identity_evidence (user_id, id_type, selfie, id_document, country)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (user_id, id_type) DO UPDATE SET
                    selfie = EXCLUDED.selfie,
                    id_document = EXCLUDED.id_document,
                    country = EXCLUDED.country,
                    updated_at = NOW()`,
                [userId, type, selfie_image || '', id_document || null, country]
            );

            const previousKeys = [];
            if (previousEvidence?.selfie) previousKeys.push(previousEvidence.selfie);
            if (previousEvidence?.id_document) previousKeys.push(previousEvidence.id_document);

            const row = rows[0];
            delete row.verification_data;
            return { row, previousKeys };
        });
    }

    static async getIdentityByUserId(userId) {
        return safeRow('SELECT * FROM kyc_identity WHERE user_id = $1', [userId]);
    }

    // Pre-check run BEFORE calling the provider, so a duplicate ID costs nothing.
    static async fingerprintOwner(type, fingerprint) {
        const { rows } = await pool.query(
            'SELECT user_id FROM kyc_id_fingerprints WHERE id_type = $1 AND fingerprint = $2',
            [type, fingerprint]
        );
        return rows[0]?.user_id ?? null;
    }

    static async registrationNumberInUse(registrationNumber, userId) {
        const { rows } = await pool.query(
            `SELECT 1 FROM kyc_business
             WHERE UPPER(registration_number) = $1 AND user_id <> $2 AND verification_status <> 'declined'
             LIMIT 1`,
            [String(registrationNumber).toUpperCase(), userId]
        );
        return rows.length > 0;
    }

    static async insertBusiness(userId, data, verificationData) {
        const { business_name, registration_number, business_document, business_address } = data;
        const now = new Date();

        return withUserLock('business', userId, async client => {
            const { rows: existingRows } = await client.query(
                'SELECT id, business_document, verification_status FROM kyc_business WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                [userId]
            );
            const existing = existingRows[0];
            if (existing && existing.verification_status !== 'declined') return null;

            if (existing) {
                const { rows } = await client.query(
                    `UPDATE kyc_business
                     SET business_name = $2, registration_number = $3, business_document = $4,
                         business_address = $5, verification_data = $6, verification_status = 'pending',
                         review_reason = NULL, updated_at = $7
                     WHERE id = $1
                     RETURNING *`,
                    [existing.id, business_name, registration_number, business_document, business_address, JSON.stringify(verificationData), now]
                );
                const row = rows[0];
                delete row.verification_data;
                return { row, previousKeys: existing.business_document ? [existing.business_document] : [] };
            }

            const { rows } = await client.query(
                `INSERT INTO kyc_business
                    (user_id, business_name, registration_number, business_document, business_address,
                     verification_data, verification_status, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $7)
                 RETURNING *`,
                [userId, business_name, registration_number, business_document, business_address, JSON.stringify(verificationData), now]
            );
            const row = rows[0];
            delete row.verification_data;
            return { row, previousKeys: [] };
        });
    }

    static async getBusinessByUserId(userId) {
        return safeRow('SELECT * FROM kyc_business WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [userId]);
    }

    static async insertAddress(userId, data, verificationData) {
        const {
            address, house_number, landmark, state, lga, street, city,
            address_verification_due_date, verification_type, country,
        } = data;
        const now = new Date();

        return withUserLock('address', userId, async client => {
            const { rows: existingRows } = await client.query(
                'SELECT id, review_status FROM kyc_address WHERE user_id = $1 ORDER BY id DESC LIMIT 1',
                [userId]
            );
            const existing = existingRows[0];
            if (existing && existing.review_status !== 'declined') return null;

            const payload = JSON.stringify(verificationData);
            const providerJobId = verificationData?.data?.job_id ?? verificationData?.data?._id
                ?? verificationData?.job_id ?? verificationData?._id ?? null;

            if (existing) {
                const { rows } = await client.query(
                    `UPDATE kyc_address
                     SET address_line1 = $2, address_line2 = NULL, landmark = $3, city = $4, state = $5,
                         lga = $6, street = $7, house_number = $8, verification_type = $9, country = $10,
                         address_verification_due_date = $11, verification_data = $12,
                         provider_job_id = $13, provider_status = 'pending',
                         provider_checked_at = NULL, review_status = 'pending', review_reason = NULL, updated_at = $14
                     WHERE id = $1
                     RETURNING *`,
                    [existing.id, address, landmark ?? null, city, state, lga, street, house_number, verification_type, country, address_verification_due_date ?? null, payload, providerJobId, now]
                );
                const row = rows[0];
                delete row.verification_data;
                return { row, providerJobId };
            }

            const { rows } = await client.query(
                `INSERT INTO kyc_address
                    (user_id, address_line1, landmark, city, state, lga, street, house_number,
                     address_verification_due_date, verification_type, country, verification_data,
                     provider_job_id, provider_status, review_status, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending', 'pending', $14, $14)
                 RETURNING *`,
                [
                    userId, address, landmark ?? null, city, state, lga, street, house_number,
                    address_verification_due_date ?? null, verification_type, country, payload, providerJobId, now,
                ]
            );
            const row = rows[0];
            delete row.verification_data;
            return { row, providerJobId };
        });
    }

    static async getAddressByUserId(userId) {
        return safeRow('SELECT * FROM kyc_address WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [userId]);
    }

    static async getAddressContact(userId) {
        const { rows } = await pool.query(
            'SELECT firstname, lastname, phone, email FROM users WHERE id = $1 LIMIT 1',
            [userId]
        );
        return rows[0] ?? null;
    }

    static async getAddressStatus(userId) {
        const { rows } = await pool.query(
            `SELECT provider_job_id, provider_status, provider_checked_at, review_status
             FROM kyc_address WHERE user_id = $1 LIMIT 1`,
            [userId]
        );
        return rows[0] ?? null;
    }

    static async saveAddressProviderStatus(userId, providerStatus, checkedAt) {
        await pool.query(
            `UPDATE kyc_address
             SET provider_status = $2, provider_checked_at = $3, updated_at = NOW()
             WHERE user_id = $1`,
            [userId, providerStatus.slice(0, 80), checkedAt]
        );
    }

    static async updateUserKycStatus({ kyc_type, user_id, status, reason }) {
        const identity = ['nin', 'bvn', 'pp'].includes(kyc_type);
        if (!identity && !['business', 'address'].includes(kyc_type)) throw new Error('Invalid KYC type');
        if (!['approved', 'declined'].includes(status)) throw new Error('Invalid KYC status');

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            let result;
            if (identity) {
                if (status === 'approved') {
                    const { rows: identityRows } = await client.query(
                        'SELECT id_number FROM kyc_identity WHERE user_id = $1 FOR UPDATE',
                        [user_id]
                    );
                    const idNumber = identityRows[0]?.id_number?.[kyc_type];
                    if (typeof idNumber !== 'string' || !idNumber) {
                        throw new Error('Identity document number is missing');
                    }
                    const fingerprint = idFingerprint(kyc_type, idNumber);
                    await client.query(
                        `INSERT INTO kyc_id_fingerprints (id_type, fingerprint, user_id)
                         VALUES ($1, $2, $3) ON CONFLICT (id_type, fingerprint) DO NOTHING`,
                        [kyc_type, fingerprint, user_id]
                    );
                    const { rows: ownerRows } = await client.query(
                        'SELECT user_id FROM kyc_id_fingerprints WHERE id_type = $1 AND fingerprint = $2',
                        [kyc_type, fingerprint]
                    );
                    if (Number(ownerRows[0]?.user_id) !== Number(user_id)) {
                        throw Object.assign(new Error('ID is already linked to another account'), { code: 'KYC_ID_IN_USE' });
                    }
                }
                result = await client.query(
                    `UPDATE kyc_identity
                     SET verification_status = jsonb_set(COALESCE(verification_status, '{}'::jsonb), $1, $2::jsonb, true),
                         review_reasons = jsonb_set(COALESCE(review_reasons, '{}'::jsonb), $1, COALESCE(to_jsonb($4::text), 'null'::jsonb), true),
                         updated_at = NOW()
                     WHERE user_id = $3
                     RETURNING id`,
                    [[kyc_type], JSON.stringify(status), user_id, reason ?? null]
                );
                // A declined ID is released so its real owner can still verify it later.
                if (status === 'declined' && result.rows[0]) {
                    await client.query(
                        'DELETE FROM kyc_id_fingerprints WHERE user_id = $1 AND id_type = $2',
                        [user_id, kyc_type]
                    );
                }
            } else if (kyc_type === 'address') {
                result = await client.query(
                    'UPDATE kyc_address SET review_status = $1, review_reason = $3, updated_at = NOW() WHERE user_id = $2 RETURNING id',
                    [status, user_id, reason ?? null]
                );
            } else {
                result = await client.query(
                    'UPDATE kyc_business SET verification_status = $1, review_reason = $3, updated_at = NOW() WHERE user_id = $2 RETURNING id',
                    [status, user_id, reason ?? null]
                );
            }
            await client.query('COMMIT');
            return result.rows[0] || null;
        } catch (err) {
            await client.query('ROLLBACK').catch(() => {});
            console.error('KYC database operation failed', { errorCode: err?.code ?? null });
            throw err;
        } finally {
            client.release();
        }
    }

    static async kycSubmissions(kycType, filter = {}, offset = 0, limit = 20) {
        if (!KYC_TYPES.includes(kycType)) throw new Error('Invalid KYC type');

        const sortBy = SORTABLE_COLUMNS.includes(filter.sort_by) ? filter.sort_by : 'created_at';
        const sortOrder = String(filter.sort_order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), MAX_PAGE_SIZE);
        const safeOffset = Math.max(parseInt(offset, 10) || 0, 0);

        const search = typeof filter.search === 'string' ? filter.search.trim().slice(0, 100) : '';
        const values = search ? [`%${search}%`] : [];
        const where = search
            ? 'WHERE (u.firstname ILIKE $1 OR u.lastname ILIKE $1 OR u.email ILIKE $1 OR u.phone ILIKE $1)'
            : '';
        const from = `FROM kyc_${kycType} k JOIN users u ON u.id = k.user_id ${where}`;

        const count = await pool.query(`SELECT COUNT(*)::INTEGER AS total ${from}`, values);

        const index = values.length + 1;
        const { rows } = await pool.query(
            `SELECT ${LIST_COLUMNS[kycType]}, u.firstname, u.lastname, u.email, u.phone ${from}
             ORDER BY k.${sortBy} ${sortOrder}, k.id ${sortOrder}
             LIMIT $${index} OFFSET $${index + 1}`,
            [...values, safeLimit, safeOffset]
        );

        return { rows: rows.map(row => present(row, kycType, false)), total: count.rows[0].total };
    }

    static async kycSubmissionById(id, kycType) {
        if (!KYC_TYPES.includes(kycType)) throw new Error('Invalid KYC type');
        const { rows } = await pool.query(
            `SELECT ${DETAIL_COLUMNS[kycType]}, u.firstname, u.lastname, u.email, u.phone
             FROM kyc_${kycType} k JOIN users u ON u.id = k.user_id
             WHERE k.id = $1 LIMIT 1`,
            [id]
        );
        if (!rows[0]) return undefined;

        if (kycType === 'identity') {
            const { rows: evidence } = await pool.query(
                `SELECT id_type, selfie, id_document, country
                 FROM kyc_identity_evidence WHERE user_id = $1 ORDER BY id_type`,
                [rows[0].user_id]
            );
            rows[0].documents = evidence;
            if (!evidence.length && Object.keys(rows[0].id_type ?? {}).length === 1) {
                rows[0].documents = [{
                    id_type: Object.keys(rows[0].id_type)[0],
                    selfie: rows[0].selfie,
                    id_document: rows[0].id_document,
                    country: rows[0].country,
                }];
            } else if (!evidence.length && Object.keys(rows[0].id_type ?? {}).length > 1) {
                rows[0].unassigned_legacy_evidence = {
                    selfie: rows[0].selfie,
                    id_document: rows[0].id_document,
                    country: rows[0].country,
                };
            }
            delete rows[0].selfie;
            delete rows[0].id_document;
        }

        return present(rows[0], kycType, true);
    }
}
