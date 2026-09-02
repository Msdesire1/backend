import nodemailer from "nodemailer";

let transporter;

const isConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
};

export const sendEmail = async ({ to, subject, text, html }) => {
  if (!isConfigured()) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SMTP is not configured. Set SMTP_HOST, SMTP_USER, and SMTP_PASS.");
    }
    console.info(`[email:dev] SMTP not configured — email was not sent to ${to}\nSubject: ${subject}\n${text || html}`);
    return;
  }
  const from = process.env.EMAIL_FROM || "Word of Faith Bible Institute <no-reply@example.com>";
  const result = await getTransporter().sendMail({ from, to, subject, text, html });
  console.info(`[email] sent successfully to ${to} | subject: ${subject} | messageId: ${result.messageId || "unavailable"}`);
};

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const BRAND = "Word of Faith Bible Institute";
const CHURCH = "Living Faith Church, New Jerusalem, Ilorin, Kwara State, Nigeria";

const notice = (html, tone = "neutral") => {
  const tones = {
    neutral: "background:#f4f5f7;border-left:4px solid #8b1e2d;color:#343a40;",
    success: "background:#edf8f0;border-left:4px solid #26824a;color:#173b24;",
    warning: "background:#fff7e7;border-left:4px solid #d48a00;color:#5c4300;",
    danger: "background:#fff0f0;border-left:4px solid #c73636;color:#621b1b;",
  };
  return `<div style="margin:22px 0;padding:14px 16px;font-size:14px;line-height:22px;${tones[tone]}">${html}</div>`;
};

const button = (href, label) => `
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 8px;">
    <tr><td style="border-radius:6px;background:#8b1e2d;">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 24px;font-family:Arial,sans-serif;font-size:15px;font-weight:700;line-height:20px;color:#ffffff;text-decoration:none;border-radius:6px;">${escapeHtml(label)}</a>
    </td></tr>
  </table>`;

const layout = (preheader, heading, content) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;color:#27313d;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f4f6;"><tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;">
      <tr><td style="padding:0 8px 18px;color:#8b1e2d;font-size:18px;font-weight:700;letter-spacing:.2px;">${BRAND}</td></tr>
      <tr><td style="background:#8b1e2d;border-radius:10px 10px 0 0;padding:26px 32px;color:#ffffff;">
        <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;opacity:.85;">WOFBI</div>
        <h1 style="margin:8px 0 0;font-size:27px;line-height:34px;font-weight:700;color:#ffffff;">${escapeHtml(heading)}</h1>
      </td></tr>
      <tr><td style="background:#ffffff;padding:30px 32px 26px;font-size:16px;line-height:25px;color:#27313d;">${content}</td></tr>
      <tr><td style="background:#f8f8f8;border-radius:0 0 10px 10px;border-top:1px solid #e6e7e9;padding:22px 32px;font-size:12px;line-height:18px;color:#667085;"><strong style="color:#424b57;">${BRAND}</strong><br>${CHURCH}</td></tr>
      <tr><td style="padding:18px 10px 0;text-align:center;font-size:11px;line-height:16px;color:#89919d;">This is an automated message. Please do not reply to this email.</td></tr>
    </table>
  </td></tr></table>
