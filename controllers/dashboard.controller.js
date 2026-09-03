/**
 * One request that answers everything the student dashboard shows.
 *
 * app/dashboard/user/_components/UserDashboard.jsx and
 * app/dashboard/user/overview/page.jsx currently hardcode roughly forty separate
 * strings between them. Serving those from four or five endpoints would mean the
 * dashboard flickering into place a card at a time, so this returns the whole
 * page in a single round trip — with the display strings pre-formatted to match
 * what those components already render, down to the "·" separators.
 *
 * The field-by-field mapping is documented in API_INTEGRATION.md.
 */
import Application from "../models/application.model.js";
import Payment from "../models/payment.model.js";
import Certificate from "../models/certificate.model.js";
import Enrollment from "../models/enrollment.model.js";
import { Assignment, Submission } from "../models/assignment.model.js";
import { Announcement, AnnouncementRead, ANNOUNCEMENT_AUDIENCE } from "../models/announcement.model.js";
import asyncHandler from "../utils/asyncHandler.js";
import { findTodaysAttendance, getAttendanceSummary } from "../services/attendance.service.js";
import {
  buildProgress,
  getCohortSize,
  listLessons,
  resolveNextLesson,
} from "../services/course.service.js";
import {
  APPLICATION_STATUS,
  BANK_DETAILS,
  CLASS_SCHEDULE,
  COURSE_FEE_NAIRA,
  CURRENT_INTAKE,
  ENROLLMENT_STATUS,
  MILESTONE_NAMES,
  PAYMENT_STATUS,
  formatDisplayDate,
  formatNaira,
} from "../config/constants.js";

/** The four milestones on the overview page, in order, with their state. */
const buildMilestones = ({ application, payment, enrollments, certificates }) => {
  const submitted = Boolean(application) && application.status !== APPLICATION_STATUS.DRAFT;
  const paid = payment?.status === PAYMENT_STATUS.APPROVED;
  const courseworkDone =
    enrollments.length > 0 &&
    enrollments.every((enrollment) => enrollment.status === ENROLLMENT_STATUS.COMPLETED);
  const graduated = certificates.length > 0;

  return MILESTONE_NAMES.map((name, index) => ({
    name,
    complete: [submitted, paid, courseworkDone, graduated][index],
  }));
};

/** The words the "Payment status" stat card shows. */
const paymentStatusLabel = (payment) => {
  if (!payment) return "Not paid";
  if (payment.status === PAYMENT_STATUS.APPROVED) return "Paid in full";
  if (payment.status === PAYMENT_STATUS.REJECTED) return "Receipt rejected";
  return "Awaiting confirmation";
};

/**
 * What the applicant should do next, so the hero button can say something true.
 * The frontend's own copy is "Continue Registration".
 */
const nextAction = (application, payment) => {
  if (!application || application.status === APPLICATION_STATUS.DRAFT) {
    return {
      label: "Continue Registration",
      href: "/dashboard/user/new",
      hint: "Finish your application to secure your place.",
    };
  }
  if (application.status === APPLICATION_STATUS.REQUEST_INFO) {
    return {
      label: "Update your application",
      href: "/dashboard/user/new",
      hint: application.reviewNote || "The admissions team has asked for more information.",
    };
  }
  if (payment?.status === PAYMENT_STATUS.REJECTED) {
    return {
      label: "Upload a new receipt",
      href: "/dashboard/user/payments",
      hint: payment.reviewNote || "We could not confirm your payment receipt.",
    };
  }
  if (application.status === APPLICATION_STATUS.REVIEW) {
    return {
      label: "View your application",
      href: "/dashboard/user/new",
      hint: "Your application is with the admissions team.",
    };
  }
  return {
    label: "Continue learning",
    href: "/dashboard/user/overview",
    hint: "Pick up where you left off.",
  };
};

