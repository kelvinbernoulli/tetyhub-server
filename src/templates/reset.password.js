import { Header, Footer } from "./layout.js";

export const resetPassword = (user, resetUrl) => {
  return `
    ${Header()}

    <tr>
      <td style="padding: 20px 30px 0 30px; text-align: center;">
        <h2 style="margin: 0; font-weight: 600; color: #222;">
          Password Reset Request
        </h2>
      </td>
    </tr>

    <tr>
      <td style="padding: 20px 30px;">

        <p style="text-align: center; margin-bottom: 20px;">
          <img src="" height="100" alt="Reset Password" />
        </p>

        <p style="text-align: center; font-size: 15px; line-height: 1.6; color: #555;">
          Hi <strong>${user.firstname}</strong>, we received a request to reset the password
          <br />
          Click the button below to choose a new password.
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <p style="text-align: center;">
          <a href="${resetUrl}"
             style="display: inline-block; margin: 10px auto; padding: 12px 30px;
                    background-color: #007BFF; color: #fff; text-decoration: none;
                    border-radius: 5px; font-size: 15px; font-weight: 600;">
            Reset My Password
          </a>
        </p>

        <p style="text-align: center; font-size: 13px; color: #888; margin-top: 16px;">
          This link expires in <strong>10 minutes </strong>. Do not share it with anyone.
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <p style="text-align: center; font-size: 13px; color: #999;">
          If you didn't request a password reset, you can safely ignore this email.
          Your password will remain unchanged.
        </p>

      </td>
    </tr>

    ${Footer({})}
  `;
};