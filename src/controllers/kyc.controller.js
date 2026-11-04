import { randomUUID } from 'node:crypto';
import { Activity } from '#models/activity.model.js';
import { KYC } from '#models/kyc.model.js';
import { sendKYCSubmissionEmail } from '#models/mail.model.js';
import { addressSchema, businessSchema, identitySchema, kycUpdateSchema } from '#schemas/kyc.schema.js';
import { S3delete, S3upload } from '#services/s3bucket.js';
import ERROR_CODES from '#utils/error.codes.js';
import {
    handleIDRequestFields,
    handleBusinessRequestFields,
    handleAddressRequestFields,
    handlePremblyRequest,
    handlePremblyAddressStatusRequest,
    idFingerprint,
    isPremblyVerified,
    isPremblyAddressAccepted,
} from '#utils/kyc.js';
import { respondWithError, respondWithSuccess } from '#utils/response.js';
import redisClient from '#config/redis.js';

// Every provider call is billable, so cap them per user and serialise concurrent ones.
const MAX_ATTEMPTS_PER_DAY = 5;
const ATTEMPT_WINDOW_SECONDS = 24 * 60 * 60;
const INFLIGHT_LOCK_SECONDS = 120;

const RATE_LIMIT_CODE = ERROR_CODES.TOO_MANY_REQUESTS;

const validationError = (res, error) => respondWithError(res, 422, error.details.map(item => item.message).join(', '), ERROR_CODES.VALIDATION_ERROR);

const internalError = res => respondWithError(res, 500, 'KYC request could not be completed.', ERROR_CODES.INTERNAL_SERVER_ERROR);

const duplicate = res => respondWithError(res, 409, 'You have already submitted these verification details.', ERROR_CODES.DUPLICATE_RESOURCE);

const unauthenticated = res => respondWithError(res, 401, 'Authentication required.', ERROR_CODES.UNAUTHORIZED);

const tooManyAttempts = res => respondWithError(res, 429, 'Too many verification attempts today. Please try again tomorrow.', RATE_LIMIT_CODE);

const recordAudit = async (actorId, action, details) => {
    try {
        await Activity.logActivity(actorId, action, details);
    } catch (error) {
        console.error('KYC audit log write failed', { errorCode: error?.code ?? null });
    }
};

const notifySubmission = async (user, type) => {
    // A notification failure must not turn a persisted submission into an API failure.
    try {
        const sent = await sendKYCSubmissionEmail(user, type);
        if (!sent) console.warn('KYC submission email was not sent', { userId: user.id, type });
    } catch (error) {
        console.error('KYC submission email failed', { userId: user.id, type, errorCode: error?.code ?? null });
    }
};

const cleanup = async (keys, userId) => {
    const targets = (keys ?? []).filter(Boolean);
    if (!targets.length) return;
    const results = await Promise.allSettled(targets.map(key => Promise.resolve().then(() => S3delete(key))));
    const failed = results.filter(result => result.status === 'rejected' || result.value?.error);
    if (failed.length) console.error('KYC upload cleanup failed', { userId, failedCount: failed.length });
};

const uploadKycFile = async (file, userId, folder, uploaded) => {
    const key = 'kyc/' + userId + '/' + folder + '/' + randomUUID();
    const result = await S3upload(file, key);
    if (!result || result.error || !result.url) {
        const error = new Error('KYC file upload failed');
        error.code = 'KYC_S3_UPLOAD_FAILED';
        throw error;
    }
    uploaded.push(key);
    return key;
};

// Returns a release function, or null (after responding 409) if a request of this
// kind is already running for the user. Prevents two parallel requests both paying the provider.
const acquireGuard = async (res, userId, kind) => {
    const key = `kyc:inflight:${kind}:${userId}`;
    const locked = await redisClient.set(key, '1', { NX: true, EX: INFLIGHT_LOCK_SECONDS });
    if (!locked) {
        respondWithError(res, 409, 'A verification request is already in progress.', ERROR_CODES.DUPLICATE_RESOURCE);
        return null;
    }
    return () => redisClient.del(key).catch(() => {});
};

const withinAttemptLimit = async (userId, kind) => {
    const key = `kyc:attempts:${kind}:${userId}`;
    const count = await redisClient.incr(key);
    if (count === 1) await redisClient.expire(key, ATTEMPT_WINDOW_SECONDS);
    return count <= MAX_ATTEMPTS_PER_DAY;
};

