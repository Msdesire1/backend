/**
 * The admin overview: everything app/dashboard/admin/page.jsx renders, in one
 * request, plus the student roster behind the admin tables.
 *
 * The heavy lifting lives in services/stats.service.js — this file only shapes
 * the response.
 */
import asyncHandler from "../utils/asyncHandler.js";
import {
  getKpis,
  getNotifications,
  getQueueCounts,
  getRecentPayments,
  getRecentRegistrations,
  getStudentRoster,
  getTotalLearners,
  getUpcomingClasses,
} from "../services/stats.service.js";
import { CURRENT_INTAKE } from "../config/constants.js";

/** Clamp pagination input so a stray `?limit=100000` cannot sink the database. */
const parsePaging = (query = {}) => {
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 25, 1), 100);
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  return { limit, page, skip: (page - 1) * limit };
};

/** GET /api/admin/overview */
export const getAdminOverview = asyncHandler(async (req, res) => {
  const [kpis, totalLearners, recentRegistrations, recentPayments, notifications, queues] =
    await Promise.all([
      getKpis(),
      getTotalLearners(),
      getRecentRegistrations(5),
      getRecentPayments(5),
      getNotifications(6),
      getQueueCounts(),
    ]);

  res.json({
    success: true,
    admin: req.admin.toPublicJSON(),
    intake: CURRENT_INTAKE,
    hero: {
      eyebrow: "Admin dashboard",
      title: "WOFBI admissions & learning operations",
      totalLearners: totalLearners.display,
      totalLearnersCount: totalLearners.count,
      totalLearnersCaption: "Active enrolments across all programmes",
    },
    kpis,
    recentRegistrations,
    // "3 new records" — the green chip beside the admissions table heading.
    recentRegistrationsLabel: `${recentRegistrations.length} new record${
      recentRegistrations.length === 1 ? "" : "s"
    }`,
    recentPayments,
    upcomingClasses: getUpcomingClasses(3),
    notifications,
    queues,
  });
});

/** GET /api/admin/students */
export const listStudents = asyncHandler(async (req, res) => {
  const { limit, page, skip } = parsePaging(req.query);
  const { students, total } = await getStudentRoster({
    search: String(req.query.search || "").trim(),
    limit,
    skip,
  });

  res.json({
    success: true,
    students,
    pagination: { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) },
  });
});

export { parsePaging };
