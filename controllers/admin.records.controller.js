/**
 * Announcements, attendance registers and certificates — the admin side of three
 * student-facing features.
 *
 * Attendance is the interesting one. Students can check themselves in from their
 * dashboard, but somebody has to be able to mark the register for the people who
 * did not, correct a mistake, and record an approved absence as excused rather
 * than absent. `markAttendance` therefore upserts, and records which admin did it.
 */
import Attendance, { startOfDayUTC } from "../models/attendance.model.js";
import Certificate from "../models/certificate.model.js";
import Enrollment from "../models/enrollment.model.js";
import User from "../models/user.model.js";
import { Announcement, ANNOUNCEMENT_AUDIENCE } from "../models/announcement.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { generateCertificateNumber } from "../utils/ids.js";
import { findCourseOr404 } from "./admin.content.controller.js";
import { summariseRecords } from "../services/attendance.service.js";
import {
  ATTENDANCE_STATUSES,
  ENROLLMENT_STATUS,
  formatDisplayDate,
} from "../config/constants.js";

const clean = (value) => (typeof value === "string" ? value.trim() : "");

/* ----------------------------------------------------------- announcements -- */

/** GET /api/admin/announcements — every announcement, including retired ones. */
export const listAllAnnouncements = asyncHandler(async (req, res) => {
  const announcements = await Announcement.find({})
    .sort({ publishedAt: -1 })
    .populate("course", "code name");

  res.json({
    success: true,
    announcements: announcements.map((announcement) => ({
      ...announcement.toPublicJSON(),
      audience: announcement.audience,
      course: announcement.course
        ? { code: announcement.course.code, name: announcement.course.name }
        : null,
      active: announcement.active,
    })),
    audiences: Object.values(ANNOUNCEMENT_AUDIENCE),
  });
});

/** POST /api/admin/announcements */
export const createAnnouncement = asyncHandler(async (req, res) => {
  const title = clean(req.body?.title);
  const body = clean(req.body?.body);
  const audience = Object.values(ANNOUNCEMENT_AUDIENCE).includes(req.body?.audience)
    ? req.body.audience
    : ANNOUNCEMENT_AUDIENCE.ALL;

  const errors = {};
  if (!title) errors.title = "Give the announcement a title.";
  if (!body) errors.body = "Write the announcement.";
  if (Object.keys(errors).length) {
    throw ApiError.unprocessable("Please correct the highlighted fields.", errors);
  }

  let course = null;
  if (audience === ANNOUNCEMENT_AUDIENCE.COURSE) {
    if (!req.body?.course) {
      throw ApiError.unprocessable("Choose which course this is for.", {
        course: "Required for a course announcement.",
      });
    }
    course = await findCourseOr404(req.body.course);
  }

  const announcement = await Announcement.create({
    title,
    body,
    audience,
    course: course?._id || null,
    important: Boolean(req.body?.important),
    // Scheduling ahead is allowed: the student query filters on publishedAt <= now.
    publishedAt: req.body?.publishedAt ? new Date(req.body.publishedAt) : new Date(),
    createdBy: req.admin._id,
  });

  res.status(201).json({
    success: true,
    message: "Announcement published.",
    announcement: announcement.toPublicJSON(),
  });
});

/** PATCH /api/admin/announcements/:id */
export const updateAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await Announcement.findById(req.params.id);
  if (!announcement) throw ApiError.notFound("That announcement could not be found.");

  if (req.body?.title !== undefined) announcement.title = clean(req.body.title);
  if (req.body?.body !== undefined) announcement.body = clean(req.body.body);
  if (req.body?.important !== undefined) announcement.important = Boolean(req.body.important);
  if (req.body?.active !== undefined) announcement.active = Boolean(req.body.active);
  if (req.body?.publishedAt !== undefined) announcement.publishedAt = new Date(req.body.publishedAt);

  await announcement.save();
  res.json({ success: true, message: "Announcement updated.", announcement: announcement.toPublicJSON() });
});

/**
 * DELETE /api/admin/announcements/:id
 *
 * Deactivates rather than deletes, so the read receipts against it stay meaningful
 * and it can be brought back if it was retired by mistake.
 */
export const retireAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await Announcement.findById(req.params.id);
  if (!announcement) throw ApiError.notFound("That announcement could not be found.");

  announcement.active = false;
  await announcement.save();
  res.json({ success: true, message: "Announcement withdrawn." });
});

/* -------------------------------------------------------------- attendance -- */

/**
 * GET /api/admin/attendance?date=2026-08-19&course=BCC
 *
 * The register for one day: every actively enrolled student, with their mark if
 * they have one. Students with no record come back as `status: null` rather than
 * being left out, so the admin can see who is unaccounted for.
 */
