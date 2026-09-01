import crypto from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/user.model.js";
import { sendLoginAlertEmail, sendPasswordResetEmail, sendVerificationOtpEmail } from "../utils/email.js";
import { resetRateLimit } from "../middleware/rateLimit.middleware.js";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const NAME_PATTERN = /^[a-zA-Z][a-zA-Z '-]{1,49}$/;

const clean = (value) => (typeof value === "string" ? value.trim() : "");

const passwordError = (password) => {
    if (typeof password !== "string" || password.length < 8 || password.length > 72) {
        return "Password must be between 8 and 72 characters.";
    }
    if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
        return "Password must include an uppercase letter, lowercase letter, and number.";
    }
    return null;
};

const signToken = (userId) => {
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured.");
    return jwt.sign({ sub: userId.toString() }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });
};

const registrationErrors = (body) => {
    const errors = {};
    if (!NAME_PATTERN.test(clean(body.firstName))) errors.firstName = "Enter a valid first name.";
    if (!NAME_PATTERN.test(clean(body.lastName))) errors.lastName = "Enter a valid last name.";
    if (!EMAIL_PATTERN.test(clean(body.email))) errors.email = "Enter a valid email address.";
    if (!PHONE_PATTERN.test(clean(body.phoneNumber))) errors.phoneNumber = "Use international format, e.g. +2348000000000.";
    const passwordMessage = passwordError(body.password);
    if (passwordMessage) errors.password = passwordMessage;
    if (body.password !== body.confirmPassword) errors.confirmPassword = "Passwords do not match.";
    return errors;
};

export const register = async (req, res, next) => {
    try {
        const body = req.body || {};
        const errors = registrationErrors(body);
        if (Object.keys(errors).length) return res.status(422).json({ success: false, message: "Please correct the highlighted fields.", errors });

        const email = clean(body.email).toLowerCase();
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(409).json({ success: false, message: "An account with this email already exists." });

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

        const user = await User.create({
            firstName: clean(body.firstName),
            lastName: clean(body.lastName),
            email,
            phoneNumber: clean(body.phoneNumber),
            password: body.password,
            acceptedTermsAt: new Date(),
            emailVerified: false,
            emailOtpHash: otpHash,
            emailOtpExpires: new Date(Date.now() + 15 * 60 * 1000), // 15 minutes
        });

        // Send OTP email (don't block registration if email fails)
        try {
            await sendVerificationOtpEmail(email, otp);
        } catch (mailError) {
            console.error(`Failed to send verification email to ${email}: ${mailError.message}`);
        }

        res.status(201).json({
            success: true,
            message: "Account created. Check your email for a verification code to activate your account.",
            token: signToken(user._id),
            user: user.toPublicJSON(),
            requiresEmailVerification: true,
        });
    } catch (error) {
        if (error?.code === 11000) return res.status(409).json({ success: false, message: "An account with this email already exists." });
        next(error);
    }
};

export const login = async (req, res, next) => {
    try {
        const body = req.body || {};
        const email = clean(body.email).toLowerCase();
        const password = body.password;
        if (!EMAIL_PATTERN.test(email) || typeof password !== "string" || !password) {
            return res.status(422).json({ success: false, message: "Enter a valid email address and password." });
        }
        const user = await User.findOne({ email }).select("+password");
        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({ success: false, message: "Incorrect email address or password." });
        }

        // Block login if email is not verified
        if (!user.emailVerified) {
            return res.status(403).json({
                success: false,
                message: "Please verify your email address before logging in. Check your inbox for the verification code.",
                // Both are sent: `requiresEmailVerification` is what the existing
                // client checks, `code` is the stable identifier every other error
                // in this API is branched on.
                code: "EMAIL_NOT_VERIFIED",
                requiresEmailVerification: true
            });
        }

        try {
            await sendLoginAlertEmail(user.email, user.firstName || "there");
        } catch (mailError) {
            console.error(`Failed to send login alert email to ${user.email}: ${mailError.message}`);
        }

        res.status(200).json({
            success: true,
            message: user.registrationComplete ? "Login successful." : "Login successful. Complete your registration to access courses.",
            token: signToken(user._id),
            requiresRegistrationCompletion: !user.registrationComplete,
            user: user.toPublicJSON(),
        });
        // Clear the throttle counter now that the password is known to be right.
        // Without this, someone who fumbles it a few times and then gets in is
        // still carrying those failures and can be locked out of their next login.
        resetRateLimit("login", req);
    } catch (error) { next(error); }
};

export const forgotPassword = async (req, res, next) => {
    try {
        const email = clean((req.body || {}).email).toLowerCase();
        // Keep this response identical whether or not the address is registered.
        const response = { success: true, message: "an email has been sent with a password reset link." };
        if (!EMAIL_PATTERN.test(email)) return res.status(200).json(response);
        const user = await User.findOne({ email }).select("+passwordResetToken +passwordResetExpires");
        if (!user) return res.status(200).json(response);

        const rawToken = crypto.randomBytes(32).toString("hex");
        user.passwordResetToken = crypto.createHash("sha256").update(rawToken).digest("hex");
        user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000);
        await user.save({ validateBeforeSave: false });

        const clientUrl = (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/$/, "");
        // Must match the real page: the reset screen lives at
        // app/onboarding/reset-password. The previous /reset-password/:token link
        // pointed at a route that does not exist, so every email 404'd. The token
        // travels as a query parameter because that page is a single static route
        // rather than a dynamic segment.
        const resetUrl = `${clientUrl}/onboarding/reset-password?token=${rawToken}`;
        try {
            await sendPasswordResetEmail(email, resetUrl);
        } catch (mailError) {
            // Don't leak whether the address exists, and don't leave a usable token behind
            // if the email never went out. Clear it and log for the operator.
            console.error(`Failed to send password reset email to ${email}: ${mailError.message}`);
            user.passwordResetToken = undefined;
            user.passwordResetExpires = undefined;
            await user.save({ validateBeforeSave: false });
        }
        res.status(200).json(response);
    } catch (error) { next(error); }
};

