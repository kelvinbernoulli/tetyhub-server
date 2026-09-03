import Crypto from 'crypto';
import pkg from 'hi-base32';
import bcrypt from "bcrypt";
import { validationResult } from 'express-validator';
import { ROLES as ROLE_CONSTANTS } from './access-control.js';
const { encode } = pkg;
import { config } from "dotenv";
config();

// generate otp code
export const generateOTP = async () => {
    const min = 100000;
    const max = 999999;
    const code = Math.floor(Math.random() * (max - min + 1)) + min;
    const now = new Date();

    return { code, now };
};

// Define the password validation function
export const validatePassword = (password) => {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    return password.length >= minLength && hasUpperCase && hasLowerCase && hasDigit && hasSpecialChar;
};

// validate email
export const isValidEmail = (email) => {
    const validateEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return validateEmail.test(email);
};

export const generateBase32Secret = () => {
    const buffer = Crypto.randomBytes(15);
    const base32 = encode(buffer).replace(/=/g, "").substring(0, 24);
    return base32;
};

//generate code
export const generateCode = () => {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 9; i++) {
        code += characters.charAt(
            Math.floor(Math.random() * characters.length)
        );
    }
    return code;
};

// generate password reset token
export const generatePasswordResetToken = async () => {
    const length = 10;
    const characters =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_";
    const charactersLength = characters.length;

    let token = "";
    for (let i = 0; i < length; i++) {
        const randomIndex = crypto.randomInt(0, charactersLength);
        token += characters[randomIndex];
    }

    const encryptedToken = await bcrypt.hash(token, 10);
    return { encryptedToken, token };
};

export const passwordHash = async (password) => {
    try {
        if (!password) {
            throw new Error("Password is required");
        }

        const salt = await bcrypt.genSalt(10);
        const hash = await bcrypt.hash(password, salt);

        return hash;
    } catch (err) {
        console.error("Error in passwordHash function:", err);
        throw err;
    }
};

export const verifyPassword = async (password, hashedPassword) => {
    try {
        const match = await bcrypt.compare(password, hashedPassword);
        return match;
    } catch (err) {
        console.error("Error in verifypassword function:", err);
        throw err;
    }
};

export const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(422).json({ errors: errors.array() });
    }
    return next()
};

const dialCodes = {
    NG: "234",
    UG: "256",
    GH: "233",
};

const patterns = {
    NG: /^(\+?234|0)[789][01]\d{8}$/,
    UG: /^(\+?256|0)7\d{8}$/,
    GH: /^(\+?233|0)[235]\d{8}$/,
};

export const normalizePhone = (phone, countryCode) => {
    if (!phone) throw new Error("Phone is required");

    const country = dialCodes[countryCode];
    const pattern = patterns[countryCode];

    if (!country || !pattern) {
        throw new Error("Unsupported country. Use NG, UG, or GH");
    }

    // Normalize input (remove spaces only for validation flexibility)
    const raw = phone.replace(/\s+/g, "");

    // Validate original structure
    if (!pattern.test(raw)) {
        throw new Error("Invalid phone number for selected country");
    }

    // Remove all non-digits
    let cleaned = raw.replace(/\D/g, "");

    // If already starts with country code
    if (cleaned.startsWith(country)) {
        return `${cleaned}`;
    }

    // If starts with 0 → replace with country code
    if (cleaned.startsWith("0")) {
        return `${country}${cleaned.slice(1)}`;
    }

    // Fallback (rare due to validation)
    return `${country}${cleaned}`;
};

export const base64ImagePattern = /^data:image\/(png|jpeg|jpg|pdf);base64,[A-Za-z0-9+/]+={0,2}$/;

export const generateTicketNumber = () => {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Crypto.randomBytes(4).toString('hex').toUpperCase();
    return `TKT-${timestamp}${random}`;
};

export const buildRedisKey = (email, type) => {
    const parts = ['otp'];
    parts.push(email.toLowerCase());
    parts.push(type);
    return parts.join(':');
};

// Roles are persisted as strings. Environment-specific numeric role IDs caused
// valid users to fail every strict role comparison.
export const ROLES = ROLE_CONSTANTS;

export const generateOrderReference = (orderId) => {
    return `ORD-${orderId}-${Date.now()}`;
};

export const frontendBase = process.env.NODE_ENV === 'production' ? process.env.FRONTEND_URL : process.env.FRONTEND_DEV_URL;
