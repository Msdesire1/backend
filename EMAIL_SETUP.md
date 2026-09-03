# Email Verification Setup Guide

## What Was Built

Your backend now has **email verification at registration** with a 6-digit OTP code:

1. **Register** → user gets a 6-digit OTP via email
2. **Login is blocked** until the email is verified
3. **Verify endpoint** → user submits the OTP to activate their account
4. **Resend endpoint** → if the code expires or gets lost

Password reset emails already existed and still work the same way.

---

## API Endpoints Added

### POST `/api/auth/verify-email`
Verify the OTP code sent during registration.

**Body:**
```json
{
  "email": "ada@example.com",
  "otp": "123456"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Email verified successfully. You can now log in.",
  "user": { ... }
}
```

**Error Responses:**
- `422` — Invalid code format (not 6 digits)
- `400` — Code expired, wrong code, or no code found
- `400` — Already verified

---

### POST `/api/auth/resend-verification-otp`
Request a new OTP if the first one expired or was lost.

**Body:**
```json
{
  "email": "ada@example.com"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Verification code sent. Check your email."
}
```

---

## Updated Flows

### Registration Flow (Changed)
**POST `/api/auth/register`** now:
- Creates the user with `emailVerified: false`
- Generates a 6-digit OTP
- Sends it via email
- Returns `requiresEmailVerification: true` in the response

**Response:**
```json
{
  "success": true,
  "message": "Account created. Check your email for a verification code to activate your account.",
  "token": "...",
  "user": { ..., "emailVerified": false },
  "requiresEmailVerification": true
}
```

### Login Flow (Changed)
**POST `/api/auth/login`** now:
- Checks credentials first
- **Blocks login with 403** if `emailVerified` is `false`

**Blocked Response (403):**
```json
{
  "success": false,
  "message": "Please verify your email address before logging in. Check your inbox for the verification code.",
  "requiresEmailVerification": true
}
```

Once verified, login works normally.

---

## How to Fix "SMTP not configured"

Your app prints `[email:dev] SMTP not configured` because **`SMTP_PASS` is empty** in `.env`. Here's how to fix it with Brevo.

### Step 1: Get Brevo SMTP Credentials

1. Go to https://app.brevo.com/settings/keys/smtp
2. Copy the **SMTP login** — it looks like `9xxxxxx@smtp-brevo.com` (NOT your account email)
3. Click **"Generate a new SMTP key"** and copy the generated key

### Step 2: Verify a Sender Address

1. Go to https://app.brevo.com/settings/senders
2. Add and verify the email address you want to send *from* (e.g., `noreply@yourdomain.com` or your personal email)
3. Brevo will send a confirmation link — click it to verify

### Step 3: Update `.env`

Replace these lines in your `.env`:

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=9xxxxxx@smtp-brevo.com          # ← Your SMTP login from Step 1
SMTP_PASS=your-actual-smtp-key-here       # ← Your generated key from Step 1
EMAIL_FROM="Church Courses <verified@yourdomain.com>"  # ← Your verified sender from Step 2
```

### Step 4: Restart the Server

`.env` is only read at startup, so restart:

```bash
npm start
```

Now emails will actually send instead of printing to the console.

---

## Testing Without SMTP (Dev Mode)

If SMTP isn't configured, the app stays in **dev mode**:
- It prints the email content to the terminal instead of sending
- If SMTP is configured but rejected, the OTP is also printed in non-production
  mode so the account can still be tested locally
- Everything else works normally

This is intentional so you can develop locally without email credentials.

---

## Database Changes

The `User` model now has three new fields:

```js
emailVerified: Boolean (default: false)
emailOtpHash: String (hashed OTP, select: false)
emailOtpExpires: Date (15-minute expiry, select: false)
```

Existing users in your database will have `emailVerified: false` by default. If you want to mark them as verified without requiring OTP, run:

```js
// In MongoDB or via a migration script
db.users.updateMany({}, { $set: { emailVerified: true } })
```

---

## Frontend Integration Checklist

1. **After registration**, check `response.requiresEmailVerification`
   - If `true`, show a "Verify your email" screen with a 6-digit input
   
2. **On that screen**, call `POST /api/auth/verify-email` with the user's email and OTP

3. **If login returns 403** with `requiresEmailVerification: true`:
   - Redirect to the verify screen
  - Offer a "Resend code" button that calls `POST /api/auth/resend-verification-otp` with the user's email

4. **After successful verification**, redirect to login (user must log in again)

---

## Security Notes

- OTP codes expire after **15 minutes**
- OTP is hashed with SHA-256 before storage (never stored in plaintext)
- Failed verification attempts don't lock the account — user can keep trying or request a new code
- Email sending errors are logged but don't block registration (so dev mode works)

---

## Summary

✅ **OTP verification at registration** — complete  
✅ **Login blocked until verified** — complete  
✅ **Resend OTP endpoint** — complete  
✅ **Password reset emails** — already working  
⚠️ **SMTP configuration** — needs your Brevo credentials (see Step 1-4 above)

Once you add `SMTP_USER` and `SMTP_PASS` to `.env` and restart, emails will send to real inboxes instead of the console.
