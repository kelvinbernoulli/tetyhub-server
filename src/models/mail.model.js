import { emailVerification } from "#templates/account.activation.js";
import transporter from "#services/mail_transporter.js";
import { resetPassword } from "#templates/reset.password.js";
// import { adminRegistration } from "#templates/admin.reg.js";
// import { orderConfirmation } from "#templates/order.comfirmation.js";

export const sendEmailVerificationLink = async (user, verificationLink, vendor) => {
    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Email Verification',
        html: emailVerification(user, verificationLink, vendor)
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

export const sendPasswordResetLink = async (user, resetLink, vendor) => {
    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Password Reset',
        html: resetPassword(user, resetLink, vendor)
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

export const sendAdminRegistrationEmail = async (user, data, vendor) => {
    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Admin Registration',
        html: adminRegistration(user, data, vendor)
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

export const sendOrderConfirmationEmail = async (user, order, vendor) => {
    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Order Confirmation',
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

export default {
    sendEmailVerificationLink,
    sendAdminRegistrationEmail,
    sendPasswordResetLink,
    sendOrderConfirmationEmail
};
