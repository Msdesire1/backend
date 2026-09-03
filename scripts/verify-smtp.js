import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config({ path: ".env", override: true, quiet: true });

const required = ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`SMTP is missing: ${missing.join(", ")}`);
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

try {
  await transporter.verify();
  console.log("SMTP connection and authentication succeeded.");
} catch (error) {
  console.error(`SMTP verification failed: ${error.code || error.name}: ${error.message}`);
  process.exitCode = 1;
}
