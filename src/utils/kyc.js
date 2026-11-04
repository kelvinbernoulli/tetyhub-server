import axios from 'axios';
import { createHmac } from 'node:crypto';
import { config } from 'dotenv';
import ERROR_CODES from './error.codes.js';

config();

const BASE_URL = 'https://api.prembly.com';

// Explicit, fail-closed mode. A missing NODE_ENV on the host must never silently
// route production traffic to sandbox credentials. Set PREMBLY_MODE=test|live.
export const premblyMode = () => {
    const configuredMode = process.env.PREMBLY_MODE?.trim().toLowerCase();
    if (configuredMode) return configuredMode;
    return process.env.NODE_ENV === 'production' ? 'live' : 'test';
};

const credentialsFor = mode => {
    if (!['test', 'live'].includes(mode)) return null;
    const prefix = mode === 'live' ? 'PREMBLY_LIVE' : 'PREMBLY_TEST';
    const secretKey = process.env[`${prefix}_SECRET_KEY`] ?? process.env[`${prefix}_API_KEY`];
    const appId = process.env[`${prefix}_APP_ID`] ?? process.env[`${prefix}_PUBLIC_KEY`];
    return secretKey ? { secretKey, appId } : null;
};

export const PREMBLY_CONFIG = (credentials = {}) => ({
    timeout: 30000,
    maxRedirects: 0,
    headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(credentials.secretKey ? { 'x-api-key': credentials.secretKey } : {}),
        ...(credentials.appId ? { 'app-id': credentials.appId } : {}),
    },
});

// kind 'unavailable': our side or the provider is down/misconfigured -> 502.
// kind 'rejected': the provider understood the request and refused these details -> 422.
const unavailable = () => ({
    success: false,
    kind: 'unavailable',
    code: ERROR_CODES.EXTERNAL_SERVICE_ERROR,
    message: 'Prembly verification service is unavailable.',
});

const rejected = () => ({
    success: false,
    kind: 'rejected',
    code: ERROR_CODES.VALIDATION_ERROR,
    message: 'The identity details could not be verified.',
});

export const handlePremblyRequest = async (data, endpoint, mode = premblyMode()) => {
    try {
        if (typeof endpoint !== 'string' || !/^\/verification\/[a-zA-Z0-9/_-]+$/.test(endpoint)) return unavailable();

        const credentials = credentialsFor(mode);
        if (!credentials) {
            console.error('Prembly credentials are missing or PREMBLY_MODE is not "test"/"live"', { mode });
            return unavailable();
        }
        if (endpoint === '/verification/document_w_face' && !credentials.appId) {
            console.error('Prembly App ID is missing for document-with-face verification', { mode });
            return unavailable();
        }

        const response = await axios.post(`${BASE_URL}${endpoint}`, data, PREMBLY_CONFIG(credentials));
        return { success: true, result: response.data };
    } catch (error) {
        const status = error.response?.status;
        // Axios errors contain request headers and bodies, including secrets and biometrics.
        console.error('Prembly request failed', {
            status: status ?? null,
            code: error.code ?? null,
            errorName: error.name ?? 'Error',
        });
        if (status === 401 || status === 403) {
            console.error('Prembly rejected our credentials; check keys, app ID and PREMBLY_MODE');
        }
        // 404 is treated as our misconfiguration (wrong endpoint), not as the user's fault.
        const ourSide = [401, 403, 404, 408, 429];
        if (status >= 400 && status < 500 && !ourSide.includes(status)) return rejected();
        return unavailable();
    }
};

const invalid = message => Object.assign(new Error(message), { status: 422 });

const base64Image = value => {
    if (typeof value !== 'string' || !value) throw invalid('Image is required.');
    return value.replace(/^data:image\/[\w+.-]+;base64,/, '');
};

// Stable, non-reversible fingerprint of an ID number. Lets us detect the same
// NIN/BVN/passport being used on several accounts without a plaintext lookup column.
export const idFingerprint = (type, number) => {
    const secret = process.env.KYC_HASH_SECRET;
    if (!secret) throw new Error('KYC_HASH_SECRET is not set');
    return createHmac('sha256', secret).update(`${type}:${number}`).digest('hex');
};

export const handleIDRequestFields = value => {
    if (value.country !== 'NG') throw invalid('Unsupported identity country.');

    if (value.id_type === 'NIN') {
        return {
            URL: '/verification/nin_w_face',
            DATA: { number_nin: value.id_number, image: base64Image(value.selfie_image) },
        };
    }
    if (value.id_type === 'BVN') {
        return {
            URL: '/verification/bvn_w_face',
            DATA: { number: value.id_number, image: base64Image(value.selfie_image) },
        };
    }
    if (value.id_type === 'PP') {
        if (!value.id_document) throw invalid('Passport document image is required.');
        return {
            URL: '/verification/document_w_face',
            EXPECTED_DOCUMENT_NUMBER: value.id_number,
            DATA: {
                doc_type: 'PP',
                doc_country: 'NG',
                doc_image: base64Image(value.id_document),
                selfie_image: base64Image(value.selfie_image),
            },
        };
    }
    throw invalid('Unsupported identity document type.');
};

export const handleBusinessRequestFields = value => ({
    URL: '/verification/cac/basic',
    DATA: {
        rc_number: value.registration_number,
        company_name: value.business_name,
        company_type: value.company_type ?? 'RC',
    },
});

export const handleAddressRequestFields = (value, user) => {
    return {
        URL: '/verification/address',
        DATA: {
            first_name: user.firstname,
            last_name: user.lastname,
            phone: user.phone,
            email: user.email,
            address: value.address,
            house_number: value.house_number,
            landmark: value.landmark,
            state: value.state,
            lga: value.lga,
            street: value.street,
            city: value.city,
            address_verification_due_date: value.address_verification_due_date,
            verification_type: 'PERSON',
        }
    };
};

export const handlePremblyAddressStatusRequest = jobId =>
    handlePremblyRequest({ job_id: jobId }, '/verification/address/status');

export const isPremblyVerified = (result, type, expectedDocumentNumber) => {
    if (result?.status !== true) return false;
    if (type === 'identity') {
        const face = result.face_data ?? result.data?.face_data;
        if (face?.status !== true) return false;
        if (expectedDocumentNumber) {
            const returnedNumber = result.data?.documentNumber ?? result.data?.document_number;
            if (typeof returnedNumber !== 'string') return false;
            const normalize = value => value.replace(/[\s-]/g, '').toUpperCase();
            return normalize(returnedNumber) === normalize(expectedDocumentNumber);
        }
        return true;
    }
    if (type === 'business') {
        return result.verification?.status === 'VERIFIED';
    }
    return false;
};

export const isPremblyAddressAccepted = result => result?.status === true &&
    result?.response_code === '00' &&
    Boolean(result?.data?.job_id ?? result?.data?._id ?? result?.job_id ?? result?._id);
