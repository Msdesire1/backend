/**
 * Coursework: the "Upcoming assignments" card, the full list, and submissions.
 *
 * An assignment is only visible to students enrolled on its course, so the
 * enrolled course ids are the first thing every handler here establishes.
 */
import { Assignment, Submission, SUBMISSION_STATUS } from "../models/assignment.model.js";
import Enrollment from "../models/enrollment.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { uploadBuffer, deleteFile } from "../config/gridfs.js";
import { ENROLLMENT_STATUS } from "../config/constants.js";

const enrolledCourseIds = async (userId) => {
  const enrollments = await Enrollment.find({
    user: userId,
    status: { $ne: ENROLLMENT_STATUS.WITHDRAWN },
  }).select("course");
  return enrollments.map((enrollment) => enrollment.course);
};

/** Submissions for a set of assignments, keyed by assignment id. */
const submissionsFor = async (userId, assignmentIds) => {
  const submissions = await Submission.find({
    user: userId,
    assignment: { $in: assignmentIds },
  });
  return new Map(submissions.map((submission) => [String(submission.assignment), submission]));
};

/**
 * GET /api/assignments
 *
 * Split into `upcoming` and `past` around the due date, because the dashboard
 * card shows only what is still ahead — "The Power of Vision · Due Fri, 27 Mar ·
 * In 4 days".
 */
export const listMyAssignments = asyncHandler(async (req, res) => {
  const courseIds = await enrolledCourseIds(req.user._id);
  if (!courseIds.length) {
    return res.json({ success: true, upcoming: [], past: [], assignments: [] });
  }

  const assignments = await Assignment.find({
    course: { $in: courseIds },
    published: true,
  }).sort({ dueAt: 1 });

  const submissions = await submissionsFor(
    req.user._id,
    assignments.map((assignment) => assignment._id),
  );

  const now = Date.now();
  const rows = assignments.map((assignment) =>
    assignment.toPublicJSON(submissions.get(String(assignment._id)) || null),
  );

  res.json({
    success: true,
    upcoming: rows.filter((row) => new Date(row.dueAt).getTime() >= now),
    // Newest first once a deadline has passed — the useful order for looking back.
    past: rows.filter((row) => new Date(row.dueAt).getTime() < now).reverse(),
    assignments: rows,
  });
});

const loadVisibleAssignment = async (userId, assignmentId) => {
  const assignment = await Assignment.findById(assignmentId).populate("course", "code name");
  if (!assignment || !assignment.published) {
    throw ApiError.notFound("That assignment could not be found.");
  }
  const enrollment = await Enrollment.findOne({
    user: userId,
    course: assignment.course?._id || assignment.course,
  });
  if (!enrollment) {
    // Same message as a missing assignment: whether one exists on a course you
    // are not enrolled on is not your business.
    throw ApiError.notFound("That assignment could not be found.");
  }
  return assignment;
};

/** GET /api/assignments/:id */
export const getAssignment = asyncHandler(async (req, res) => {
  const assignment = await loadVisibleAssignment(req.user._id, req.params.id);
  const submission = await Submission.findOne({
    assignment: assignment._id,
    user: req.user._id,
  });

  res.json({
    success: true,
    assignment: {
      ...assignment.toPublicJSON(submission),
      course: assignment.course
        ? { code: assignment.course.code, name: assignment.course.name }
        : null,
    },
  });
});

/**
 * POST /api/assignments/:id/submit
 *
 * Accepts written work, a file, or both. Re-submitting before the deadline
 * replaces the previous attempt rather than creating a second one; once graded it
 * is locked, so a mark cannot be quietly detached from the work it was given for.
 */
export const submitAssignment = asyncHandler(async (req, res) => {
  const assignment = await loadVisibleAssignment(req.user._id, req.params.id);

  const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
  const file = req.files?.attachment || null;
  if (!text && !file) {
    throw ApiError.unprocessable("Add your answer or attach a file before submitting.", {
      text: "Write your answer or attach a file.",
    });
  }

  let submission = await Submission.findOne({ assignment: assignment._id, user: req.user._id });
  if (submission?.status === SUBMISSION_STATUS.GRADED) {
    throw new ApiError(409, "This assignment has already been graded and can no longer be changed.", {
      code: "ALREADY_GRADED",
    });
  }

  const stored = file
    ? await uploadBuffer({
        buffer: file.buffer,
        filename: file.filename,
        contentType: file.contentType,
        metadata: {
          user: req.user._id,
          assignment: assignment._id,
          kind: "assignment",
        },
      })
    : null;

  const submittedAt = new Date();
  const late = submittedAt > assignment.dueAt;

  if (submission) {
    const previous = submission.attachment?.fileId;
    submission.text = text;
    if (stored) submission.attachment = stored;
    submission.submittedAt = submittedAt;
    submission.late = late;
    await submission.save();
    if (stored && previous) {
      deleteFile(previous).catch((error) =>
        console.error(`[gridfs] could not remove replaced attachment: ${error.message}`),
      );
    }
  } else {
    submission = await Submission.create({
      assignment: assignment._id,
      user: req.user._id,
      text,
      attachment: stored,
      submittedAt,
      late,
    });
  }

  res.status(201).json({
    success: true,
    message: late
      ? "Your work has been submitted, and marked as late."
      : "Your work has been submitted.",
    assignment: assignment.toPublicJSON(submission),
  });
});
