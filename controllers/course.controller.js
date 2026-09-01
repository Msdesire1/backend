/**
 * Student-facing course, lesson and progress endpoints.
 *
 * Courses are addressed by their code — /api/courses/BCC — because that is what
 * the UI already knows them by ("Spring 2026 intake · BCC,LCC") and it makes the
 * URLs readable.
 */
import Application from "../models/application.model.js";
import Course from "../models/course.model.js";
import Enrollment from "../models/enrollment.model.js";
import Lesson from "../models/lesson.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import {
  APPLICATION_STATUS,
  CURRENT_INTAKE,
  ENROLLMENT_STATUS,
  MILESTONE_NAMES,
} from "../config/constants.js";
import {
  buildProgress,
  completedCourseCodes,
  describeCourse,
  findActiveEnrollment,
  getCohortSize,
  getCourseCatalogue,
  groupIntoModules,
  listLessons,
  resolveNextLesson,
} from "../services/course.service.js";

const findCourseOr404 = async (code) => {
  const course = await Course.findOne({ code: String(code || "").toUpperCase() });
  if (!course || !course.active) throw ApiError.notFound("That course could not be found.");
  return course;
};

/** GET /api/courses — the three programmes with this student's state on each. */
export const listCourses = asyncHandler(async (req, res) => {
  const courses = await getCourseCatalogue(req.user._id);
  res.json({ success: true, courses, intake: CURRENT_INTAKE });
});

/**
 * GET /api/courses/:code
 *
 * The course page in one request: the card, the modules with their lessons, the
 * student's progress, what to resume, and the size of their cohort.
 */
export const getCourse = asyncHandler(async (req, res) => {
  const course = await findCourseOr404(req.params.code);

  const [enrollment, lessons, completedCodes, activeEnrollment] = await Promise.all([
    Enrollment.findOne({ user: req.user._id, course: course._id }),
    listLessons(course._id),
    completedCourseCodes(req.user._id),
    findActiveEnrollment(req.user._id),
  ]);

  const progress = buildProgress(enrollment, lessons);
  const nextLesson = resolveNextLesson(enrollment, lessons);

  res.json({
    success: true,
    course: describeCourse(course, { enrollment, progress, completedCodes, activeEnrollment }),
    modules: groupIntoModules(lessons, enrollment),
    progress,
    nextLesson: nextLesson ? nextLesson.toPublicJSON() : null,
    cohortSize: enrollment ? await getCohortSize(course._id, enrollment.intake?.code) : 0,
    milestones: MILESTONE_NAMES,
  });
});

/** GET /api/courses/:code/lessons — the flat list, each flagged complete or not. */
export const listCourseLessons = asyncHandler(async (req, res) => {
  const course = await findCourseOr404(req.params.code);
  const [enrollment, lessons] = await Promise.all([
    Enrollment.findOne({ user: req.user._id, course: course._id }),
    listLessons(course._id),
  ]);

  const done = new Set((enrollment?.completedLessons || []).map((entry) => String(entry.lesson)));

  res.json({
    success: true,
    course: { code: course.code, name: course.name },
    progress: buildProgress(enrollment, lessons),
    lessons: lessons.map((lesson) => ({
      ...lesson.toPublicJSON(),
      completed: done.has(String(lesson._id)),
    })),
  });
});

/**
 * GET /api/courses/:code/lessons/:number
 *
 * Reading a lesson also records it as the last one opened, so "Resume" on the
 * dashboard returns to where the student actually stopped rather than to the
 * first unfinished lesson in the list.
 */
export const getLesson = asyncHandler(async (req, res) => {
  const course = await findCourseOr404(req.params.code);
  const number = Number(req.params.number);
  if (!Number.isInteger(number) || number < 1) {
    throw ApiError.notFound("That lesson could not be found.");
  }

  const lesson = await Lesson.findOne({ course: course._id, number, published: true });
  if (!lesson) throw ApiError.notFound("That lesson could not be found.");

  const enrollment = await Enrollment.findOne({ user: req.user._id, course: course._id });
  if (!enrollment) {
    throw ApiError.forbidden("You are not enrolled on this course yet.", {
      code: "NOT_ENROLLED",
    });
  }

  enrollment.lastLesson = lesson._id;
  enrollment.lastActiveAt = new Date();
  await enrollment.save();

  const lessons = await listLessons(course._id);

  res.json({
    success: true,
    course: { code: course.code, name: course.name },
    lesson: {
      ...lesson.toPublicJSON(),
      completed: enrollment.hasCompleted(lesson._id),
    },
    // Prev/next so the reader can move through the course without going back to
    // the list.
    previous: lessons.find((entry) => entry.number < number)
      ? lessons.filter((entry) => entry.number < number).at(-1).number
      : null,
    next: lessons.find((entry) => entry.number > number)?.number || null,
    progress: buildProgress(enrollment, lessons),
  });
});

/* -------------------------------------------------------------- enrollment -- */

/**
 * POST /api/courses/:code/enroll
 *
 * The first enrollment is created for the student when an administrator approves
 * their application, so this is for moving on to the next programme. It enforces
 * the three rules the enrollment form displays: admission must be granted, the
 * preceding certificate must be finished, and no other course may be in progress.
 */
