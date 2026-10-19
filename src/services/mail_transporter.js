import nodemailer from 'nodemailer';
import { config } from 'dotenv';
config();


export const transporter = nodemailer.createTransport({
    host: process.env.MAILER_HOST,
    port: process.env.MAILER_PORT || 2525,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    secure: process.env.MAIL_SECURE === 'true',
    auth: {
        user: process.env.MAILER_USER,
        pass: process.env.MAILER_PASSWORD,
    },
    tls: {
        rejectUnauthorized: true,
    },
    requireTLS: true,
    logger: false,
    debug: false,
});

export default transporter;
