
import jwt from "jsonwebtoken";
import Admin from "../models/admin.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { ADMIN_ROLE } from "../config/constants.js";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const clean = (value) => (typeof value === "string" ? value.trim() : "");

const signAdminToken = (admin) => {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret) throw new Error("ADMIN_JWT_SECRET is not configured.");
  return jwt.sign(
    { sub: admin._id.toString(), scope: "admin", role: admin.role },
    secret,
    // Admin sessions expire sooner than student ones: the console can approve
    // payments and issue student IDs, so an unattended browser is a bigger risk.
    { expiresIn: process.env.ADMIN_JWT_EXPIRES_IN || "12h" },
  );
};

/** POST /api/admin/auth/login */
export const adminLogin = asyncHandler(async (req, res) => {
  const email = clean(req.body?.email).toLowerCase();
  const password = req.body?.password;

  if (!EMAIL_PATTERN.test(email) || typeof password !== "string" || !password) {
    const errors = {};
    if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
    if (!password) errors.password = "Enter your password.";
    throw ApiError.unprocessable("Enter a valid email address and password.", errors);
  }

  const admin = await Admin.findOne({ email }).select("+password");

  // One message for "no such admin" and "wrong password". Distinguishing them
  // would let anyone probe which addresses have console access.
  if (!admin || !(await admin.comparePassword(password))) {
    throw ApiError.unauthorized("Incorrect email address or password.");
  }
  if (!admin.active) {
    throw ApiError.forbidden("This administrator account has been deactivated.", {
      code: "ADMIN_DEACTIVATED",
    });
  }

  admin.lastLoginAt = new Date();
  await admin.save({ validateModifiedOnly: true });

  res.json({
    success: true,
    message: "Signed in to the admin console.",
    token: signAdminToken(admin),
    admin: admin.toPublicJSON(),
  });
});

/** GET /api/admin/auth/me — lets the console restore a session on reload. */
export const getCurrentAdmin = asyncHandler(async (req, res) => {
  res.json({ success: true, admin: req.admin.toPublicJSON() });
});

/** POST /api/admin/auth/change-password */
export const changeAdminPassword = asyncHandler(async (req, res) => {
  const currentPassword = req.body?.currentPassword;
  const newPassword = req.body?.newPassword;

  if (typeof newPassword !== "string" || newPassword.length < 8) {
    throw ApiError.unprocessable("Choose a new password of at least 8 characters.", {
      newPassword: "Use at least 8 characters.",
    });
  }

  const admin = await Admin.findById(req.admin._id).select("+password");
  if (!admin || !(await admin.comparePassword(String(currentPassword || "")))) {
    throw ApiError.unauthorized("Your current password is incorrect.", {
      errors: { currentPassword: "That is not your current password." },
    });
  }

  admin.password = newPassword;
  await admin.save();

  // The old token stays valid until it expires. Issuing a fresh one here means the
  // console can swap it in immediately rather than bouncing the admin to login.
  res.json({
    success: true,
    message: "Password updated.",
    token: signAdminToken(admin),
  });
});

/**
 * POST /api/admin/admins — super admins only.
 *
 * There is no public admin registration, by design. The first account comes from
 * the seed script; every one after that is created here by an existing super admin.
 */
export const createAdmin = asyncHandler(async (req, res) => {
  const name = clean(req.body?.name);
  const email = clean(req.body?.email).toLowerCase();
  const password = req.body?.password;
  const role = req.body?.role === ADMIN_ROLE.SUPER_ADMIN ? ADMIN_ROLE.SUPER_ADMIN : ADMIN_ROLE.ADMIN;

  const errors = {};
  if (name.length < 2) errors.name = "Enter the administrator's full name.";
  if (!EMAIL_PATTERN.test(email)) errors.email = "Enter a valid email address.";
  if (typeof password !== "string" || password.length < 8) {
    errors.password = "Use at least 8 characters.";
  }
  if (Object.keys(errors).length) {
    throw ApiError.unprocessable("Please correct the highlighted fields.", errors);
  }

  if (await Admin.exists({ email })) {
    throw ApiError.conflict("An administrator with this email already exists.");
  }

  const admin = await Admin.create({ name, email, password, role });
  res.status(201).json({ success: true, message: "Administrator created.", admin: admin.toPublicJSON() });
});

/** GET /api/admin/admins — super admins only. */
export const listAdmins = asyncHandler(async (req, res) => {
  const admins = await Admin.find({}).sort({ createdAt: 1 });
  res.json({ success: true, admins: admins.map((admin) => admin.toPublicJSON()) });
});