</body></html>`;

const codeBlock = (otp) => `<div style="margin:26px 0;padding:20px 14px;background:#f4f5f7;border:1px solid #e2e4e8;border-radius:8px;text-align:center;color:#1e2936;font-family:monospace;font-size:32px;font-weight:700;letter-spacing:8px;line-height:38px;">${escapeHtml(otp)}</div>`;

export const buildVerificationOtpEmail = (otp) => {
  const subject = "Verify your WOFBI email address";
  return {
    subject,
    text: `Welcome to ${BRAND}. Your verification code is ${otp}. It expires in 15 minutes. If you did not create an account, you can safely ignore this email.`,
    html: layout("Use this code to activate your WOFBI account.", "Verify your email address", `
      <p style="margin:0 0 16px;">Welcome to ${BRAND}.</p><p style="margin:0;">Enter the verification code below to activate your account.</p>
      ${codeBlock(otp)}
      ${notice("For your security, this code expires in <strong>15 minutes</strong>. Do not share it with anyone.", "warning")}
      <p style="margin:22px 0 0;font-size:14px;color:#667085;">Did not create an account? You can safely ignore this email.</p>`),
  };
};

export const buildPasswordResetEmail = (resetUrl) => {
  const subject = "Reset your WOFBI password";
  return {
    subject,
    text: `We received a request to reset your ${BRAND} password. Use this link within 15 minutes: ${resetUrl} If you did not request this, you can safely ignore this email.`,
    html: layout("Reset your password securely within 15 minutes.", "Reset your password", `
      <p style="margin:0 0 16px;">We received a request to reset your ${BRAND} password.</p><p style="margin:0;">Use the button below to choose a new password. The link expires in <strong>15 minutes</strong>.</p>
      ${button(resetUrl, "Reset password")}
      <p style="margin:22px 0 0;font-size:13px;line-height:20px;color:#667085;">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(resetUrl)}" style="color:#8b1e2d;word-break:break-all;">${escapeHtml(resetUrl)}</a></p>
      ${notice("If you did not request a password reset, you can safely ignore this email. Your existing password will remain unchanged.")}`),
  };
};

export const buildLoginAlertEmail = (name = "there") => {
  const subject = "New login to your WOFBI account";
  return {
    subject,
    text: `Hello ${name}, a successful sign-in to your WOFBI account was detected. If this was you, no action is needed. If not, reset your password immediately.`,
    html: layout("A successful sign-in to your account was detected.", "New sign-in detected", `
      <p style="margin:0 0 16px;">Hello ${escapeHtml(name)},</p><p style="margin:0;">A successful sign-in to your WOFBI account was detected.</p>
      ${notice("If this was you, no further action is required. If you do not recognise this activity, reset your password immediately.", "warning")}`),
  };
};

export const sendVerificationOtpEmail = async (to, otp) => sendEmail({ to, ...buildVerificationOtpEmail(otp) });
export const sendLoginAlertEmail = async (to, name) => sendEmail({ to, ...buildLoginAlertEmail(name) });
export const sendPasswordResetEmail = async (to, resetUrl) => sendEmail({ to, ...buildPasswordResetEmail(resetUrl) });

const notify = async (label, payload) => {
  try { await sendEmail(payload); }
  catch (error) { console.error(`[email] failed to send ${label} to ${payload.to}: ${error.message}`); }
};

const greeting = (name) => `<p style="margin:0 0 16px;">Dear ${escapeHtml(name)},</p>`;
const ref = (label, value, tone = "neutral") => notice(`${label}: <strong style="font-family:monospace;font-size:16px;">${escapeHtml(value)}</strong>`, tone);

export const buildApplicationPendingEmail = ({ name, applicationId, programme }) => {
  const subject = `Application received — pending review (${applicationId})`;
  return {
    subject,
    text: `Dear ${name}, we have received your WOFBI application for ${programme}. Your reference is ${applicationId}. Our admissions team is reviewing it and will contact you with an update.`,
    html: layout("Your application has been received and is under review.", "Application received", `${greeting(name)}<p style="margin:0;">Thank you for applying to ${BRAND}. We have received your application for <strong>${escapeHtml(programme)}</strong>.</p>${ref("Your application reference", applicationId)}<p style="margin:0;">Our admissions team is reviewing your information and will email you when there is an update.</p>`),
  };
};

export const buildApplicationApprovedEmail = ({ name, studentId, programme, intake }) => {
  const subject = "Congratulations — your WOFBI application is approved";
  return {
    subject,
    text: `Dear ${name}, congratulations. Your application for ${programme} has been approved for the ${intake} intake. Your student ID is ${studentId}. Sign in to your dashboard for your course information.`,
    html: layout("Congratulations! Your application has been approved.", "Welcome to WOFBI", `${greeting(name)}<p style="margin:0;">Congratulations. Your application for <strong>${escapeHtml(programme)}</strong> has been approved. We are delighted to welcome you to the <strong>${escapeHtml(intake)}</strong> intake.</p>${ref("Your student ID", studentId, "success")}<p style="margin:0;">Sign in to your dashboard to view your lessons, class schedule, and assignments.</p>`),
  };
};

export const buildApplicationRejectedEmail = ({ name, note }) => {
  const subject = "An update on your WOFBI application";
  return {
    subject,
    text: `Dear ${name}, thank you for your interest in ${BRAND}. After review, we are unable to offer you a place in this intake. ${note || ""} You are welcome to apply again for a future intake.`,
    html: layout("There is an update on your application.", "Application update", `${greeting(name)}<p style="margin:0;">Thank you for your interest in ${BRAND}. After careful review, we are unable to offer you a place in this intake.</p>${note ? notice(escapeHtml(note)) : ""}<p style="margin:0;">You are welcome to apply again for a future intake. We wish you every blessing.</p>`),
  };
};

export const sendApplicationSubmittedEmail = async (to, payload) => notify("application receipt", { to, ...buildApplicationPendingEmail(payload) });
export const sendApplicationApprovedEmail = async (to, payload) => notify("admission approval", { to, ...buildApplicationApprovedEmail(payload) });
export const sendApplicationRejectedEmail = async (to, payload) => notify("admission decision", { to, ...buildApplicationRejectedEmail(payload) });

export const sendApplicationInfoRequestedEmail = async (to, { name, note }) => notify("information request", {
  to,
  subject: "More information needed for your WOFBI application",
  text: `Dear ${name}, our admissions team needs more information before they can complete their review. ${note} Please sign in, update your application, and submit it again.`,
  html: layout("Your application needs a little more information.", "More information needed", `${greeting(name)}<p style="margin:0;">Our admissions team needs the following information before they can complete their review:</p>${notice(escapeHtml(note), "warning")}<p style="margin:0;">Please sign in to your dashboard, update your application, and submit it again. Your existing information will be saved.</p>`),
});

export const sendPaymentApprovedEmail = async (to, { name, receiptNumber, amount, programme }) => notify("payment confirmation", {
  to,
  subject: `Payment confirmed — ${receiptNumber}`,
  text: `Dear ${name}, we have confirmed your ${amount} registration payment for ${programme}. Your receipt number is ${receiptNumber}. Please keep it for your records.`,
  html: layout("Your registration payment has been confirmed.", "Payment confirmed", `${greeting(name)}<p style="margin:0;">We have confirmed your <strong>${escapeHtml(amount)}</strong> registration payment for <strong>${escapeHtml(programme)}</strong>.</p>${ref("Receipt number", receiptNumber, "success")}`),
});

export const sendPaymentRejectedEmail = async (to, { name, receiptNumber, note }) => {
  const detail = note || "Please check the details and upload a clearer copy of your receipt.";
  return notify("payment rejection", {
    to,
    subject: `Payment review update — ${receiptNumber}`,
    text: `Dear ${name}, we could not confirm the payment receipt you uploaded (${receiptNumber}). ${detail} Sign in to your dashboard to upload a new receipt.`,
    html: layout("There is an update on your payment receipt.", "Payment review update", `${greeting(name)}<p style="margin:0;">We could not confirm the payment receipt you uploaded.</p>${notice(`Receipt number: <strong style="font-family:monospace;">${escapeHtml(receiptNumber)}</strong><br><br>${escapeHtml(detail)}`, "danger")}<p style="margin:0;">Please sign in to your dashboard to upload a new receipt.</p>`),
  });
};
