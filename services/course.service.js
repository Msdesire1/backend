/**
 * Course, lesson and progress logic shared by the student course pages, the
 * dashboard aggregate and the admin views.
 *
 * It lives in a service rather than a controller because three different
 * endpoints need the same answers, and "what percentage has this student
 * completed" must not be able to disagree between them.
 *
 * Two deliberate rules:
 *
 * 1. Courses lock, lessons do not. The enrollment form itself shows
 *    "Complete Basic Certificate first" on the later programmes, so programme
 *    prerequisites are enforced. Individual lessons stay open, so a student can
 *    read ahead or revisit — locking them would only add ways to get stuck, and
 *    nothing in the UI promises that behaviour.
 *
 * 2. Progress is always derived, never stored. Publishing a new lesson changes
 *    everyone's percentage on the next read instead of leaving stale numbers.
 */
import Course from "../models/course.model.js";
import Lesson from "../models/lesson.model.js";
import Enrollment from "../models/enrollment.model.js";
import { ENROLLMENT_STATUS } from "../config/constants.js";

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Published lessons for a programme, in teaching order. */
export const listLessons = (courseId) =>
  Lesson.find({ course: courseId, published: true }).sort({ number: 1 });

/**
 * The progress numbers and the exact display strings the dashboard renders:
 * "1 of 3 lessons", "2 lessons to go", "1 of 3 lessons complete", "68%".
 */
export const buildProgress = (enrollment, lessons = []) => {
  const total = lessons.length;
  const publishedIds = new Set(lessons.map((lesson) => String(lesson._id)));
  // Count only completions that still point at a published lesson, so
  // unpublishing a lesson cannot push someone above 100%.
  const completed = (enrollment?.completedLessons || []).filter((entry) =>
    publishedIds.has(String(entry.lesson)),
  ).length;
  const remaining = Math.max(0, total - completed);
  const percent = total ? Math.round((completed / total) * 100) : 0;

  return {
    total,
    completed,
    remaining,
    percent,
    percentLabel: `${percent}%`,
    countLabel: `${completed} of ${plural(total, "lesson")}`,
    completeLabel: `${completed} of ${plural(total, "lesson")} complete`,
    remainingLabel: remaining ? `${plural(remaining, "lesson")} to go` : "All lessons complete",
  };
};

/** The first lesson the student has not finished — what "Resume" should open. */
export const resolveNextLesson = (enrollment, lessons = []) => {
  const done = new Set((enrollment?.completedLessons || []).map((entry) => String(entry.lesson)));
  return lessons.find((lesson) => !done.has(String(lesson._id))) || null;
};

/** Groups a flat lesson list into the modules the course page displays. */
export const groupIntoModules = (lessons = [], enrollment = null) => {
  const done = new Set((enrollment?.completedLessons || []).map((entry) => String(entry.lesson)));
  const modules = new Map();

  for (const lesson of lessons) {
    const key = lesson.moduleNumber || 1;
    if (!modules.has(key)) {
      modules.set(key, {
        number: key,
        title: lesson.moduleTitle || `Module ${key}`,
        lessons: [],
      });
    }
    modules.get(key).lessons.push({
      ...lesson.toPublicJSON(),
      completed: done.has(String(lesson._id)),
    });
  }

  return [...modules.values()]
    .sort((a, b) => a.number - b.number)
    .map((module) => ({
      ...module,
      label: `Module ${module.number}`,
      lessonCount: module.lessons.length,
      completedCount: module.lessons.filter((lesson) => lesson.completed).length,
    }));
};

/** Programme codes this student has finished — the key to unlocking the next one. */
export const completedCourseCodes = async (userId) => {
  const finished = await Enrollment.find({
    user: userId,
    status: ENROLLMENT_STATUS.COMPLETED,
  }).populate("course", "code");
  return new Set(finished.map((enrollment) => enrollment.course?.code).filter(Boolean));
};

