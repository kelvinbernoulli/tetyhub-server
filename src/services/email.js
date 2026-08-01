import nodemailer from 'nodemailer';

var transporter = nodemailer.createTransport({
    host: "smtp.zeptomail.com",
    port: 587,
    auth: {
        user: "emailapikey",
        pass: "wSsVR60kqRXyD/9/zWKuL+Y/nVQDU12lHUsv31eo6Xf5GayTocc7lxXLAwChTfcWF2Y8RjIX9b8szB9Rh2Fah9ormwxTXiiF9mqRe1U4J3x17qnvhDzIWmRclhuMKooNwAhpm2RlFsAh+g=="
    }
});

async function sendEmail(email, subject, html) {
    const mailOptions = {
        from: "no-reply@sportx.com",
        to: email,
        subject: subject,
        html: html,
    };
    return transporter.sendMail(mailOptions);
}

export default { sendEmail };