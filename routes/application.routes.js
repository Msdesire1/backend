import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { acceptUploads } from "../middleware/upload.middleware.js";
import { uploadLimiter } from "../middleware/rateLimit.middleware.js";
import {
  MAX_UPLOAD_BYTES,
  PHOTO_MIME_TYPES,
  RECEIPT_MIME_TYPES,
} from "../config/constants.js";
import {
  deleteMyApplicationFile,
  getMyApplication,
  saveMyApplication,
  submitMyApplication,
  uploadMyApplicationFile,
} from "../controllers/application.controller.js";

const router = Router();

/**
 * Every route here is scoped to the signed-in applicant — hence "/me" rather
 * than an id in the path. There is no student-facing route that takes another
 * applicant's identifier, so there is nothing to guess at.
 */
router.use(requireAuth);

const uploads = acceptUploads({
  photo: { mimeTypes: PHOTO_MIME_TYPES, maxBytes: MAX_UPLOAD_BYTES },
  receipt: { mimeTypes: RECEIPT_MIME_TYPES, maxBytes: MAX_UPLOAD_BYTES },
});

router.get("/me", getMyApplication);
router.patch("/me", uploads, saveMyApplication);
router.post("/me/submit", uploads, submitMyApplication);

router
  .route("/me/files/:kind")
  .put(uploadLimiter, uploads, uploadMyApplicationFile)
  // POST is accepted too: FormData posts are what a plain HTML form emits, and
  // rejecting them for the sake of verb purity would only cost the client code.
  .post(uploadLimiter, uploads, uploadMyApplicationFile)
  .delete(deleteMyApplicationFile);

export default router;