/**
 * The one course a student is currently taking, if any.
 *
 * A student may only be studying one programme at a time — the courses are run as
 * a progression, and the timetable is the same hours for all three, so two at once
 * is not something the institute can actually deliver. `enrollment.model.js` has a
 * unique index on {user, course}, but that only stops enrolling on the *same*
 * course twice; this is what stops two different ones running side by side.
 *
 * Completed and withdrawn enrollments are deliberately not counted: those are the
 * history the prerequisite chain is built from, and a student who has finished BCC
 * must stay free to start LCC.
 */
export const findActiveEnrollment = async (userId) =>
  Enrollment.findOne({ user: userId, status: ENROLLMENT_STATUS.ACTIVE }).populate(
    "course",
    "code name",
  );

/**
 * The course card, matching the `courses` array in CourseEnrollment.jsx field for
 * field, with the student's own state added.
 *
 * A course is locked either because its prerequisite is unfinished or because the
 * student is already studying something else. The second reason has to be visible
 * on the card: a button that looks available and then fails on click is the same
 * bug as no rule at all.
 */
export const describeCourse = (
  course,
  { enrollment, progress, completedCodes, activeEnrollment = null },
) => {
  const prerequisite = course.requiresCourseCode;
  const missingPrerequisite = Boolean(prerequisite) && !completedCodes.has(prerequisite);

  const activeCourseId = activeEnrollment?.course?._id || activeEnrollment?.course;
  const studyingElsewhere =
    Boolean(activeCourseId) && String(activeCourseId) !== String(course._id);

  const locked = missingPrerequisite || studyingElsewhere;
  const statusMessage = () => {
    // Prerequisite first: it is the more fundamental of the two, and telling
    // someone to finish their current course implies the next one is otherwise
    // open to them, which may not be true.
    if (missingPrerequisite) return course.lockedMessage || "Complete the previous course first.";
    if (studyingElsewhere) {
      const name = activeEnrollment?.course?.name;
      return name
        ? `Finish your ${name} first — you may take one course at a time.`
        : "Finish your current course first — you may take one course at a time.";
    }
    return course.availableMessage;
  };

  return {
    ...course.toPublicJSON(),
    locked,
    // The frontend shows this string under the course name.
    statusMessage: statusMessage(),
    lockedReason: missingPrerequisite
      ? "PREREQUISITE_NOT_MET"
      : studyingElsewhere
        ? "ALREADY_STUDYING"
        : null,
    enrolled: Boolean(enrollment),
    enrollmentStatus: enrollment?.status || null,
    progress: progress || null,
  };
};

/**
 * Every published programme with this student's enrollment state — what the
 * course chooser needs in a single request.
 */
export const getCourseCatalogue = async (userId) => {
  const [courses, enrollments, completedCodes, activeEnrollment] = await Promise.all([
    Course.find({ published: true, active: true }).sort({ order: 1 }),
    Enrollment.find({ user: userId }),
    completedCourseCodes(userId),
    findActiveEnrollment(userId),
  ]);

  const byCourse = new Map(enrollments.map((entry) => [String(entry.course), entry]));

  return Promise.all(
    courses.map(async (course) => {
      const enrollment = byCourse.get(String(course._id)) || null;
      const progress = enrollment ? buildProgress(enrollment, await listLessons(course._id)) : null;
      return describeCourse(course, { enrollment, progress, completedCodes, activeEnrollment });
    }),
  );
};

/**
 * The enrollment to feature on the dashboard: the most recently active one still
 * in progress, falling back to the most recent of any status so a student who has
 * finished everything still sees their last programme rather than an empty card.
 */
export const getPrimaryEnrollment = async (userId) => {
  const active = await Enrollment.findOne({ user: userId, status: ENROLLMENT_STATUS.ACTIVE })
    .sort({ lastActiveAt: -1 })
    .populate("course");
  if (active) return active;
  return Enrollment.findOne({ user: userId }).sort({ updatedAt: -1 }).populate("course");
};

/** How many students share this programme and intake — "18 learners in your cohort". */
export const getCohortSize = (courseId, intakeCode) =>
  Enrollment.countDocuments({
    course: courseId,
    "intake.code": intakeCode,
    status: { $ne: ENROLLMENT_STATUS.WITHDRAWN },
  });
