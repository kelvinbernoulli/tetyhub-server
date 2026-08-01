import nodemailer from 'nodemailer';
import { config } from 'dotenv';
config();

export const transporter = nodemailer.createTransport({
    host: process.env.MAILER_HOST,
    port: process.env.MAILER_PORT || 587,
    secure: process.env.MAIL_SECURE === 'true',
    auth: {
        user: process.env.MAILER_USER,
        pass: process.env.MAILER_PASSWORD
    },
    tls: {
        ciphers: 'TLSv1.2',
        rejectUnauthorized: false
    },
    requireTLS: true,
    logger: false,
    debug: true
});

export default transporter;