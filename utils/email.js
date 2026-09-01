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

export const buildVerificationOtpEmail = (otp) => {
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
    return { subject, text, html };
};

export const buildPasswordResetEmail = (resetUrl) => {
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
    return { subject, text, html };
};

export const buildLoginAlertEmail = (name = "there") => {
    const subject = "Your account was logged in";
    const text = `Hello ${name},\n\nWe noticed a successful sign-in to your WOFBI account.\n\nIf this was you, no further action is needed. If you did not sign in, please reset your password immediately and contact support.`;
    const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
            <h2>Account sign-in successful</h2>
            <p>Hello ${name},</p>
            <p>We noticed a successful sign-in to your WOFBI account.</p>
            <p>If this was you, no further action is needed. If you did not sign in, please reset your password immediately and contact support.</p>
        </div>
    `;
    return { subject, text, html };
};

export const sendVerificationOtpEmail = async (to, otp) => {
    const { subject, text, html } = buildVerificationOtpEmail(otp);
    await sendEmail({ to, subject, text, html });
};

export const sendLoginAlertEmail = async (to, name) => {
    const { subject, text, html } = buildLoginAlertEmail(name);
    await sendEmail({ to, subject, text, html });
};

export const sendPasswordResetEmail = async (to, resetUrl) => {
    const { subject, text, html } = buildPasswordResetEmail(resetUrl);
    await sendEmail({ to, subject, text, html });
};

/* ------------------------------------------------- admissions notifications -- */

/**
 * Fire-and-forget wrapper for notifications.
 *
 * Verification codes and password resets must fail loudly — the user is sitting
 * there waiting for them. Notifications are different: if the mail server is
 * down, an admin approving an application should still see their action succeed.
 * So these are logged and swallowed rather than propagated.
 */
const notify = async (label, payload) => {
    try {
        await sendEmail(payload);
    } catch (error) {
        console.error(`[email] failed to send ${label} to ${payload.to}: ${error.message}`);
    }
};

/** Shared shell so every notification looks like it came from the same institution. */
const layout = (heading, bodyHtml) => `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1a1a1a;">
            <h2 style="color: #b91c1c;">${heading}</h2>
            ${bodyHtml}
            <p style="color: #666; font-size: 13px; margin-top: 28px;">
                Word of Faith Bible Institute · Living Faith Church new jerusalem ilorin  kwara state · Nigeria
            </p>
        </div>
`;

export const buildApplicationPendingEmail = ({ name, applicationId, programme }) => {
    const subject = `Application pending review — ${applicationId}`;
    const text = `Dear ${name},\n\nWe have received your WOFBI application for the ${programme}.\n\nYour application reference is ${applicationId}. Our admissions team is reviewing your details and will email you once a decision has been made.\n\nYou can check your status anytime from your dashboard.`;
    const html = layout(
        "Your application is pending review",
        `<p>Dear ${name},</p>
         <p>Thank you for applying to the Word of Faith Bible Institute. We have received your application for the <strong>${programme}</strong>.</p>
         <p>Your application reference is
            <strong style="font-family: monospace; font-size: 16px;">${applicationId}</strong>.
         </p>
         <p>Our admissions team is currently reviewing your application, payment confirmation and supporting information. We will email you as soon as a decision is made.</p>
         <p>You can check the status at any time from your dashboard.</p>`,
    );
    return { subject, text, html };
};

export const buildApplicationApprovedEmail = ({ name, studentId, programme, intake }) => {
    const subject = "Your WOFBI application has been approved";
    const text = `Dear ${name},\n\nCongratulations — your application for the ${programme} has been approved.\n\nYour student ID is ${studentId} and you are joining the ${intake} intake. Sign in to your dashboard to see your lessons, class schedule and assignments.`;
    const html = layout(
        "Congratulations — your application has been approved",
        `<p>Dear ${name},</p>
         <p>Your application for the <strong>${programme}</strong> has been approved. Welcome to the ${intake} intake.</p>
         <p>Your student ID is
            <strong style="font-family: monospace; font-size: 16px;">${studentId}</strong> —
            please quote it in any correspondence with the institute.
         </p>
         <p>The class is starting soon. 17th-29th August 2026</p>
         <p>Sign in to your dashboard to see your lessons, class schedule and assignments.</p>`,
    );
    return { subject, text, html };
};

export const buildApplicationRejectedEmail = ({ name, note }) => {
    const subject = "An update on your WOFBI application";
    const text = `Dear ${name},\n\nThank you for your interest in the Word of Faith Bible Institute. After careful review, we are unable to offer you a place in this intake.\n\n${note || ""}\n\nYou are welcome to apply again for a future intake.`;
    const html = layout(
        "An update on your application",
        `<p>Dear ${name},</p>
         <p>Thank you for your interest in the Word of Faith Bible Institute. After careful review, we are unable to offer you a place in this intake.</p>
         ${note ? `<blockquote style="border-left: 4px solid #e5e7eb; margin: 16px 0; padding: 12px 16px;">${note}</blockquote>` : ""}
         <p>You are very welcome to apply again for a future intake. We wish you every blessing.</p>`,
    );
    return { subject, text, html };
};

export const sendApplicationSubmittedEmail = async (to, { name, applicationId, programme }) => {
    const { subject, text, html } = buildApplicationPendingEmail({ name, applicationId, programme });
    return notify("application receipt", { to, subject, text, html });
};

export const sendApplicationApprovedEmail = async (to, payload) => {
    const { subject, text, html } = buildApplicationApprovedEmail(payload);
    return notify("admission approval", { to, subject, text, html });
};

export const sendApplicationInfoRequestedEmail = async (to, { name, note }) =>
    notify("information request", {
        to,
        subject: "More information needed for your WOFBI application",
        text: `Dear ${name},\n\nOur admissions team needs a little more information before they can finish reviewing your application.\n\n${note}\n\nPlease sign in to your dashboard, update your application, and submit it again.`,
        html: layout(
            "We need a little more information",
            `<p>Dear ${name},</p>
             <p>Our admissions team has reviewed your application and needs some more information before they can finish:</p>
             <blockquote style="border-left: 4px solid #fbbf24; background: #fffbeb; margin: 16px 0; padding: 12px 16px;">${note}</blockquote>
             <p>Please sign in to your dashboard, update your application, and submit it again. Nothing you have already entered will be lost.</p>`,
        ),
    });

export const sendApplicationRejectedEmail = async (to, payload) => {
    const { subject, text, html } = buildApplicationRejectedEmail(payload);
    return notify("admission decision", { to, subject, text, html });
};

export const sendPaymentApprovedEmail = async (to, { name, receiptNumber, amount, programme }) =>
    notify("payment confirmation", {
        to,
        subject: `Payment confirmed — ${receiptNumber}`,
        text: `Dear ${name},\n\nWe have confirmed your ${amount} registration payment for the ${programme}.\n\nYour receipt number is ${receiptNumber}. Please keep it for your records.`,
        html: layout(
            "Your payment has been confirmed",
            `<p>Dear ${name},</p>
             <p>We have confirmed your <strong>${amount}</strong> registration payment for the <strong>${programme}</strong>.</p>
             <p>Your receipt number is
                <strong style="font-family: monospace; font-size: 16px;">${receiptNumber}</strong>.
                Please keep it for your records.
             </p>`,
        ),
    });

export const sendPaymentRejectedEmail = async (to, { name, receiptNumber, note }) =>
    notify("payment rejection", {
        to,
        subject: `We could not confirm your payment — ${receiptNumber}`,
        text: `Dear ${name},\n\nWe were unable to confirm the payment receipt you uploaded (${receiptNumber}).\n\n${note || "Please check the details and upload a clearer copy of your receipt."}\n\nSign in to your dashboard to upload a new receipt.`,
        html: layout(
            "We could not confirm your payment",
            `<p>Dear ${name},</p>
             <p>We were unable to confirm the payment receipt you uploaded (<strong style="font-family: monospace;">${receiptNumber}</strong>).</p>
             <blockquote style="border-left: 4px solid #fca5a5; background: #fef2f2; margin: 16px 0; padding: 12px 16px;">${
                 note || "Please check the details and upload a clearer copy of your receipt."
             }</blockquote>
             <p>Sign in to your dashboard to upload a new receipt. If you believe this is a mistake, reply to this email and we will look into it.</p>`,
        ),
    });
