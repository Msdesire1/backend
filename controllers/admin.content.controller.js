/**
 * Course content management: programmes, lessons and coursework.
 *
 * app/dashboard/admin/courses/page.jsx currently says "Coming Soon", so nothing
 * here has a screen yet. It exists because the alternative is that the only way
 * to add a lesson is to edit the seed script and redeploy — the student side of
 * the app is useless without content, and content has to come from somewhere.
 *
 * Every route is mounted behind requireAdmin in routes/admin.routes.js.
 */
import Course from "../models/course.model.js";
import Lesson from "../models/lesson.model.js";
import Enrollment from "../models/enrollment.model.js";
import { Assignment, Submission, SUBMISSION_STATUS } from "../models/assignment.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { ENROLLMENT_STATUS } from "../config/constants.js";

const clean = (value) => (typeof value === "string" ? value.trim() : "");

/** Copy only the keys the caller actually sent, so a PATCH stays a PATCH. */
const pick = (body = {}, fields) => {
  const out = {};
  for (const field of fields) if (body[field] !== undefined) out[field] = body[field];
  return out;
};

const findCourseOr404 = async (codeOrId) => {
  const value = clean(codeOrId);
  const course =
    (await Course.findOne({ code: value.toUpperCase() })) ||
    (value.match(/^[a-f\d]{24}$/i) ? await Course.findById(value) : null);
  if (!course) throw ApiError.notFound(`No course found for "${codeOrId}".`);
  return course;
};

/* ----------------------------------------------------------------- courses -- */

/** GET /api/admin/courses — includes the unpublished ones the students cannot see. */
export const listAllCourses = asyncHandler(async (req, res) => {
  const courses = await Course.find({}).sort({ order: 1 });
  const [lessonCounts, enrollmentCounts] = await Promise.all([
    Lesson.aggregate([{ $group: { _id: "$course", count: { $sum: 1 } } }]),
    Enrollment.aggregate([
      { $match: { status: ENROLLMENT_STATUS.ACTIVE } },
      { $group: { _id: "$course", count: { $sum: 1 } } },
    ]),
  ]);
  const lessonsBy = new Map(lessonCounts.map((row) => [String(row._id), row.count]));
  const studentsBy = new Map(enrollmentCounts.map((row) => [String(row._id), row.count]));

  res.json({
    success: true,
    courses: courses.map((course) => ({
      ...course.toPublicJSON(),
      published: course.published,
      active: course.active,
      lecturerTitle: course.lecturer?.title || "",
      lessonCount: lessonsBy.get(String(course._id)) || 0,
      activeStudents: studentsBy.get(String(course._id)) || 0,
    })),
  });
});

const COURSE_FIELDS = [
  "name",
  "period",
  "description",
  "availableMessage",
  "lockedMessage",
  "accent",
  "order",
  "requiresCourseCode",
  "feeNaira",
  "published",
  "active",
];

/** POST /api/admin/courses */
export const createCourse = asyncHandler(async (req, res) => {
  const code = clean(req.body?.code).toUpperCase();
  const name = clean(req.body?.name);

  const errors = {};
  if (!code) errors.code = "Give the course a short code, e.g. BCC.";
  if (!name) errors.name = "Give the course a name.";
  if (Object.keys(errors).length) {
    throw ApiError.unprocessable("Please correct the highlighted fields.", errors);
  }
  if (await Course.exists({ code })) {
    throw ApiError.conflict(`A course with the code ${code} already exists.`);
  }

  const course = await Course.create({
    ...pick(req.body, COURSE_FIELDS),
    code,
    name,
    lecturer: {
      name: clean(req.body?.lecturerName || req.body?.lecturer?.name),
      title: clean(req.body?.lecturerTitle || req.body?.lecturer?.title),
    },
  });

  res.status(201).json({ success: true, message: `${course.name} created.`, course: course.toPublicJSON() });
});

/** PATCH /api/admin/courses/:code */
export const updateCourse = asyncHandler(async (req, res) => {
  const course = await findCourseOr404(req.params.code);
  Object.assign(course, pick(req.body, COURSE_FIELDS));

  if (req.body?.lecturerName !== undefined) course.lecturer.name = clean(req.body.lecturerName);
  if (req.body?.lecturerTitle !== undefined) course.lecturer.title = clean(req.body.lecturerTitle);

  await course.save();
  res.json({ success: true, message: `${course.name} updated.`, course: course.toPublicJSON() });
});

