import { Router } from "express";
import { requireAuthOrAdmin } from "../middleware/auth.middleware.js";
import { getFileMeta, streamFile } from "../controllers/file.controller.js";

const router = Router();

// One URL for both audiences: `toFileJSON` puts /api/files/<id> into every
// payload, and the admin review modal and the student's payments page both need
// to render the same receipt.
router.use(requireAuthOrAdmin);

router.get("/:id/meta", getFileMeta);
router.get("/:id", streamFile);

export default router;
