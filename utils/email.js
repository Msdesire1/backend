import nodemailer from "nodemailer";

let transporter;

const DEFAULT_LOGO_URL = "https://wofbi.org/logo.png";
const isConfigured = () => Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
const isBrevoApiConfigured = () => Boolean(process.env.BREVO_API_KEY);
const websiteUrl = () => (process.env.CLIENT_URL || "https://www.lfcnewjerusalem.com").replace(/\/$/, "");
const logoUrl = () => process.env.EMAIL_LOGO_URL || DEFAULT_LOGO_URL;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
}[character]));

export const shouldLogOtp = () => process.env.NODE_ENV !== "production" || process.env.LOG_OTP === "true";
export const logVerificationOtp = (email, otp, source) => {
  if (shouldLogOtp()) console.info(`[email:otp] ${source} OTP for ${email}: ${otp} (valid for 15 minutes)`);
};

let cachedPublicIp = null;
const getPublicIp = async () => {
  if (cachedPublicIp !== null) return cachedPublicIp;
  try {
    const response = await fetch("https://api.ipify.org?format=json", { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = await response.json();
    cachedPublicIp = typeof body.ip === "string" && body.ip ? body.ip : "<unknown>";
  } catch (error) {
    cachedPublicIp = "<unknown>";
    console.warn(`[email] could not resolve public IP: ${error.message}`);
  }
  return cachedPublicIp;
};

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

const parseSender = (value) => {
  const sender = String(value || "no-reply@example.com").trim();
  const match = sender.match(/^\s*(?:([^<>]+?)\s*)?<([^<>\s]+)>\s*$/);
  return match
    ? { email: match[2], ...(match[1] ? { name: match[1].trim().replace(/^['\"]|['\"]$/g, "") } : {}) }
    : { email: sender };
};

const sendWithBrevoApi = async ({ to, subject, text, html }) => {
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": process.env.BREVO_API_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: parseSender(process.env.EMAIL_FROM),
      to: [{ email: to }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Brevo API request failed (${response.status}): ${body.message || body.code || "unknown error"}`);
  }
  console.info(`[email] accepted by Brevo API: to=${to} | messageId=${body.messageId || "<unknown>"}`);
  return body;
};

export const sendEmail = async ({ to, subject, text, html }) => {
  if (!isBrevoApiConfigured() && !isConfigured()) {
    if (process.env.NODE_ENV === "production") throw new Error("Email is not configured. Set BREVO_API_KEY, or SMTP_HOST, SMTP_USER, and SMTP_PASS.");
    console.info(`[email:dev] SMTP not configured — would send to ${to}\nSubject: ${subject}\n${text || html}`);
    return;
  }
  try {
    // Render Free blocks SMTP ports. Prefer Brevo's HTTPS API whenever its key
    // is present; HTTPS (443) works on all Render plans.
    if (isBrevoApiConfigured()) return await sendWithBrevoApi({ to, subject, text, html });
    const info = await getTransporter().sendMail({ from: process.env.EMAIL_FROM || "no-reply@example.com", to, subject, text, html });
    console.info(`[email] accepted by SMTP: to=${to} | messageId=${info.messageId || "<unknown>"} | response=${info.response || "<none>"}`);
    return info;
  } catch (error) {
    const err = new Error(error.message);
    // Looking up the server IP is useful diagnostic context, but it must never
    // delay a successful delivery.  Previously every OTP waited for this
    // external request (up to three seconds) before Brevo/SMTP was contacted.
    err.publicIp = await getPublicIp();
    err.code = error.code;
    err.command = error.command;
    err.response = error.response;
    err.responseCode = error.responseCode;
    throw err;
  }
};

/* --------------------------------------------------------- email presentation -- */

const button = (label, href = websiteUrl()) => `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 3px;"><tr><td style="background:#c61d24;border-radius:8px;"><a href="${escapeHtml(href)}" style="display:inline-block;padding:13px 22px;border-radius:8px;color:#ffffff;font:700 14px Arial,sans-serif;text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;

const layout = ({ eyebrow = "WOFBI", title, preview, body, action = "", notice = "" }) => `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preview || title)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f4f4f5;padding:28px 12px;"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:620px;background:#ffffff;border-radius:14px;overflow:hidden;">
<tr><td style="padding:27px 32px 23px;background:#101010;text-align:center;"><img src="${escapeHtml(logoUrl())}" width="58" height="58" alt="Living Faith Church logo" style="display:block;width:58px;height:58px;margin:0 auto 12px;border:0;" /><div style="font:700 11px Arial,sans-serif;letter-spacing:2px;color:#f15a5f;text-transform:uppercase;">${escapeHtml(eyebrow)}</div><div style="margin-top:5px;font:700 21px Arial,sans-serif;color:#ffffff;">Living Faith Church</div><div style="margin-top:3px;font:400 12px Arial,sans-serif;color:#d4d4d8;">New Jerusalem, Ilorin</div></td></tr>
<tr><td style="height:5px;background:#c61d24;"></td></tr><tr><td style="padding:34px 32px 30px;font:400 16px/1.65 Arial,sans-serif;color:#292524;"><h1 style="margin:0 0 16px;font:700 25px/1.25 Arial,sans-serif;color:#171717;">${escapeHtml(title)}</h1>${body}${action}${notice ? `<div style="margin-top:25px;padding:13px 15px;background:#fff7ed;border-left:4px solid #e8a11a;border-radius:4px;font:400 13px/1.55 Arial,sans-serif;color:#57534e;">${notice}</div>` : ""}</td></tr>
<tr><td style="padding:22px 32px;background:#18181b;text-align:center;font:400 12px/1.55 Arial,sans-serif;color:#d4d4d8;">Word of Faith Bible Institute &middot; Living Faith Church New Jerusalem, Ilorin, Kwara State, Nigeria<br /><a href="${escapeHtml(websiteUrl())}" style="color:#ffffff;text-decoration:underline;">lfcnewjerusalem.com</a></td></tr>
</table></td></tr></table></body></html>`;

const greeting = (name) => `<p style="margin:0 0 14px;">Dear ${escapeHtml(name)},</p>`;
const paragraph = (content) => `<p style="margin:0 0 14px;">${content}</p>`;

export const sendVerificationOtpEmail = async (to, otp) => sendEmail({
  to,
  subject: "Your WOFBI verification code",
  text: `Welcome to WOFBI! Your verification code is ${otp}. It expires in 15 minutes. If you did not create an account, you can safely ignore this email.`,
  html: layout({ title: "Verify your email address", preview: `Your WOFBI verification code is ${otp}`, body: `${paragraph("Welcome to Word of Faith Bible Institute. Use the code below to activate your account.")}<div style="margin:22px 0;padding:20px 14px;background:#fdf2f2;border:1px solid #fecaca;border-radius:10px;text-align:center;font:700 34px/1 Arial,sans-serif;letter-spacing:9px;color:#a8151b;">${escapeHtml(otp)}</div><p style="margin:0;">This code expires in <strong>15 minutes</strong>.</p>`, notice: "If you did not create a WOFBI account, you can safely ignore this email." }),
});

export const sendPasswordResetEmail = async (to, resetUrl) => sendEmail({
  to,
  subject: "Reset your WOFBI password",
  text: `You requested a WOFBI password reset. Open this link within 15 minutes: ${resetUrl}. If you did not request this, you can safely ignore this email.`,
  html: layout({ title: "Reset your password", preview: "Choose a new WOFBI password", body: paragraph("We received a request to reset your WOFBI password. Use the button below to choose a new one."), action: button("Reset password", resetUrl), notice: "This link expires in 15 minutes. If you did not request a password reset, you can safely ignore this email." }),
});

const notify = async (label, payload) => {
  try { await sendEmail(payload); }
  catch (error) { console.error(`[email] failed to send ${label} to ${payload.to}: ${error.message} | public IP: ${error.publicIp || "<unknown>"}`); }
};

export const sendApplicationSubmittedEmail = async (to, { name, applicationId, programme }) => notify("application receipt", {
  to, subject: `Application received — ${applicationId}`,
  text: `Dear ${name},\n\nWe have received your WOFBI application for the ${programme}. Your application reference is ${applicationId}. Our admissions team will email you with the outcome.`,
  html: layout({ title: "Application received", preview: `Your application reference is ${applicationId}`, body: `${greeting(name)}${paragraph(`Thank you for applying to WOFBI. We have received your application for <strong>${escapeHtml(programme)}</strong>.`)}${paragraph(`Your application reference is <strong>${escapeHtml(applicationId)}</strong>. Our admissions team will review your details and email you with the outcome.`)}`, action: button("View your dashboard") }),
});

export const sendApplicationApprovedEmail = async (to, { name, studentId, programme, intake }) => notify("admission approval", {
  to, subject: "Your WOFBI application has been approved",
  text: `Dear ${name},\n\nCongratulations! Your application for ${programme} has been approved. Your student ID is ${studentId}; welcome to the ${intake} intake.`,
  html: layout({ title: "Congratulations, you are admitted!", preview: `Your WOFBI student ID is ${studentId}`, body: `${greeting(name)}${paragraph(`Your application for <strong>${escapeHtml(programme)}</strong> has been approved. Welcome to the ${escapeHtml(intake)} intake.`)}${paragraph(`Your student ID is <strong>${escapeHtml(studentId)}</strong>. Please quote it in any correspondence with the institute.`)}`, action: button("Open your dashboard") }),
});

export const sendApplicationInfoRequestedEmail = async (to, { name, note }) => notify("information request", {
  to, subject: "More information needed for your WOFBI application",
  text: `Dear ${name},\n\nOur admissions team needs more information: ${note}\n\nPlease update and submit your application again.`,
  html: layout({ title: "We need a little more information", preview: "An update is needed on your WOFBI application", body: `${greeting(name)}${paragraph("Our admissions team has reviewed your application and needs the following information before we can proceed:")}<div style="margin:18px 0;padding:14px 16px;background:#fff7ed;border-left:4px solid #e8a11a;border-radius:4px;">${escapeHtml(note)}</div>${paragraph("Please update your application and submit it again. Your saved information will remain available.")}`, action: button("Update application") }),
});

export const sendApplicationRejectedEmail = async (to, { name, note }) => notify("admission decision", {
  to, subject: "An update on your WOFBI application",
  text: `Dear ${name},\n\nAfter review, we are unable to offer you a place in this intake. ${note || ""}\n\nYou are welcome to apply again in a future intake.`,
  html: layout({ title: "An update on your application", preview: "A decision has been made on your WOFBI application", body: `${greeting(name)}${paragraph("After careful review, we are unable to offer you a place in this intake.")}${note ? `<div style="margin:18px 0;padding:14px 16px;background:#fef2f2;border-left:4px solid #c61d24;border-radius:4px;">${escapeHtml(note)}</div>` : ""}${paragraph("You are welcome to apply again for a future intake. We wish you every blessing.")}` }),
});

export const sendPaymentApprovedEmail = async (to, { name, receiptNumber, amount, programme }) => notify("payment confirmation", {
  to, subject: `Payment confirmed — ${receiptNumber}`,
  text: `Dear ${name},\n\nWe have confirmed your ${amount} registration payment for ${programme}. Your receipt number is ${receiptNumber}.`,
  html: layout({ title: "Your payment is confirmed", preview: `Receipt ${receiptNumber} has been confirmed`, body: `${greeting(name)}${paragraph(`We have confirmed your <strong>${escapeHtml(amount)}</strong> registration payment for <strong>${escapeHtml(programme)}</strong>.`)}${paragraph(`Your receipt number is <strong>${escapeHtml(receiptNumber)}</strong>. Please keep it for your records.`)}`, action: button("View your dashboard") }),
});

export const sendPaymentRejectedEmail = async (to, { name, receiptNumber, note }) => notify("payment rejection", {
  to, subject: `We could not confirm your payment — ${receiptNumber}`,
  text: `Dear ${name},\n\nWe could not confirm payment receipt ${receiptNumber}. ${note || "Please check the details and upload a clearer receipt."}\n\nSign in to upload a new receipt.`,
  html: layout({ title: "We could not confirm your payment", preview: `An update is needed for receipt ${receiptNumber}`, body: `${greeting(name)}${paragraph(`We could not confirm the payment receipt <strong>${escapeHtml(receiptNumber)}</strong>.`)}<div style="margin:18px 0;padding:14px 16px;background:#fef2f2;border-left:4px solid #c61d24;border-radius:4px;">${escapeHtml(note || "Please check the details and upload a clearer copy of your receipt.")}</div>${paragraph("Sign in to your dashboard to upload a new receipt.")}`, action: button("Upload a new receipt") }),
});
