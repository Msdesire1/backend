import { Router } from "express";
import {
  createChurchMember,
  lookupChurchMember,
  updateChurchMember,
} from "../controllers/church-member.controller.js";
import { rateLimit } from "../middleware/rateLimit.middleware.js";

const router = Router();
const publicMemberLimiter = rateLimit({
  scope: "church-member",
  max: 10,
  windowMs: 60 * 60 * 1000,
  message: "Too many membership form attempts. Please try again later.",
});

router.post("/", publicMemberLimiter, createChurchMember);
router.post("/lookup", publicMemberLimiter, lookupChurchMember);
router.patch("/:id", publicMemberLimiter, updateChurchMember);

export default router;
