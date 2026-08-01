export const Header = ({
        platformName = "TetyHub",
        logoUrl = "",
    } = {}) => `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
        <title>${platformName} Notification</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f5f7; font-family: Arial, sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: auto; background-color: #ffffff; border-radius: 8px; overflow: hidden;">
            <tr>
                <td style="padding: 20px; text-align: center; background-color: #02042D;">
                    ${
                        logoUrl
                            ? `<img src="${logoUrl}" alt="${platformName}" style="max-height: 45px;" />`
                            : `<h2 style="margin: 0; color: #ffffff;">${platformName}</h2>`
                    }
                </td>
            </tr>
    `;

export const Footer = ({
    platformName = "TetyHub",
    supportEmail = "",
    websiteUrl = "#",
    year = new Date().getFullYear(),
} = {}) => `
        <tr>
            <td style="padding: 25px; background-color: #f9fafb; text-align: center;">
                
                <p style="color: #555; font-size: 14px;">
                    You're receiving this email because you have an account on ${platformName}.
                </p>

                <p style="margin: 15px 0;">
                    <a href="${websiteUrl}" 
                       style="background-color: #02042D; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 5px; font-size: 14px;">
                        Go to Dashboard
                    </a>
                </p>

                <p style="font-size: 13px; color: #777;">
                    Need help? Contact us at 
                    <a href="mailto:${supportEmail}" style="color: #02042D;">${supportEmail}</a>
                </p>

                <hr style="margin: 20px 0; border: none; border-top: 1px solid #ddd;" />

                <p style="font-size: 12px; color: #999;">
                    &copy; ${year} ${platformName}. All rights reserved.
                </p>
            </td>
        </tr>
    </table>
</body>
</html>
`;

export default {
    Header,
    Footer,
};