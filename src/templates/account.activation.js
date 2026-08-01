import { Footer, Header } from "./layout.js";

export const emailVerification = (user, verificationLink, vendor) => {
    return `
        ${Header()}

            <tr>
                <td style="padding: 20px 30px 0 30px; text-align: center;">
                <h2 style="margin: 0; font-weight: 600; color: #222;">
                    Welcome ${user.firstname} 👋
                </h2>
                </td>
            </tr>

            <tr>
            <td style="padding: 20px 30px;">
                <p style="text-align: center; margin-bottom: 20px;">
                <img src="" height="100" alt="Verify Account" />
                </p>

                <p style="text-align: center; font-size: 15px; line-height: 1.6; color: #555;">
                    Please verify your email address to activate your account and continue securely.
                </p>

                <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

                <p style="text-align: center; font-size: 14px; color: #666;">
                Use the verification link below:
                </p>
                <a href="${verificationLink}" style="display: inline-block; margin: 20px auto; padding: 12px 25px; background-color: #007BFF; color: #fff; text-decoration: none; border-radius: 5px;">
                Verify My Account
                </a>

                <p style="text-align: center; font-size: 13px; color: #888;">
                This link expires in <strong>5 minutes</strong>. Do not share it with anyone.
                </p>

                <p style="text-align: center; font-size: 13px; color: #999; margin-top: 20px;">
                If you didn’t create an account, you can safely ignore this email.
                </p>
            </td>
            </tr>

        ${Footer()}
    `;
};