/* ----------------------------------------------------------------- lessons -- */

/** GET /api/admin/courses/:code/lessons */
export const listAllLessons = asyncHandler(async (req, res) => {
  const course = await findCourseOr404(req.params.code);
  // Unlike the student route, this deliberately includes unpublished drafts.
  const lessons = await Lesson.find({ course: course._id }).sort({ number: 1 });
  res.json({
    success: true,
    course: course.toPublicJSON(),
    lessons: lessons.map((lesson) => ({ ...lesson.toPublicJSON(), published: lesson.published })),
  });
});

const LESSON_FIELDS = [
  "number",
  "title",
  "summary",
  "moduleNumber",
  "moduleTitle",
  "durationMinutes",
  "type",
  "lecturer",
  "videoUrl",
  "resourceUrl",
  "published",
];

/** POST /api/admin/courses/:code/lessons */
export const createLesson = asyncHandler(async (req, res) => {
  const course = await findCourseOr404(req.params.code);
  const title = clean(req.body?.title);
  if (!title) throw ApiError.unprocessable("Give the lesson a title.", { title: "Required." });

  // Default to the next free number so adding lessons in order needs no bookkeeping.
  const highest = await Lesson.findOne({ course: course._id }).sort({ number: -1 }).select("number");
  const number = Number(req.body?.number) || (highest?.number || 0) + 1;

  if (await Lesson.exists({ course: course._id, number })) {
    throw ApiError.conflict(`${course.code} already has a lesson ${number}.`, {
      code: "LESSON_NUMBER_TAKEN",
    });
  }

  const lesson = await Lesson.create({
    ...pick(req.body, LESSON_FIELDS),
    course: course._id,
    title,
    number,
  });

  res.status(201).json({ success: true, message: `Lesson ${number} created.`, lesson: lesson.toPublicJSON() });
});

/** PATCH /api/admin/lessons/:id */
export const updateLesson = asyncHandler(async (req, res) => {
  const lesson = await Lesson.findById(req.params.id);
  if (!lesson) throw ApiError.notFound("That lesson could not be found.");

  const changes = pick(req.body, LESSON_FIELDS);
  if (changes.number !== undefined && Number(changes.number) !== lesson.number) {
    if (await Lesson.exists({ course: lesson.course, number: Number(changes.number) })) {
      throw ApiError.conflict(`Lesson ${changes.number} already exists on this course.`, {
        code: "LESSON_NUMBER_TAKEN",
      });
    }
  }

  Object.assign(lesson, changes);
  await lesson.save();
  res.json({ success: true, message: "Lesson updated.", lesson: lesson.toPublicJSON() });
});

/**
 * DELETE /api/admin/lessons/:id
 *
 * Unpublishes rather than deletes. Students' completion records point at lesson
 * ids; removing the row would leave their progress referring to nothing, and
 * services/course.service.js already ignores unpublished lessons when it counts
 * progress, so an unpublish is the clean way to retire one.
 */
export const retireLesson = asyncHandler(async (req, res) => {
  const lesson = await Lesson.findById(req.params.id);
  if (!lesson) throw ApiError.notFound("That lesson could not be found.");

  lesson.published = false;
  await lesson.save();
  res.json({
    success: true,
    message: `Lesson ${lesson.number} is no longer visible to students.`,
    lesson: lesson.toPublicJSON(),
  });
});

/* -------------------------------------------------------------- coursework -- */

