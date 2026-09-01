import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  listMyAnnouncements,
  markAllAnnouncementsRead,
  markAnnouncementRead,
} from "../controllers/announcement.controller.js";

const router = Router();

router.use(requireAuth);

router.get("/", listMyAnnouncements);
// Declared before "/:id/read" so "read-all" is never taken for an id.
router.post("/read-all", markAllAnnouncementsRead);
router.post("/:id/read", markAnnouncementRead);

export default router;
