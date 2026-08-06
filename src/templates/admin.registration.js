import { Footer, Header } from "./layout.js";

export const adminRegistration = (admin, password) => {
  return `
    ${Header()}
    <tr>
      <td style="padding: 20px 30px;">
        <p style="text-align: center; font-size: 15px; line-height: 1.6; color: #555;">
          Hi ${admin.firstname}, your tetyhub admin account has been created successfully.
          <br />
          Below are your login credentials. Please keep them safe and change your password after your first login.
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 auto; max-width: 400px;">
          <tr>
            <td style="padding: 10px; font-size: 14px; color: #555; font-weight: 600;">Email:</td>
            <td style="padding: 10px; font-size: 14px; color: #222;">${admin.email}</td>
          </tr>
          <tr style="background-color: #f9f9f9;">
            <td style="padding: 10px; font-size: 14px; color: #555; font-weight: 600;">Password:</td>
            <td style="padding: 10px; font-size: 14px; color: #222;">${password}</td>
          </tr>
        </table>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <p style="text-align: center;">
          <a href=""
             style="display: inline-block; margin: 10px auto; padding: 12px 30px;
                    background-color: #007BFF; color: #fff; text-decoration: none;
                    border-radius: 5px; font-size: 15px; font-weight: 600;">
            Login to Your Account
          </a>
        </p>

        <p style="text-align: center; font-size: 13px; color: #888; margin-top: 16px;">
          For security reasons, please change your password immediately after logging in.
        </p>

        <hr style="margin: 30px 0; border: none; border-top: 1px solid #eee;" />

        <p style="text-align: center; font-size: 13px; color: #999;">
          If you did not expect this email, please contact your administrator immediately.
        </p>

      </td>
    </tr>

    ${Footer()}
  `;
};