/** GET /api/admin/courses/:code/assignments */
export const listCourseAssignments = asyncHandler(async (req, res) => {
  const course = await findCourseOr404(req.params.code);
  const assignments = await Assignment.find({ course: course._id }).sort({ dueAt: 1 });
  const counts = await Submission.aggregate([
    { $match: { assignment: { $in: assignments.map((assignment) => assignment._id) } } },
    { $group: { _id: { assignment: "$assignment", status: "$status" }, count: { $sum: 1 } } },
  ]);

  const tally = new Map();
  for (const row of counts) {
    const key = String(row._id.assignment);
    const entry = tally.get(key) || { submitted: 0, graded: 0 };
    if (row._id.status === SUBMISSION_STATUS.GRADED) entry.graded += row.count;
    entry.submitted += row.count;
    tally.set(key, entry);
  }

  res.json({
    success: true,
    course: course.toPublicJSON(),
    assignments: assignments.map((assignment) => ({
      ...assignment.toPublicJSON(),
      published: assignment.published,
      submissionCount: tally.get(String(assignment._id))?.submitted || 0,
      gradedCount: tally.get(String(assignment._id))?.graded || 0,
    })),
  });
});

const ASSIGNMENT_FIELDS = ["title", "instructions", "dueAt", "maxScore", "published", "lesson"];

/** POST /api/admin/courses/:code/assignments */
export const createAssignment = asyncHandler(async (req, res) => {
  const course = await findCourseOr404(req.params.code);

  const title = clean(req.body?.title);
  const dueAt = req.body?.dueAt ? new Date(req.body.dueAt) : null;
  const errors = {};
  if (!title) errors.title = "Give the assignment a title.";
  if (!dueAt || Number.isNaN(dueAt.getTime())) errors.dueAt = "Set a due date.";
  if (Object.keys(errors).length) {
    throw ApiError.unprocessable("Please correct the highlighted fields.", errors);
  }

  const assignment = await Assignment.create({
    ...pick(req.body, ASSIGNMENT_FIELDS),
    course: course._id,
    title,
    dueAt,
    createdBy: req.admin._id,
  });

  res.status(201).json({ success: true, message: "Assignment created.", assignment: assignment.toPublicJSON() });
});

/** PATCH /api/admin/assignments/:id */
export const updateAssignment = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) throw ApiError.notFound("That assignment could not be found.");

  const changes = pick(req.body, ASSIGNMENT_FIELDS);
  if (changes.dueAt) {
    const dueAt = new Date(changes.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      throw ApiError.unprocessable("That due date could not be read.", { dueAt: "Use a valid date." });
    }
    changes.dueAt = dueAt;
  }

  Object.assign(assignment, changes);
  await assignment.save();
  res.json({ success: true, message: "Assignment updated.", assignment: assignment.toPublicJSON() });
});

/** GET /api/admin/assignments/:id/submissions */
export const listSubmissions = asyncHandler(async (req, res) => {
  const assignment = await Assignment.findById(req.params.id);
  if (!assignment) throw ApiError.notFound("That assignment could not be found.");

  const submissions = await Submission.find({ assignment: assignment._id })
    .sort({ submittedAt: 1 })
    .populate("user", "firstName lastName email studentId");

  res.json({
    success: true,
    assignment: assignment.toPublicJSON(),
    submissions: submissions.map((submission) => ({
      ...submission.toPublicJSON(),
      student: {
        id: submission.user?._id,
        name: [submission.user?.firstName, submission.user?.lastName].filter(Boolean).join(" "),
        email: submission.user?.email || "",
        studentId: submission.user?.studentId || null,
      },
    })),
  });
});

/** POST /api/admin/submissions/:id/grade — Body: { score, feedback? } */
export const gradeSubmission = asyncHandler(async (req, res) => {
  const submission = await Submission.findById(req.params.id);
  if (!submission) throw ApiError.notFound("That submission could not be found.");

  const assignment = await Assignment.findById(submission.assignment);
  const maxScore = assignment?.maxScore || 100;
  const score = Number(req.body?.score);

  if (!Number.isFinite(score) || score < 0 || score > maxScore) {
    throw ApiError.unprocessable(`Enter a score between 0 and ${maxScore}.`, {
      score: `Must be between 0 and ${maxScore}.`,
    });
  }

  submission.score = score;
  submission.feedback = clean(req.body?.feedback);
  submission.status = SUBMISSION_STATUS.GRADED;
  submission.gradedAt = new Date();
  submission.gradedBy = req.admin._id;
  await submission.save();

  res.json({
    success: true,
    message: `Graded ${score}/${maxScore}.`,
    submission: submission.toPublicJSON(),
  });
});

export { findCourseOr404 };