export const getAttendanceRegister = asyncHandler(async (req, res) => {
  const date = startOfDayUTC(req.query.date ? new Date(req.query.date) : new Date());
  if (!date) throw ApiError.badRequest("That date could not be read. Use YYYY-MM-DD.");

  const course = req.query.course ? await findCourseOr404(req.query.course) : null;

  const enrollmentFilter = { status: ENROLLMENT_STATUS.ACTIVE };
  if (course) enrollmentFilter.course = course._id;
  const enrollments = await Enrollment.find(enrollmentFilter)
    .populate("user", "firstName lastName email studentId")
    .populate("course", "code name");

  const records = await Attendance.find({
    date,
    user: { $in: enrollments.map((enrollment) => enrollment.user?._id).filter(Boolean) },
  });
  const byUser = new Map(records.map((record) => [String(record.user), record]));

  const rows = enrollments
    .filter((enrollment) => enrollment.user)
    .map((enrollment) => {
      const record = byUser.get(String(enrollment.user._id));
      return {
        student: {
          id: enrollment.user._id,
          name: [enrollment.user.firstName, enrollment.user.lastName].filter(Boolean).join(" "),
          email: enrollment.user.email,
          studentId: enrollment.user.studentId || null,
        },
        course: enrollment.course
          ? { code: enrollment.course.code, name: enrollment.course.name }
          : null,
        status: record?.status || null,
        note: record?.note || "",
        checkedInAt: record?.checkedInAt || null,
        selfRecorded: Boolean(record && !record.recordedBy),
      };
    })
    .sort((a, b) => a.student.name.localeCompare(b.student.name));

  res.json({
    success: true,
    date: date.toISOString().slice(0, 10),
    dateLabel: formatDisplayDate(date),
    course: course ? course.toPublicJSON() : null,
    statuses: ATTENDANCE_STATUSES,
    register: rows,
    summary: summariseRecords(records),
    unmarked: rows.filter((row) => !row.status).length,
  });
});

/**
 * POST /api/admin/attendance
 * Body: { date?, course?, entries: [{ user, status, note? }] }
 *
 * Marks or amends the register in one call — an admin ticking off a room of
 * students should not fire twenty requests.
 */
export const markAttendance = asyncHandler(async (req, res) => {
  const date = startOfDayUTC(req.body?.date ? new Date(req.body.date) : new Date());
  if (!date) throw ApiError.badRequest("That date could not be read. Use YYYY-MM-DD.");

  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  if (!entries.length) {
    throw ApiError.unprocessable("Send at least one attendance entry.", {
      entries: "Expected a non-empty array.",
    });
  }

  const course = req.body?.course ? await findCourseOr404(req.body.course) : null;

  const invalid = entries.filter(
    (entry) => !entry?.user || !ATTENDANCE_STATUSES.includes(entry.status),
  );
  if (invalid.length) {
    throw ApiError.unprocessable(
      `Every entry needs a user and a status of: ${ATTENDANCE_STATUSES.join(", ")}.`,
      { entries: `${invalid.length} entr${invalid.length === 1 ? "y is" : "ies are"} incomplete.` },
    );
  }

  const operations = entries.map((entry) => ({
    updateOne: {
      filter: { user: entry.user, date },
      update: {
        $set: {
          status: entry.status,
          note: clean(entry.note),
          recordedBy: req.admin._id,
          course: course?._id || null,
        },
        $setOnInsert: { user: entry.user, date, checkedInAt: new Date() },
      },
      upsert: true,
    },
  }));

  const result = await Attendance.bulkWrite(operations, { ordered: false });

  res.json({
    success: true,
    message: `Register saved for ${formatDisplayDate(date)}.`,
    date: date.toISOString().slice(0, 10),
    created: result.upsertedCount || 0,
    updated: result.modifiedCount || 0,
  });
});

/** GET /api/admin/students/:id/attendance — one student's full register. */
export const getStudentAttendance = asyncHandler(async (req, res) => {
  const student = await User.findById(req.params.id);
  if (!student) throw ApiError.notFound("That student could not be found.");

  const records = await Attendance.find({ user: student._id }).sort({ date: -1 }).limit(180);

  res.json({
    success: true,
    student: student.toPublicJSON(),
    summary: summariseRecords(records),
    records: records.map((record) => ({
      id: record._id,
      date: record.date.toISOString().slice(0, 10),
      dateLabel: formatDisplayDate(record.date),
      status: record.status,
      note: record.note || "",
      selfRecorded: !record.recordedBy,
    })),
  });
});

/* ------------------------------------------------------------ certificates -- */