const handleError = async (res, error, { uploaded = [], userId, saved = false } = {}) => {
    console.error('KYC controller operation failed', { errorName: error?.name ?? 'Error', errorCode: error?.code ?? null });
    if (!saved) await cleanup(uploaded, userId);
    if (error?.status === 422) return respondWithError(res, 422, error.message, ERROR_CODES.VALIDATION_ERROR);
    if (error?.code === 'KYC_ID_IN_USE') {
        return respondWithError(res, 409, 'This ID is already linked to another account.', ERROR_CODES.DUPLICATE_RESOURCE);
    }
    if (error?.code === '23505') return duplicate(res);
    return internalError(res);
};

const verify = async (res, fields, type, userId) => {
    const response = await handlePremblyRequest(fields.DATA, fields.URL);
    if (!response.success) {
        console.warn('KYC provider verification failed', { type, userId, kind: response.kind ?? null, providerCode: response.code ?? null });
        if (response.kind === 'rejected') {
            respondWithError(res, 422, 'Verification was not successful.', ERROR_CODES.VALIDATION_ERROR);
        } else {
            respondWithError(res, 502, response.message, ERROR_CODES.EXTERNAL_SERVICE_ERROR);
        }
        return null;
    }
    const accepted = type === 'address'
        ? isPremblyAddressAccepted(response.result)
        : isPremblyVerified(response.result, type, fields.EXPECTED_DOCUMENT_NUMBER);
    if (!accepted) {
        console.info('KYC provider did not verify submitted details', { type, userId });
        respondWithError(res, 422, 'Verification was not successful.', ERROR_CODES.VALIDATION_ERROR);
        return null;
    }
    return response.result;
};

