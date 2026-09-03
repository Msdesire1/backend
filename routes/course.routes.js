import { Router } from "express";
import { requireAuth, requireCompletedRegistration } from "../middleware/auth.middleware.js";
import {
  completeLesson,
  enrollInCourse,
  getCourse,
  getLesson,
  listCourseLessons,
  listCourses,
  uncompleteLesson,
} from "../controllers/course.controller.js";

const router = Router();

router.use(requireAuth);

/**
 * Kept from the original router: a simple check the client can use to find out
 * whether course content is available to this account yet. Declared before
 * "/:code" so it is matched as a literal path rather than as a course code.
 */
router.get("/access", requireCompletedRegistration, (req, res) => {
  res.status(200).json({
    success: true,
    message: "You can access courses.",
    user: req.user.toPublicJSON(),
  });
});

/**
 * The catalogue and a course's outline are readable by any signed-in account,
 * because the enrollment form has to show the three programmes *before* the
 * applicant has finished registering. Lesson content and enrollment sit behind
 * `requireCompletedRegistration`.
 */
router.get("/", listCourses);
router.get("/:code", getCourse);
router.get("/:code/lessons", listCourseLessons);

router.use(requireCompletedRegistration);

router.post("/:code/enroll", enrollInCourse);
router.get("/:code/lessons/:number", getLesson);
router
  .route("/:code/lessons/:number/complete")
  .post(completeLesson)
  .delete(uncompleteLesson);

export default router;
