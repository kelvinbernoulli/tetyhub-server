import crypto from 'crypto';

export const generateCsrfToken = () => crypto.randomBytes(32).toString('base64url');

export const csrfTokensMatch = (expected, provided) => {
    if (typeof expected !== 'string' || typeof provided !== 'string') return false;
    const expectedBuffer = Buffer.from(expected, 'utf8');
    const providedBuffer = Buffer.from(provided, 'utf8');
    if (expectedBuffer.length !== providedBuffer.length) return false;
    return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
};
