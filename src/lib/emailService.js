import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.DEV_MAIL_HOST,
  port: parseInt(process.env.DEV_MAIL_PORT || "587"),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.DEV_MAIL_USERNAME,
    pass: process.env.DEV_MAIL_PASSWORD,
  },
});

/**
 * Sends a 6-digit OTP to the specified email address using a Binance-style template.
 * @param {string} email - Recipient email
 * @param {string} otp - The 6-digit code
 * @param {string} type - 'Login' or 'Registration'
 */
export const sendOtpEmail = async (email, otp, type = "Login") => {
  const mailOptions = {
    from: `"YESBCK Support" <${process.env.DEV_MAIL_USERNAME}>`,
    to: email,
    subject: `[YESBCK] ${type} Verification Code`,
    html: `
      <div style="background-color: #f5f5f5; padding: 20px; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1);">
          <div style="background-color: #1e2329; padding: 20px; text-align: center;">
            <h1 style="color: #fcd535; margin: 0; font-size: 24px; letter-spacing: 2px;">YESBCK</h1>
          </div>
          <div style="padding: 40px 30px;">
            <h2 style="color: #1e2329; margin-top: 0; font-size: 22px;">${type} Verification Code</h2>
            <p style="color: #474d57; line-height: 1.6; font-size: 16px;">
              We detected a ${type.toLowerCase()} attempt for your account <strong style="color: #1e2329;">${email}</strong>.
            </p>
            <div style="background-color: #f5f5f5; padding: 20px; border-radius: 4px; margin: 30px 0; text-align: center;">
              <h1 style="color: #c99400; font-size: 40px; margin: 0; letter-spacing: 12px; font-weight: bold;">${otp}</h1>
            </div>
            <p style="color: #707a8a; font-size: 14px; line-height: 1.6;">
              This code will expire in <strong>5 minutes</strong>. If this was not you, please change your password or temporarily disable your account immediately.
            </p>
          </div>
          <div style="background-color: #fafafa; padding: 20px; text-align: center; border-top: 1px solid #eeeeee;">
            <p style="color: #aeaeae; font-size: 12px; margin: 0;">&copy; 2026 YESBCK.com. All Rights Reserved.</p>
          </div>
        </div>
      </div>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`OTP sent to ${email}`);
  } catch (error) {
    console.error("Failed to send email:", error);
    throw new Error("Could not send verification email");
  }
};
