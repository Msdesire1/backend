import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { checkIn, getMyAttendance } from "../controllers/attendance.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/me", getMyAttendance);
router.post("/me/check-in", checkIn);

export default router;
