import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { acceptUploads } from "../middleware/upload.middleware.js";
import { uploadLimiter } from "../middleware/rateLimit.middleware.js";
import { MAX_UPLOAD_BYTES, RECEIPT_MIME_TYPES } from "../config/constants.js";
import { getMyPayments, replaceMyReceipt } from "../controllers/payment.controller.js";

const router = Router();

router.use(requireAuth);

const receiptUpload = acceptUploads({
  receipt: { mimeTypes: RECEIPT_MIME_TYPES, maxBytes: MAX_UPLOAD_BYTES },
});

router.get("/me", getMyPayments);
router
  .route("/me/receipt")
  .put(uploadLimiter, receiptUpload, replaceMyReceipt)
  .post(uploadLimiter, receiptUpload, replaceMyReceipt);

export default router;
