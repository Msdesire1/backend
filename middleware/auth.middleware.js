import jwt from "jsonwebtoken";
import User from "../models/user.model.js";
import Admin from "../models/admin.model.js";
import { ADMIN_ROLE } from "../config/constants.js";

const jwtSecret = () => {
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured.");
    return process.env.JWT_SECRET;
};

const adminJwtSecret = () => {
    if (!process.env.ADMIN_JWT_SECRET) throw new Error("ADMIN_JWT_SECRET is not configured.");
    return process.env.ADMIN_JWT_SECRET;
};

export const requireAuth = async (req, res, next) => {
    try {
        const header = req.headers.authorization || "";
        if (!header.startsWith("Bearer ")) {
            return res.status(401).json({ success: false, message: "Authentication is required." });
        }
        const token = header.slice(7);
        const decoded = jwt.verify(token, jwtSecret());
        const user = await User.findById(decoded.sub);
        if (!user) return res.status(401).json({ success: false, message: "Your account no longer exists." });
        req.user = user;
        next();
    } catch (_error) {
        res.status(401).json({ success: false, message: "Your session is invalid or has expired." });
    }
};

export const requireCompletedRegistration = (req, res, next) => {
    if (!req.user.registrationComplete) {
        return res.status(403).json({
            success: false,
            code: "REGISTRATION_INCOMPLETE",
            message: "Please complete your registration before accessing courses.",
        });
    }
    next();
};

/**
 * Guards the /api/admin/* routes.
 *
 * Admins live in their own collection and their tokens are signed with a
 * different secret (ADMIN_JWT_SECRET), so a student token can never satisfy this
 * guard even if the payload were forged to look like an admin's: the signature
 * check fails first, and the id would then be looked up in the wrong collection.
 * Two independent secrets means compromising the student one does not hand
 * anybody the admin console.
 */
export const requireAdmin = async (req, res, next) => {
    try {
        const header = req.headers.authorization || "";
        if (!header.startsWith("Bearer ")) {
            return res
                .status(401)
                .json({ success: false, message: "Administrator sign-in is required." });
        }
        const decoded = jwt.verify(header.slice(7), adminJwtSecret());
        const admin = await Admin.findById(decoded.sub);
        if (!admin || !admin.active) {
            return res
                .status(401)
                .json({ success: false, message: "This administrator account is no longer active." });
        }
        req.admin = admin;
        next();
    } catch (_error) {
        res.status(401).json({
            success: false,
            message: "Your administrator session is invalid or has expired.",
        });
    }
};

/**
 * Narrows an admin route to particular roles, e.g. only a super admin may create
 * other administrators. Must be used after `requireAdmin`.
 */
export const requireAdminRole =
    (...roles) =>
    (req, res, next) => {
        const allowed = roles.length ? roles : [ADMIN_ROLE.SUPER_ADMIN];
        if (!allowed.includes(req.admin?.role)) {
            return res.status(403).json({
                success: false,
                code: "INSUFFICIENT_ROLE",
                message: "You do not have permission to perform this action.",
            });
        }
        next();
    };

/**
 * Accepts either a student or an administrator token, setting `req.user` or
 * `req.admin` accordingly. Used only by GET /api/files/:id, which has to serve
 * the same URL to the owner (their receipt on the payments page) and to an admin
 * (the same receipt in the review modal).
 *
 * It also accepts `?token=` as well as the Authorization header, because an
 * <img> or <iframe> tag cannot send headers — there is no way to display a
 * stored photograph otherwise. Query tokens can end up in server logs and
 * Referer headers, so prefer the header wherever you control the request.
 */
export const requireAuthOrAdmin = async (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.query?.token;
    if (!token) {
        return res.status(401).json({ success: false, message: "Authentication is required." });
    }

    // Admin first: admin tokens carry `scope: "admin"`, so this is one cheap check
    // rather than two signature verifications for every student request.
    try {
        const decoded = jwt.decode(token);
        if (decoded?.scope === "admin") {
            const verified = jwt.verify(token, adminJwtSecret());
            const admin = await Admin.findById(verified.sub);
            if (!admin || !admin.active) throw new Error("inactive admin");
            req.admin = admin;
            return next();
        }

        const verified = jwt.verify(token, jwtSecret());
        const user = await User.findById(verified.sub);
        if (!user) throw new Error("missing user");
        req.user = user;
        return next();
    } catch (_error) {
        return res
            .status(401)
            .json({ success: false, message: "Your session is invalid or has expired." });
    }
};
