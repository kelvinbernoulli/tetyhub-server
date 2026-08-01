import crypto from 'crypto';

const algorithm = 'aes-256-cbc';
const secretKey = Buffer.from('V54DK1qhfbSDYZjuZRQIrC+lb/PQcjgs0bRjpBRLKI4=', 'base64');
const ivLength = 16; // For AES, this is always 16

export function encrypt(text) {
    const iv = crypto.randomBytes(ivLength); 
    const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text) {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(algorithm, secretKey, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}