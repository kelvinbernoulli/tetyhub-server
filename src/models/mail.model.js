import transporter from "#services/mail_transporter.js";
import { emailVerification } from "#templates/account.activation.js";
import { adminRegistration } from "#templates/admin.registration.js";
import { orderConfirmation } from "#templates/order.confirmation.js";
import { resetPassword } from "#templates/reset.password.js";
import { config } from "dotenv";
config();

export const sendEmailVerificationLink = async (user, verificationLink) => {
    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Email Verification',
        html: emailVerification(user, verificationLink)
    };

    try {
        let info = await transporter.sendMail(mailOptions);
        console.log("info", info)
        return true;
    } catch (error) {
        console.error('Error sending verification email:', error);
        return false
    }
};

export const sendPasswordResetLink = async (user, resetLink) => {
    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Password Reset',
        html: resetPassword(user, resetLink)
    };

    try {
        let info = await transporter.sendMail(mailOptions);
        console.log("info", info)
        return true;
    } catch (error) {
        console.error('Error sending password reset email:', error);
        return false
    }
};

export const sendAdminRegistrationEmail = async (user, data) => {
    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Admin Registration',
        html: adminRegistration(user, data)
    };

    try {
        let info = await transporter.sendMail(mailOptions);
        console.log("info", info)
        return true;
    } catch (error) {
        console.error('Error sending admin reg email:', error);
        return false
    }
};

export const sendOrderConfirmationEmail = async (user, order) => {
    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Order Confirmation',
        html: orderConfirmation(user, order)
    };

    try {
        let info = await transporter.sendMail(mailOptions);
        console.log("info", info)
        return true;
    } catch (error) {
        console.error('Error sending order email:', error);
        return false
    }
};

export const sendOrderStatusEmail = async (user, order, vendor) => {
    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Order Status Update',
        html: orderConfirmation(user, order, vendor)
    };

    try {
        let info = await transporter.sendMail(mailOptions);
        console.log("info", info)
        return true;
    } catch (error) {
        console.error('Error sending order email:', error);
        return false
    }
};