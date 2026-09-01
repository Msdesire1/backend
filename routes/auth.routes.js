import { Router } from "express";
import {
    completeRegistration,
    forgotPassword,
    getCurrentUser,
    login,
    register,
    resetPassword,
    verifyEmail,
    resendVerificationOtp,
} from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
    loginLimiter,
    otpLimiter,
    passwordResetLimiter,
    registerLimiter,
} from "../middleware/rateLimit.middleware.js";

const router = Router();

/**
 * These are the unauthenticated routes, so they are the ones worth throttling:
 * password guessing, OTP brute-forcing and mailbox flooding all start here. The
 * limits themselves live in middleware/rateLimit.middleware.js so the numbers are
 * in one place.
 *
 * `/verify-email` shares the OTP limiter with `/resend-verification-otp` on
 * purpose: a six-digit code is only six digits, and unlimited guesses would make
 * it worthless.
 */
router.post("/register", registerLimiter, register);
router.post("/login", loginLimiter, login);
router.post("/verify-email", otpLimiter, verifyEmail);
router.post("/resend-verification-otp", otpLimiter, resendVerificationOtp);
router.post("/forgot-password", passwordResetLimiter, forgotPassword);
router.post("/reset-password/:token", passwordResetLimiter, resetPassword);
router.get("/me", requireAuth, getCurrentUser);
router.patch("/complete-registration", requireAuth, completeRegistration);

export default router;
