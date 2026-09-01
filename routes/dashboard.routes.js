import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { getStudentDashboard } from "../controllers/dashboard.controller.js";

const router = Router();

router.use(requireAuth);

/**
 * Mounted at /api/dashboard, so this is GET /api/dashboard. There is deliberately
 * only one route here — the whole point of the endpoint is that the dashboard
 * needs exactly one call.
 */
router.get("/", getStudentDashboard);

export default router;
