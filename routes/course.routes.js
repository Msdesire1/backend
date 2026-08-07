import { Router } from "express";
import { requireAuth, requireCompletedRegistration } from "../middleware/auth.middleware.js";

const router = Router();

// Apply these guards to every future course route as well.
router.use(requireAuth, requireCompletedRegistration);
router.get("/access", (req, res) => {
    res.status(200).json({ success: true, message: "You can access courses.", user: req.user.toPublicJSON() });
});

export default router;
