import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import {
  downloadMyCertificate,
  getMyCertificates,
  verifyCertificate,
} from "../controllers/certificate.controller.js";

const router = Router();

/**
 * Verification is public — see the note in certificate.controller.js. It is
 * declared before the `requireAuth` guard below, which is what keeps it open.
 */
router.get("/verify/:number", verifyCertificate);

router.use(requireAuth);

router.get("/me", getMyCertificates);
router.get("/:id/download", downloadMyCertificate);

export default router;