export const verifyIdentity = async (req, res) => {
    const uploaded = [];
    let saved = false;
    let release = null;
    const user = req.session?.user;
    try {
        if (!user?.id) return unauthenticated(res);

        const { error, value } = identitySchema.validate(req.body ?? {}, { abortEarly: false, stripUnknown: true });
        if (error) return validationError(res, error);

        release = await acquireGuard(res, user.id, 'identity');
        if (!release) return;

        const type = value.id_type.toLowerCase();
        const existing = await KYC.getIdentityByUserId(user.id);
        if (existing?.verification_status?.[type] && existing.verification_status[type] !== 'declined') return duplicate(res);

        // Free checks first: refuse an ID that already belongs to someone else before paying to verify it.
        const fingerprint = idFingerprint(type, value.id_number);
        const owner = await KYC.fingerprintOwner(type, fingerprint);
        if (owner && Number(owner) !== Number(user.id)) {
            return respondWithError(res, 409, 'This ID is already linked to another account.', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        if (!await withinAttemptLimit(user.id, 'identity')) return tooManyAttempts(res);

        const result = await verify(res, handleIDRequestFields(value), 'identity', user.id);
        if (!result) return;

        value.selfie_image = await uploadKycFile(value.selfie_image, user.id, 'selfies', uploaded);
        if (value.id_type === 'PP') {
            value.id_document = await uploadKycFile(value.id_document, user.id, 'documents', uploaded);
        } else {
            delete value.id_document;
        }

        const outcome = await KYC.insertIdentity(user.id, value, result, fingerprint);
        if (!outcome) {
            await cleanup(uploaded, user.id);
            return duplicate(res);
        }
        saved = true;
        await cleanup(outcome.previousKeys, user.id); // files replaced by this submission

        console.info('KYC submission saved', { type: 'identity', userId: user.id });
        await recordAudit(user.id, 'KYC identity submitted', {ip_address: req.ip, user_agent: req.headers['user-agent']});
        await notifySubmission(user, 'Identity');
        return respondWithSuccess(res, 200, 'Identity verification submitted for review.');
    } catch (error) {
        return handleError(res, error, { uploaded, userId: user?.id, saved });
    } finally {
        if (release) await release();
    }
};

export const verifyBusiness = async (req, res) => {
    const uploaded = [];
    let saved = false;
    let release = null;
    const user = req.session?.user;
    try {
        if (!user?.id) return unauthenticated(res);

        const { error, value } = businessSchema.validate(req.body ?? {}, { abortEarly: false, stripUnknown: true });
        if (error) return validationError(res, error);

        release = await acquireGuard(res, user.id, 'business');
        if (!release) return;

        const existing = await KYC.getBusinessByUserId(user.id);
        if (existing && existing.verification_status !== 'declined') return duplicate(res);

        if (await KYC.registrationNumberInUse(value.registration_number, user.id)) {
            return respondWithError(res, 409, 'This business registration number is already linked to another account.', ERROR_CODES.DUPLICATE_RESOURCE);
        }

        if (!await withinAttemptLimit(user.id, 'business')) return tooManyAttempts(res);

        const verification = await verify(res, handleBusinessRequestFields(value), 'business', user.id);
        if (!verification) return;

        value.business_document = await uploadKycFile(value.business_document, user.id, 'business', uploaded);

        const outcome = await KYC.insertBusiness(user.id, value, verification);
        if (!outcome) {
            await cleanup(uploaded, user.id);
            return duplicate(res);
        }
        saved = true;
        await cleanup(outcome.previousKeys, user.id);

        console.info('KYC submission saved', { type: 'business', userId: user.id });
        await recordAudit(user.id, 'KYC business submitted', {ip_address: req.ip, user_agent: req.headers['user-agent']});
        await notifySubmission(user, 'Business');
        return respondWithSuccess(res, 200, 'Business verification submitted for review.');
    } catch (error) {
        return handleError(res, error, { uploaded, userId: user?.id, saved });
    } finally {
        if (release) await release();
    }
};

export const verifyAddress = async (req, res) => {
    let release = null;
    const user = req.session?.user;
    try {
        if (!user?.id) return unauthenticated(res);
        const contact = await KYC.getAddressContact(user.id);
        if (!contact?.firstname || !contact?.lastname || !contact?.phone || !contact?.email) {
            return respondWithError(
                res,
                422,
                'Complete your name, phone number, and email in your profile before address verification.',
                ERROR_CODES.VALIDATION_ERROR
            );
        }

        const { error, value } = addressSchema.validate(req.body ?? {}, { abortEarly: false, stripUnknown: true });
        if (error) return validationError(res, error);

        release = await acquireGuard(res, user.id, 'address');
        if (!release) return;

        const existing = await KYC.getAddressByUserId(user.id);
        if (existing && existing.review_status !== 'declined') return duplicate(res);

        if (!await withinAttemptLimit(user.id, 'address')) return tooManyAttempts(res);

        const result = await verify(res, handleAddressRequestFields(value, contact), 'address', user.id);
        if (!result) return;

        const outcome = await KYC.insertAddress(user.id, { ...value, verification_type: 'PERSON', country: 'NG' }, result);
        if (!outcome) return duplicate(res);

        console.info('KYC submission saved', { type: 'address', userId: user.id });
        await recordAudit(user.id, 'KYC address submitted', {ip_address: req.ip, user_agent: req.headers['user-agent']});
        await notifySubmission(user, 'Address');
        return respondWithSuccess(res, 200, 'Address verification requested; pending review.', {
            reference: outcome.providerJobId,
            review_status: 'pending',
        });
    } catch (error) {
        return handleError(res, error, { userId: user?.id });
    } finally {
        if (release) await release();
    }
};

export const fetchAddressVerificationStatus = async (req, res) => {
    const user = req.session?.user;
    try {
        if (!user?.id) return unauthenticated(res);

        const submission = await KYC.getAddressStatus(user.id);
        if (!submission) {
            return respondWithError(res, 404, 'Address verification not found.', ERROR_CODES.RESOURCE_NOT_FOUND);
        }
        if (!submission.provider_job_id) {
            return respondWithError(res, 409, 'This address submission has no Prembly status reference.', ERROR_CODES.INVALID_STATE);
        }
        const checkedAt = submission.provider_checked_at ? new Date(submission.provider_checked_at) : null;
        if (checkedAt && Date.now() - checkedAt.getTime() < 5 * 60 * 1000) {
            return respondWithSuccess(res, 200, 'Address verification status retrieved.', {
                review_status: submission.review_status,
                provider_status: submission.provider_status,
                checked_at: checkedAt,
            });
        }

        const providerResult = await handlePremblyAddressStatusRequest(submission.provider_job_id);
        if (!providerResult.success) {
            return respondWithError(res, 502, providerResult.message, ERROR_CODES.EXTERNAL_SERVICE_ERROR);
        }

        const providerStatus = providerResult.result?.data?.message?.status
            ?? providerResult.result?.data?.addressStatus
            ?? 'pending';
        const statusCheckedAt = new Date();
        await KYC.saveAddressProviderStatus(user.id, String(providerStatus), statusCheckedAt);

        return respondWithSuccess(res, 200, 'Address verification status retrieved.', {
            review_status: submission.review_status,
            provider_status: String(providerStatus),
            checked_at: statusCheckedAt,
        });
    } catch (error) {
        console.error('KYC address status check failed', { errorName: error?.name ?? 'Error', errorCode: error?.code ?? null });
        return internalError(res);
    }
};

export const updateKycStatus = async (req, res) => {
    try {
        const adminId = req.session?.user?.id;
        if (!adminId) return unauthenticated(res);

        const { error, value } = kycUpdateSchema.validate(req.body ?? {}, { abortEarly: false, stripUnknown: true });
        if (error) return validationError(res, error);

        const { kyc_type, user_id } = value;
        const identity = ['nin', 'bvn', 'pp'].includes(kyc_type);
        const submission = identity ? await KYC.getIdentityByUserId(user_id)
            : kyc_type === 'business' ? await KYC.getBusinessByUserId(user_id) : await KYC.getAddressByUserId(user_id);
        if (!submission || (identity && !submission.verification_status?.[kyc_type])) {
            return respondWithError(res, 404, 'KYC submission not found.', ERROR_CODES.RESOURCE_NOT_FOUND);
        }

        const result = await KYC.updateUserKycStatus(value);
        if (!result) return respondWithError(res, 404, 'KYC submission not found.', ERROR_CODES.RESOURCE_NOT_FOUND);

        await recordAudit(adminId, 'KYC status update', { user_id, kyc_type, status: value.status, ip_address: req.ip, user_agent: req.headers['user-agent'] });
        console.info('KYC status updated', { userId: user_id, type: kyc_type, status: value.status });
        return respondWithSuccess(res, 200, 'KYC status updated successfully.');
    } catch (error) {
        return handleError(res, error);
    }
};

export const fetchKYCSubmissions = async (req, res) => {
    try {
        const adminId = req.session?.user?.id;
        if (!adminId) return unauthenticated(res);

        const { kyc_type = 'identity' } = req.query;
        if (!['identity', 'business', 'address'].includes(kyc_type)) {
            return respondWithError(res, 422, 'Invalid KYC type.', ERROR_CODES.VALIDATION_ERROR);
        }
        const { offset, limit } = req.pagination;
        const result = await KYC.kycSubmissions(kyc_type, req.query, offset, limit);
        await recordAudit(adminId, 'KYC submissions listed', { type: kyc_type, count: result.rows.length, ip_address: req.ip, user_agent: req.headers['user-agent'] });
        return respondWithSuccess(res, 200, 'KYC submissions retrieved.', { data: result.rows, total_count: result.total });
    } catch (error) {
        return handleError(res, error);
    }
};

export const viewKYCSubmission = async (req, res) => {
    try {
        const adminId = req.session?.user?.id;
        if (!adminId) return unauthenticated(res);

        const { kyc_type = 'identity' } = req.query;
        const id = Number(req.params.id);
        if (!['identity', 'business', 'address'].includes(kyc_type) || !Number.isSafeInteger(id) || id < 1) {
            return respondWithError(res, 422, 'Invalid KYC type or identifier.', ERROR_CODES.VALIDATION_ERROR);
        }
        const result = await KYC.kycSubmissionById(id, kyc_type);
        if (!result) return respondWithError(res, 404, 'KYC submission not found.', ERROR_CODES.RESOURCE_NOT_FOUND);
        await recordAudit(adminId, 'KYC submission viewed', { type: kyc_type, submissionId: id, ip_address: req.ip, user_agent: req.headers['user-agent'] });
        return respondWithSuccess(res, 200, 'KYC submission retrieved.', result);
    } catch (error) {
        return handleError(res, error);
    }
};