/** GET /api/admin/certificates */
export const listAllCertificates = asyncHandler(async (req, res) => {
  const certificates = await Certificate.find({})
    .sort({ issuedAt: -1 })
    .populate("user", "firstName lastName studentId email")
    .populate("course", "code name");

  res.json({
    success: true,
    certificates: certificates.map((certificate) => ({
      ...certificate.toPublicJSON(),
      course: certificate.course
        ? { code: certificate.course.code, name: certificate.course.name }
        : null,
      student: certificate.user
        ? {
            id: certificate.user._id,
            name: [certificate.user.firstName, certificate.user.lastName].filter(Boolean).join(" "),
            studentId: certificate.user.studentId || null,
            email: certificate.user.email,
          }
        : null,
    })),
  });
});

/**
 * POST /api/admin/certificates
 * Body: { user, course, grade?, holderName? }
 *
 * Refuses to issue against an incomplete programme unless `force` is set. It is
 * a lot easier to add an override than to un-award a certificate that has already
 * been emailed to somebody.
 */
export const issueCertificate = asyncHandler(async (req, res) => {
  const student = req.body?.user ? await User.findById(req.body.user) : null;
  if (!student) throw ApiError.notFound("That student could not be found.");

  const course = await findCourseOr404(req.body?.course);

  const enrollment = await Enrollment.findOne({ user: student._id, course: course._id });
  if (!enrollment) {
    throw ApiError.conflict(`${student.firstName} is not enrolled on ${course.name}.`, {
      code: "NOT_ENROLLED",
    });
  }
  if (enrollment.status !== ENROLLMENT_STATUS.COMPLETED && !req.body?.force) {
    throw ApiError.conflict(
      `${student.firstName} has not completed ${course.name} yet. Send \`force: true\` to issue anyway.`,
      { code: "COURSEWORK_INCOMPLETE" },
    );
  }

  const existing = await Certificate.findOne({ user: student._id, course: course._id });
  if (existing) {
    return res.json({
      success: true,
      message: `${student.firstName} already holds ${existing.certificateNumber}.`,
      certificate: existing.toPublicJSON(),
    });
  }

  const certificate = await Certificate.create({
    certificateNumber: await generateCertificateNumber(),
    user: student._id,
    course: course._id,
    holderName:
      clean(req.body?.holderName) ||
      [student.firstName, student.lastName].filter(Boolean).join(" "),
    programme: course.name,
    grade: clean(req.body?.grade),
    issuedBy: req.admin._id,
  });

  res.status(201).json({
    success: true,
    message: `${certificate.certificateNumber} issued.`,
    certificate: certificate.toPublicJSON(),
  });
});

/** POST /api/admin/certificates/:id/revoke — Body: { reason } */
export const revokeCertificate = asyncHandler(async (req, res) => {
  const reason = clean(req.body?.reason);
  if (!reason) {
    throw ApiError.unprocessable("Record why the certificate is being revoked.", {
      reason: "A reason is required.",
    });
  }

  const certificate = await Certificate.findById(req.params.id);
  if (!certificate) throw ApiError.notFound("That certificate could not be found.");

  // Kept on file rather than deleted: public verification needs to be able to say
  // "this number exists but is no longer valid", which a missing row cannot.
  certificate.revoked = true;
  certificate.revokedReason = reason;
  await certificate.save();

  res.json({
    success: true,
    message: `${certificate.certificateNumber} revoked.`,
    certificate: certificate.toPublicJSON(),
  });
});

/** Kept for the enrollment-status filter used by the certificates screen. */
export const listCompletions = asyncHandler(async (req, res) => {
  const enrollments = await Enrollment.find({ status: ENROLLMENT_STATUS.COMPLETED })
    .sort({ completedAt: -1 })
    .populate("user", "firstName lastName studentId email")
    .populate("course", "code name");

  const certificates = await Certificate.find({
    user: { $in: enrollments.map((enrollment) => enrollment.user?._id).filter(Boolean) },
  }).select("user course certificateNumber");
  const issued = new Set(
    certificates.map((certificate) => `${certificate.user}:${certificate.course}`),
  );

  res.json({
    success: true,
    completions: enrollments
      .filter((enrollment) => enrollment.user && enrollment.course)
      .map((enrollment) => ({
        student: {
          id: enrollment.user._id,
          name: [enrollment.user.firstName, enrollment.user.lastName].filter(Boolean).join(" "),
          studentId: enrollment.user.studentId || null,
          email: enrollment.user.email,
        },
        course: { id: enrollment.course._id, code: enrollment.course.code, name: enrollment.course.name },
        completedAt: enrollment.completedAt || null,
        certificateIssued: issued.has(`${enrollment.user._id}:${enrollment.course._id}`),
      })),
  });
});