/** GET /api/dashboard */
export const getStudentDashboard = asyncHandler(async (req, res) => {
  const user = req.user;

  const [application, payment, enrollments, certificates, attendanceSummary, todaysAttendance] =
    await Promise.all([
      Application.findOne({ user: user._id }),
      Payment.findOne({ user: user._id }).sort({ createdAt: -1 }),
      Enrollment.find({ user: user._id }).populate("course"),
      Certificate.find({ user: user._id }).sort({ issuedAt: -1 }).populate("course", "code name"),
      getAttendanceSummary(user._id),
      findTodaysAttendance(user._id),
    ]);

  /**
   * Today's check-in state travels with the summary. Without it the dashboard
   * would have to call /api/attendance/me as well just to decide whether the
   * check-in button should be disabled — and the whole point of this endpoint is
   * that it needs one call.
   *
   * `checkedIn` and `today` are the same shape /api/attendance/me returns, so a
   * component can read either payload without a second code path.
   */
  const attendance = {
    ...attendanceSummary,
    checkedIn: Boolean(todaysAttendance),
    today: todaysAttendance
      ? {
          status: todaysAttendance.status,
          checkedInAt: todaysAttendance.checkedInAt,
          dateLabel: formatDisplayDate(todaysAttendance.date),
        }
      : null,
  };

  /* ------------------------------------------------- the featured programme -- */

  const active = enrollments
    .filter((enrollment) => enrollment.status === ENROLLMENT_STATUS.ACTIVE)
    .sort((a, b) => new Date(b.lastActiveAt || 0) - new Date(a.lastActiveAt || 0));
  const primary = active[0] || enrollments[0] || null;

  const lessons = primary?.course ? await listLessons(primary.course._id) : [];
  const progress = buildProgress(primary, lessons);

  // "Resume" should return to the lesson the student last opened; if they have
  // finished it, move them on to the first one they have not.
  const lastLesson = primary?.lastLesson
    ? lessons.find((lesson) => String(lesson._id) === String(primary.lastLesson)) || null
    : null;
  const nextLesson =
    lastLesson && !primary.hasCompleted(lastLesson._id)
      ? lastLesson
      : resolveNextLesson(primary, lessons);

  const continueLearning =
    primary && primary.course
      ? {
          courseCode: primary.course.code,
          courseName: primary.course.name,
          // "Foundations of Faith" — the module heading above the course name.
          moduleTitle: nextLesson?.moduleTitle || primary.course.name,
          moduleLabel: nextLesson?.moduleNumber ? `Module ${nextLesson.moduleNumber}` : null,
          // "Basic Certificate Course · Module 2"
          courseModuleLine: nextLesson?.moduleNumber
            ? `${primary.course.name} · Module ${nextLesson.moduleNumber}`
            : primary.course.name,
          // "with Pst. Michael Adebayo · Basic Certificate Course"
          lecturerLine: (() => {
            const lecturer = nextLesson?.lecturer || primary.course.lecturer?.name || "";
            return lecturer
              ? `with ${lecturer} · ${primary.course.name}`
              : primary.course.name;
          })(),
          statusBadge:
            primary.status === ENROLLMENT_STATUS.COMPLETED ? "Completed" : "In progress",
          progress,
          nextLesson: nextLesson
            ? {
                ...nextLesson.toPublicJSON(),
                // "NEXT LESSON · 09" and "24 min · Video lesson"
                headingLabel: `NEXT LESSON · ${String(nextLesson.number).padStart(2, "0")}`,
                lessonBadge: `Lesson ${nextLesson.number}`,
                metaLine: [
                  nextLesson.durationMinutes ? `${nextLesson.durationMinutes} min` : null,
                  nextLesson.type,
                ]
                  .filter(Boolean)
                  .join(" · "),
                href: "/dashboard/user/overview",
              }
            : null,
          cohortSize: await getCohortSize(primary.course._id, primary.intake?.code),
          cohortLabel: "",
        }
      : null;

  if (continueLearning) {
    const size = continueLearning.cohortSize;
    continueLearning.cohortLabel = `${size} learner${size === 1 ? "" : "s"} in your cohort`;
  }

  /* -------------------------------------------------------------- reminders -- */

  const courseIds = enrollments.map((enrollment) => enrollment.course?._id).filter(Boolean);

  const assignments = courseIds.length
    ? await Assignment.find({
        course: { $in: courseIds },
        published: true,
        dueAt: { $gte: new Date() },
      })
        .sort({ dueAt: 1 })
        .limit(5)
    : [];

  const submissions = assignments.length
    ? await Submission.find({
        user: user._id,
        assignment: { $in: assignments.map((assignment) => assignment._id) },
      })
    : [];
  const submissionByAssignment = new Map(
    submissions.map((submission) => [String(submission.assignment), submission]),
  );

  const announcementFilter = {
    active: true,
    publishedAt: { $lte: new Date() },
    $or: [
      { audience: { $in: [ANNOUNCEMENT_AUDIENCE.ALL, ANNOUNCEMENT_AUDIENCE.STUDENTS] } },
      { audience: ANNOUNCEMENT_AUDIENCE.COURSE, course: { $in: courseIds } },
    ],
  };
  const announcements = await Announcement.find(announcementFilter)
    .sort({ publishedAt: -1 })
    .limit(5);
  const reads = await AnnouncementRead.find({
    user: user._id,
    announcement: { $in: announcements.map((announcement) => announcement._id) },
  }).select("announcement");
  const readIds = new Set(reads.map((read) => String(read.announcement)));
  const announcementRows = announcements.map((announcement) =>
    announcement.toPublicJSON({ read: readIds.has(String(announcement._id)) }),
  );
  const unreadCount = announcementRows.filter((row) => !row.read).length;

  /* ------------------------------------------------------------ the payload -- */

  const intakeLabel = user.intake?.label || CURRENT_INTAKE.label;
  const enrolledCodes = enrollments.map((enrollment) => enrollment.course?.code).filter(Boolean);
  // "Spring 2026 intake · BCC,LCC" — the exact separator the hero badge uses.
  const intakeBadge = enrolledCodes.length
    ? `${intakeLabel} intake · ${enrolledCodes.join(",")}`
    : `${intakeLabel} intake`;

  res.json({
    success: true,
    student: {
      id: user._id,
      firstName: user.firstName,
      fullName: [user.firstName, user.lastName].filter(Boolean).join(" "),
      studentId: user.studentId || null,
      intakeLabel,
      intakeBadge,
      greeting: `Welcome to wofbi online registration, ${user.firstName}.`,
      registrationComplete: user.registrationComplete,
    },

    // The four cards across the top, in the order the component lays them out.
    stats: [
      { label: "Student ID", value: user.studentId || "Pending" },
      { label: "Attendance", value: attendance.rateLabel },
      { label: "Payment status", value: paymentStatusLabel(payment) },
      { label: "Class of", value: intakeLabel },
    ],

    milestones: buildMilestones({ application, payment, enrollments, certificates }),
    nextAction: nextAction(application, payment),

    progress,
    continueLearning,

    classSchedule: {
      ...CLASS_SCHEDULE,
      timeRange: `${CLASS_SCHEDULE.startTime} – ${CLASS_SCHEDULE.endTime}`,
    },

    assignments: assignments.map((assignment) =>
      assignment.toPublicJSON(submissionByAssignment.get(String(assignment._id)) || null),
    ),

    announcements: {
      items: announcementRows,
      latest: announcementRows[0] || null,
      unreadCount,
      unreadLabel: `${unreadCount} new`,
    },

    attendance,

    payment: payment ? payment.toStudentJSON() : null,
    fee: { amount: COURSE_FEE_NAIRA, display: formatNaira(COURSE_FEE_NAIRA) },
    bank: { ...BANK_DETAILS, amountDisplay: formatNaira(BANK_DETAILS.amount) },

    application: application
      ? {
          id: application._id,
          applicationId: application.applicationId,
          status: application.status,
          furthestStep: application.furthestStep,
          reviewNote: application.reviewNote || null,
          submittedAt: application.submittedAt || null,
        }
      : { status: APPLICATION_STATUS.DRAFT, furthestStep: 0, applicationId: null },

    certificates: certificates.map((certificate) => certificate.toPublicJSON()),
  });
});
