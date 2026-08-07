import jwt from "jsonwebtoken";
import User from "../models/user.model.js";

const jwtSecret = () => {
    if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is not configured.");
    return process.env.JWT_SECRET;
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