export const enrollInCourse = asyncHandler(async (req, res) => {
  const course = await findCourseOr404(req.params.code);
  if (!course.published) {
    throw ApiError.forbidden("This course is not open for enrollment yet.");
  }

  const application = await Application.findOne({ user: req.user._id });
  if (application?.status !== APPLICATION_STATUS.APPROVED) {
    throw ApiError.forbidden(
      "Your application has to be approved before you can enroll on a course.",
      { code: "APPLICATION_NOT_APPROVED" },
    );
  }

  const existing = await Enrollment.findOne({ user: req.user._id, course: course._id });
  if (existing) {
    return res.json({
      success: true,
      message: `You are already enrolled on the ${course.name}.`,
      enrollment: { status: existing.status, enrolledAt: existing.enrolledAt },
    });
  }

  if (course.requiresCourseCode) {
    const completed = await completedCourseCodes(req.user._id);
    if (!completed.has(course.requiresCourseCode)) {
      throw ApiError.forbidden(course.lockedMessage || "Complete the previous course first.", {
        code: "PREREQUISITE_NOT_MET",
      });
    }
  }

  /**
   * One course at a time.
   *
   * Checked after the "already enrolled on this one" branch above, so re-selecting
   * the course you are currently taking still succeeds — it is only a *second,
   * different* programme that is refused. Completed and withdrawn enrollments do
   * not count, so finishing BCC leaves you free to start LCC.
   */
  const active = await findActiveEnrollment(req.user._id);
  if (active) {
    throw ApiError.forbidden(
      `You are already studying the ${active.course?.name || "a course"}. You may take one course at a time — finish or withdraw from it before starting another.`,
      { code: "ALREADY_STUDYING" },
    );
  }

  let enrollment;
  try {
    enrollment = await Enrollment.create({
      user: req.user._id,
      course: course._id,
      intake: req.user.intake?.code
        ? { code: req.user.intake.code, label: req.user.intake.label }
        : { code: CURRENT_INTAKE.code, label: CURRENT_INTAKE.label },
    });
  } catch (error) {
    // The partial unique index is the final guard when two tabs submit at once.
    if (error?.code === 11000) {
      throw ApiError.forbidden(
        "You are already studying a course. Finish or withdraw from it before starting another.",
        { code: "ALREADY_STUDYING" },
      );
    }
    throw error;
  }

  res.status(201).json({
    success: true,
    message: `You are enrolled on the ${course.name}.`,
    enrollment: { status: enrollment.status, enrolledAt: enrollment.enrolledAt },
  });
});

/* ---------------------------------------------------------------- progress -- */

const loadEnrolledLesson = async (user, code, rawNumber) => {
  const course = await findCourseOr404(code);
  const number = Number(rawNumber);
  const lesson = await Lesson.findOne({ course: course._id, number, published: true });
  if (!lesson) throw ApiError.notFound("That lesson could not be found.");

  const enrollment = await Enrollment.findOne({ user: user._id, course: course._id });
  if (!enrollment) {
    throw ApiError.forbidden("You are not enrolled on this course yet.", { code: "NOT_ENROLLED" });
  }
  return { course, lesson, enrollment };
};

/**
 * POST /api/courses/:code/lessons/:number/complete
 *
 * Idempotent: completing a lesson twice leaves the progress unchanged, because
 * completions are stored as lesson references rather than a counter.
 */
export const completeLesson = asyncHandler(async (req, res) => {
  const { course, lesson, enrollment } = await loadEnrolledLesson(
    req.user,
    req.params.code,
    req.params.number,
  );

  if (!enrollment.hasCompleted(lesson._id)) {
    enrollment.completedLessons.push({ lesson: lesson._id, completedAt: new Date() });
  }
  enrollment.lastLesson = lesson._id;
  enrollment.lastActiveAt = new Date();

  const lessons = await listLessons(course._id);
  const progress = buildProgress(enrollment, lessons);

  // Finishing every published lesson completes the programme, which is what
  // unlocks the next certificate.
  if (progress.total > 0 && progress.completed >= progress.total) {
    enrollment.status = ENROLLMENT_STATUS.COMPLETED;
    enrollment.completedAt = enrollment.completedAt || new Date();
  } else if (enrollment.status === ENROLLMENT_STATUS.COMPLETED) {
    enrollment.status = ENROLLMENT_STATUS.ACTIVE;
    enrollment.completedAt = undefined;
  }

  await enrollment.save();

  res.json({
    success: true,
    message:
      progress.completed >= progress.total && progress.total > 0
        ? `Well done — you have completed the ${course.name}.`
        : "Lesson marked as complete.",
    progress,
    nextLesson: resolveNextLesson(enrollment, lessons)?.toPublicJSON() || null,
    courseComplete: enrollment.status === ENROLLMENT_STATUS.COMPLETED,
  });
});

/** DELETE /api/courses/:code/lessons/:number/complete — undo a mistaken tick. */
export const uncompleteLesson = asyncHandler(async (req, res) => {
  const { course, lesson, enrollment } = await loadEnrolledLesson(
    req.user,
    req.params.code,
    req.params.number,
  );

  enrollment.completedLessons = enrollment.completedLessons.filter(
    (entry) => String(entry.lesson) !== String(lesson._id),
  );
  if (enrollment.status === ENROLLMENT_STATUS.COMPLETED) {
    enrollment.status = ENROLLMENT_STATUS.ACTIVE;
    enrollment.completedAt = undefined;
  }
  await enrollment.save();

  const lessons = await listLessons(course._id);

  res.json({
    success: true,
    message: "Lesson marked as not complete.",
    progress: buildProgress(enrollment, lessons),
    nextLesson: resolveNextLesson(enrollment, lessons)?.toPublicJSON() || null,
  });
});
