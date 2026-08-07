import nodemailer from "nodemailer";

// A single reusable transporter, created lazily on first use.
let transporter;

const isConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const getTransporter = () => {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            // `secure` must be true for port 465, false for 587/2525 (STARTTLS).
            secure: process.env.SMTP_SECURE === "true",
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        });
    }
    return transporter;
};

// Sends an email. Falls back to logging in development if SMTP isn't configured,
// so the reset flow keeps working locally without credentials.
export const sendEmail = async ({ to, subject, text, html }) => {
    if (!isConfigured()) {
        if (process.env.NODE_ENV === "production") {
            throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.");
        }
        console.info(`[email:dev] SMTP not configured — would send to ${to}\nSubject: ${subject}\n${text || html}`);
        return;
    }

    const from = process.env.EMAIL_FROM || "no-reply@example.com";
    await getTransporter().sendMail({ from, to, subject, text, html });
};

export const sendVerificationOtpEmail = async (to, otp) => {
    const subject = "Verify your email address";
    const text = `Welcome! Your verification code is:\n\n${otp}\n\nThis code expires in 15 minutes.\n\nIf you didn't create an account, you can safely ignore this email.`;
    const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
            <h2>Verify your email address</h2>
            <p>Welcome! Enter this code to verify your email address and activate your account:</p>
            <div style="background: #f3f4f6; padding: 16px; border-radius: 6px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 8px; margin: 20px 0; color: #1a1a1a;">
                ${otp}
            </div>
            <p>This code is valid for <strong>15 minutes</strong>.</p>
            <p style="color: #666; font-size: 13px;">If you didn't create an account with this email, you can safely ignore this message.</p>
        </div>
    `;
    await sendEmail({ to, subject, text, html });
};

export const sendPasswordResetEmail = async (to, resetUrl) => {
    const subject = "Reset your password";
    const text = `You requested a password reset.\n\nOpen this link to choose a new password (valid for 15 minutes):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`;
    const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
            <h2>Reset your password</h2>
            <p>You requested a password reset. Click the button below to choose a new password. This link is valid for <strong>15 minutes</strong>.</p>
            <p>
                <a href="${resetUrl}" style="display: inline-block; padding: 12px 20px; background: #2563eb; color: #fff; text-decoration: none; border-radius: 6px;">Reset password</a>
            </p>
            <p>Or paste this link into your browser:<br /><a href="${resetUrl}">${resetUrl}</a></p>
            <p style="color: #666; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
        </div>
    `;
    await sendEmail({ to, subject, text, html });
};
