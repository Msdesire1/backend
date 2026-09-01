/**
 * The numbers behind app/dashboard/admin/page.jsx.
 *
 * Everything here is computed from the collections on demand. There is no
 * pre-aggregated stats document to fall out of date, which matters more than the
 * saved milliseconds at this size — the institute has hundreds of students, not
 * millions, and an admin looking at a "Pending payments" count needs it to be
 * true right now rather than true as of the last cron run.
 */
import mongoose from "mongoose";
import Application from "../models/application.model.js";
import Payment from "../models/payment.model.js";
import Course from "../models/course.model.js";
import Enrollment from "../models/enrollment.model.js";
import Certificate from "../models/certificate.model.js";
import User from "../models/user.model.js";
import { getInstituteAttendanceRate } from "./attendance.service.js";
import {
  APPLICATION_STATUS,
  CLASS_SCHEDULE,
  ENROLLMENT_STATUS,
  PAYMENT_STATUS,
  formatCompactNaira,
  formatTimeAgo,
  toLocalIsoDate,
} from "../config/constants.js";

/** First instant of the month `monthsAgo` months back, in local time. */
const startOfMonth = (monthsAgo = 0) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
};

/**
 * "+12.5%" / "-4.0%" — the small grey line under each KPI.
 *
 * Growing from zero has no meaningful percentage, so those cases fall back to a
 * plain count. "+100.0%" from a base of one applicant would be true but useless.
 */
export const deltaLabel = (current, previous, { suffix = "%" } = {}) => {
  if (!previous) {
    if (!current) return "No change this month";
    return `+${current} this month`;
  }
  const change = ((current - previous) / previous) * 100;
  const sign = change > 0 ? "+" : change < 0 ? "-" : "";
  return `${sign}${Math.abs(change).toFixed(1)}${suffix}`;
};

/** "1,246" — thousands-separated, the way the hero card prints it. */
export const formatCount = (value) => Number(value || 0).toLocaleString("en-NG");

const countInMonth = (Model, dateField, monthsAgo, extra = {}) =>
  Model.countDocuments({
    ...extra,
    [dateField]: { $gte: startOfMonth(monthsAgo), $lt: startOfMonth(monthsAgo - 1) },
  });

