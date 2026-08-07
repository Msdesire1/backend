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

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification-otp", resendVerificationOtp);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password/:token", resetPassword);
router.get("/me", requireAuth, getCurrentUser);
router.patch("/complete-registration", requireAuth, completeRegistration);

export default router;
