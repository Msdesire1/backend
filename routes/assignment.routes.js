import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { acceptUploads } from "../middleware/upload.middleware.js";
import { uploadLimiter } from "../middleware/rateLimit.middleware.js";
import { MAX_UPLOAD_BYTES } from "../config/constants.js";
import {
  getAssignment,
  listMyAssignments,
  submitAssignment,
} from "../controllers/assignment.controller.js";

const router = Router();

router.use(requireAuth);

// Coursework can reasonably be a document, a scan or an image, so the attachment
// is not restricted to a single family of types the way a passport photo is.
const attachmentUpload = acceptUploads({
  attachment: { maxBytes: MAX_UPLOAD_BYTES },
});

router.get("/", listMyAssignments);
router.get("/:id", getAssignment);
router.post("/:id/submit", uploadLimiter, attachmentUpload, submitAssignment);

export default router;