/** Sum of every approved payment, optionally limited to one month. */
const sumApprovedPayments = async (match = {}) => {
  const [row] = await Payment.aggregate([
    { $match: { status: PAYMENT_STATUS.APPROVED, ...match } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);
  return row?.total || 0;
};

/**
 * The eight KPI cards, in the order admin/page.jsx lays them out, each with the
 * display `value` and `detail` strings it renders plus the raw number behind them.
 */
export const getKpis = async () => {
  const submitted = { status: { $ne: APPLICATION_STATUS.DRAFT } };

  const [
    totalApplications,
    applicationsThisMonth,
    applicationsLastMonth,
    approvedStudents,
    approvedThisMonth,
    approvedLastMonth,
    activeStudentIds,
    activeCourses,
    coursesThisMonth,
    lecturerNames,
    revenue,
    revenueThisMonth,
    revenueLastMonth,
    attendanceRate,
    certificates,
    certificatesThisMonth,
  ] = await Promise.all([
    Application.countDocuments(submitted),
    countInMonth(Application, "submittedAt", 0, submitted),
    countInMonth(Application, "submittedAt", 1, submitted),
    Application.countDocuments({ status: APPLICATION_STATUS.APPROVED }),
    countInMonth(Application, "reviewedAt", 0, { status: APPLICATION_STATUS.APPROVED }),
    countInMonth(Application, "reviewedAt", 1, { status: APPLICATION_STATUS.APPROVED }),
    Enrollment.distinct("user", { status: ENROLLMENT_STATUS.ACTIVE }),
    Course.countDocuments({ active: true }),
    countInMonth(Course, "createdAt", 0, { active: true }),
    Course.distinct("lecturer.name", { active: true, "lecturer.name": { $nin: ["", null] } }),
    sumApprovedPayments(),
    sumApprovedPayments({ reviewedAt: { $gte: startOfMonth(0) } }),
    sumApprovedPayments({ reviewedAt: { $gte: startOfMonth(1), $lt: startOfMonth(0) } }),
    getInstituteAttendanceRate(),
    Certificate.countDocuments({}),
    countInMonth(Certificate, "issuedAt", 0),
  ]);

  return [
    {
      label: "Total applications",
      value: formatCount(totalApplications),
      detail: deltaLabel(applicationsThisMonth, applicationsLastMonth),
      raw: totalApplications,
    },
    {
      label: "Approved students",
      value: formatCount(approvedStudents),
      detail: deltaLabel(approvedThisMonth, approvedLastMonth),
      raw: approvedStudents,
    },
    {
      label: "Active students",
      value: formatCount(activeStudentIds.length),
      detail: "Enrolled on at least one course",
      raw: activeStudentIds.length,
    },
    {
      label: "Active courses",
      value: formatCount(activeCourses),
      detail: coursesThisMonth ? `+${coursesThisMonth} new` : "No new courses this month",
      raw: activeCourses,
    },
    {
      label: "Lecturers",
      value: formatCount(lecturerNames.length),
      detail: `Across ${activeCourses} active course${activeCourses === 1 ? "" : "s"}`,
      raw: lecturerNames.length,
    },
    {
      label: "Revenue",
      value: formatCompactNaira(revenue),
      detail: deltaLabel(revenueThisMonth, revenueLastMonth),
      raw: revenue,
    },
    {
      label: "Attendance rate",
      value: attendanceRate.rateLabel,
      detail: `${formatCount(attendanceRate.total)} records logged`,
      raw: attendanceRate.rate,
    },
    {
      label: "Certificates issued",
      value: formatCount(certificates),
      detail: certificatesThisMonth ? `+${certificatesThisMonth}` : "None issued this month",
      raw: certificates,
    },
  ];
};

/** The "Total learners" figure in the dark hero card. */
export const getTotalLearners = async () => {
  const ids = await Enrollment.distinct("user", {
    status: { $in: [ENROLLMENT_STATUS.ACTIVE, ENROLLMENT_STATUS.COMPLETED] },
  });
  return { count: ids.length, display: formatCount(ids.length) };
};

/** The "Admissions activity" table — newest submissions first, with payment state. */
export const getRecentRegistrations = async (limit = 5) => {
  const applications = await Application.find({ status: { $ne: APPLICATION_STATUS.DRAFT } })
    .sort({ submittedAt: -1, createdAt: -1 })
    .limit(limit);

  const payments = await Payment.find({
    application: { $in: applications.map((application) => application._id) },
  });
  const byApplication = new Map(payments.map((payment) => [String(payment.application), payment]));

  return applications.map((application) =>
    application.toAdminJSON(byApplication.get(String(application._id)) || null),
  );
};

/** The "Recent payments" list. */
export const getRecentPayments = async (limit = 5) => {
  const payments = await Payment.find({}).sort({ createdAt: -1 }).limit(limit);
  return payments.map((payment) => payment.toAdminJSON());
};

/**
 * The next few class sessions.
 *
 * WOFBI runs one recurring timetable rather than a calendar of one-off events, so
 * these are projected forward from CLASS_SCHEDULE instead of read from a table.
 * When the institute starts scheduling individual sessions this is the one place
 * that needs to change.
 */
export const getUpcomingClasses = (count = 3) => {
  const rows = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  while (rows.length < count) {
    cursor.setDate(cursor.getDate() + 1);
    const weekday = cursor.getDay();
    if (weekday === 0 || weekday === 6) continue; // "Monday-Friday"
    rows.push({
      date: cursor.toLocaleDateString("en-GB", { weekday: "short", month: "short", day: "2-digit" }),
      isoDate: toLocalIsoDate(cursor),
      title: CLASS_SCHEDULE.title,
      venue: CLASS_SCHEDULE.venue,
      timeRange: `${CLASS_SCHEDULE.startTime} – ${CLASS_SCHEDULE.endTime}`,
    });
  }
  return rows;
};

/**
 * The notification feed. These are derived from the things an admin actually has
 * to act on — a new submission, an unreviewed receipt, an approved student with
 * no certificate yet — rather than stored as their own documents. Nothing can
 * drift out of sync with reality that way, and nothing needs cleaning up.
 */
export const getNotifications = async (limit = 6) => {
  const [newApplications, pendingPayments] = await Promise.all([
    Application.find({ status: APPLICATION_STATUS.REVIEW })
      .sort({ submittedAt: -1 })
      .limit(limit)
      .select("applicationId submittedAt form.firstName form.lastName"),
    Payment.find({ status: PAYMENT_STATUS.PENDING })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("paymentId studentName createdAt application"),
  ]);

  const items = [
    ...newApplications.map((application) => ({
      title: "New application received",
      detail: `${application.form?.firstName || ""} ${application.form?.lastName || ""}`.trim(),
      reference: application.applicationId,
      at: application.submittedAt || application.createdAt,
      href: "/dashboard/admin/admissions",
    })),
    ...pendingPayments.map((payment) => ({
      title: `Payment pending for ${payment.paymentId}`,
      detail: payment.studentName,
      reference: payment.paymentId,
      at: payment.createdAt,
      href: "/dashboard/admin/payments",
    })),
  ];

  return items
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limit)
    .map((item) => ({ ...item, timeLabel: formatTimeAgo(item.at) }));
};

/** Per-status counts for the admissions and payments queue chips. */
export const getQueueCounts = async () => {
  const [applications, payments] = await Promise.all([
    Application.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    Payment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  const toMap = (rows, statuses) => {
    const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
    for (const row of rows) if (row._id in counts) counts[row._id] = row.count;
    return counts;
  };

  return {
    applications: toMap(applications, Object.values(APPLICATION_STATUS)),
    payments: toMap(payments, Object.values(PAYMENT_STATUS)),
  };
};

/** A quick student roster for the admin students table. */
export const getStudentRoster = async ({ search = "", limit = 25, skip = 0 } = {}) => {
  const filter = {};
  if (search) {
    const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    filter.$or = [
      { firstName: pattern },
      { lastName: pattern },
      { email: pattern },
      { studentId: pattern },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(filter),
  ]);

  const enrollments = await Enrollment.find({ user: { $in: users.map((user) => user._id) } })
    .populate("course", "code name")
    .select("user course status");
  const byUser = new Map();
  for (const enrollment of enrollments) {
    const key = String(enrollment.user);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key).push(enrollment);
  }

  return {
    total,
    students: users.map((user) => ({
      ...user.toPublicJSON(),
      courses: (byUser.get(String(user._id)) || []).map((enrollment) => ({
        code: enrollment.course?.code || "",
        name: enrollment.course?.name || "",
        status: enrollment.status,
      })),
    })),
  };
};

/** Shared by the admin detail endpoints — accepts an ObjectId or a reference. */
export const byIdOrReference = (value, referenceField) => {
  const trimmed = String(value || "").trim();
  if (mongoose.Types.ObjectId.isValid(trimmed) && String(new mongoose.Types.ObjectId(trimmed)) === trimmed) {
    return { _id: trimmed };
  }
  return { [referenceField]: trimmed.toUpperCase() };
};
