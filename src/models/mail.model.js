import transporter from "#services/mail_transporter.js";
import { emailVerification } from "#templates/account.activation.js";
import { adminRegistration } from "#templates/admin.registration.js";
import { orderConfirmation } from "#templates/order.confirmation.js";
import { resetPassword } from "#templates/reset.password.js";
import { subscriptionRenewal } from "#templates/subscription.renewal.js";
import { config } from "dotenv";
config();

export const sendLoginOTP = async (user, code) => {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: 'Your TetyHub login code',
            text: `Your login code is ${code}. It expires in ${process.env.OTP_EXPIRATION || 600} seconds.`,
        });
        return true;
    } catch (error) {
        console.error('Error sending login OTP email:', error.message);
        return false;
    }
};
export const sendEmailVerificationLink = async (user, verificationLink) => {
    let mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: 'Email Verification',
        html: emailVerification(user, verificationLink)
    };

    try {
        await transporter.sendMail(mailOptions);
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
        await transporter.sendMail(mailOptions);
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
        await transporter.sendMail(mailOptions);
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
        await transporter.sendMail(mailOptions);
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
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error sending order email:', error);
        return false
    }
};

export const sendSubscriptionRenewalEmail = async (user, subscription) => {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: user.email,
            subject: subscription.pendingPlan
                ? 'Your TetyHub plan change needs checkout'
                : 'Your TetyHub subscription renews soon',
            html: subscriptionRenewal({
                firstname: user.firstname,
                currentPeriodEnd: subscription.currentPeriodEnd,
                pendingPlan: subscription.pendingPlan,
            }),
        });
        return true;
    } catch (error) {
        console.error('Subscription renewal email failed:', error.message);
        return false;
    }
};