export const resetPassword = async (req, res, next) => {
    try {
        const body = req.body || {};
        const passwordMessage = passwordError(body.password);
        if (passwordMessage || body.password !== body.confirmPassword) {
            return res.status(422).json({ success: false, message: passwordMessage || "Passwords do not match." });
        }
        if (!/^[a-f0-9]{64}$/i.test(req.params.token)) return res.status(400).json({ success: false, message: "This reset link is invalid or has expired." });
        const hashedToken = crypto.createHash("sha256").update(req.params.token).digest("hex");
        const user = await User.findOne({ passwordResetToken: hashedToken, passwordResetExpires: { $gt: new Date() } }).select("+password +passwordResetToken +passwordResetExpires");
        if (!user) return res.status(400).json({ success: false, message: "This reset link is invalid or has expired." });
        user.password = body.password;
        user.passwordResetToken = undefined;
        user.passwordResetExpires = undefined;
        await user.save();
        res.status(200).json({ success: true, message: "Password reset successful. You can now sign in." });
    } catch (error) { next(error); }
};

export const getCurrentUser = (req, res) => res.status(200).json({ success: true, user: req.user.toPublicJSON() });

export const verifyEmail = async (req, res, next) => {
    try {
        const body = req.body || {};
        const email = clean(body.email).toLowerCase();
        const otp = clean(body.otp);

        if (!EMAIL_PATTERN.test(email)) {
            return res.status(422).json({ success: false, message: "Enter a valid email address." });
        }
        if (!/^\d{6}$/.test(otp)) {
            return res.status(422).json({ success: false, message: "Enter a valid 6-digit code." });
        }

        // Look up by email; the OTP itself is the proof of identity here.
        const user = await User.findOne({ email }).select("+emailOtpHash +emailOtpExpires");
        if (!user) return res.status(404).json({ success: false, message: "User not found." });

        if (user.emailVerified) {
            return res.status(400).json({ success: false, message: "Email is already verified." });
        }

        if (!user.emailOtpHash || !user.emailOtpExpires) {
            return res.status(400).json({ success: false, message: "No verification code found. Request a new one." });
        }

        if (user.emailOtpExpires < new Date()) {
            return res.status(400).json({ success: false, message: "Verification code has expired. Request a new one." });
        }

        const otpHash = crypto.createHash("sha256").update(otp).digest("hex");
        if (otpHash !== user.emailOtpHash) {
            return res.status(400).json({ success: false, message: "Invalid verification code." });
        }

        // Mark as verified and clear OTP
        user.emailVerified = true;
        user.emailOtpHash = undefined;
        user.emailOtpExpires = undefined;
        await user.save();

        res.status(200).json({
            success: true,
            message: "Email verified successfully. You can now log in.",
            user: user.toPublicJSON(),
        });
    } catch (error) { next(error); }
};

export const resendVerificationOtp = async (req, res, next) => {
    try {
        const email = clean((req.body || {}).email).toLowerCase();
        if (!EMAIL_PATTERN.test(email)) {
            return res.status(422).json({ success: false, message: "Enter a valid email address." });
        }
        const user = await User.findOne({ email }).select("+emailOtpHash +emailOtpExpires");
        if (!user) return res.status(404).json({ success: false, message: "User not found." });

        if (user.emailVerified) {
            return res.status(400).json({ success: false, message: "Email is already verified." });
        }

        // Generate new OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

        user.emailOtpHash = otpHash;
        user.emailOtpExpires = new Date(Date.now() + 15 * 60 * 1000);
        await user.save();

        // Send OTP email
        try {
            await sendVerificationOtpEmail(user.email, otp);
        } catch (mailError) {
            console.error(`Failed to resend verification email to ${user.email}: ${mailError.message}`);
        }

        res.status(200).json({
            success: true,
            message: "Verification code sent. Check your email.",
        });
    } catch (error) { next(error); }
};

export const completeRegistration = async (req, res, next) => {
    try {
        const profile = req.body || {};
        const errors = {};
        const requiredFields = ["dateOfBirth", "gender", "address", "city", "state", "country", "homeChurch", "emergencyContactName", "emergencyContactPhone"];
        requiredFields.forEach((field) => { if (!clean(profile[field])) errors[field] = "This field is required."; });
        const dateOfBirth = new Date(profile.dateOfBirth);
        if (Number.isNaN(dateOfBirth.getTime()) || dateOfBirth >= new Date()) errors.dateOfBirth = "Enter a valid date of birth.";
        if (!["female", "male", "prefer_not_to_say"].includes(profile.gender)) errors.gender = "Choose a valid option.";
        if (!PHONE_PATTERN.test(clean(profile.emergencyContactPhone))) errors.emergencyContactPhone = "Use international format, e.g. +2348000000000.";
        if (Object.keys(errors).length) return res.status(422).json({ success: false, message: "Please correct the highlighted fields.", errors });

        req.user.profile = {
            dateOfBirth,
            gender: profile.gender,
            address: clean(profile.address), city: clean(profile.city), state: clean(profile.state), country: clean(profile.country),
            homeChurch: clean(profile.homeChurch), emergencyContactName: clean(profile.emergencyContactName), emergencyContactPhone: clean(profile.emergencyContactPhone),
        };
        req.user.registrationComplete = true;
        await req.user.save();
        res.status(200).json({ success: true, message: "Registration completed. You now have access to courses.", user: req.user.toPublicJSON() });
    } catch (error) { next(error); }
};
