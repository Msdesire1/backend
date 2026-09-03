import assert from "node:assert/strict";
import {
  buildVerificationOtpEmail,
  buildPasswordResetEmail,
  buildLoginAlertEmail,
  buildApplicationPendingEmail,
  buildApplicationApprovedEmail,
  buildApplicationRejectedEmail,
} from "../utils/email.js";

const otpEmail = buildVerificationOtpEmail("123456");
assert.match(otpEmail.subject, /verify/i, "OTP email subject should mention verification");
assert.match(otpEmail.text, /123456/, "OTP email text should include the 6-digit code");
assert.match(otpEmail.html, /123456/, "OTP HTML should include the code");

const resetEmail = buildPasswordResetEmail("https://example.com/reset?token=abc");
assert.match(resetEmail.subject, /reset/i, "Password reset subject should mention reset");
assert.match(resetEmail.text, /https:\/\/example.com\/reset\?token=abc/, "Password reset link should be present");

const loginEmail = buildLoginAlertEmail("Jane");
assert.match(loginEmail.subject, /login/i, "Login email subject should mention login");
assert.match(loginEmail.text, /Jane/, "Login email should mention the user's name");

const pendingEmail = buildApplicationPendingEmail({ name: "Jane", applicationId: "WOFBI-1001", programme: "Certificate in Theology" });
assert.match(pendingEmail.subject, /pending|review/i, "Pending email subject should mention pending review");
assert.match(pendingEmail.text, /WOFBI-1001/, "Pending email should include the application reference");

const approvedEmail = buildApplicationApprovedEmail({ name: "Jane", studentId: "STU-001", programme: "Certificate in Theology", intake: "August 2026" });
assert.match(approvedEmail.subject, /approved/i, "Approved email should mention approval");
assert.match(approvedEmail.text, /STU-001/, "Approved email should include the student ID");

const rejectedEmail = buildApplicationRejectedEmail({ name: "Jane", note: "The document was incomplete." });
assert.match(rejectedEmail.subject, /update|application/i, "Rejected email subject should mention decision");
assert.match(rejectedEmail.text, /incomplete/i, "Rejected email should include the admin note");

console.log("email templates ok");
