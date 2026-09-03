/**
 * Everything under /api/admin.
 *
 * The guard order matters and is deliberate:
 *
 *   /auth/login          — open, rate limited
 *   everything else      — requireAdmin
 *   /admins/*            — requireAdmin + requireAdminRole("super_admin")
 *
 * `requireAdmin` verifies against ADMIN_JWT_SECRET and looks the account up in the
 * Admin collection, so a student token cannot reach any of this no matter how it
 * is presented.
 */
import { Router } from "express";
import { requireAdmin, requireAdminRole } from "../middleware/auth.middleware.js";
import { loginLimiter } from "../middleware/rateLimit.middleware.js";
import { ADMIN_ROLE } from "../config/constants.js";

import {
  adminLogin,
  changeAdminPassword,
  createAdmin,
  getCurrentAdmin,
  listAdmins,
} from "../controllers/admin.auth.controller.js";
import { getAdminOverview, listStudents } from "../controllers/admin.controller.js";
import {
  decideApplication,
  decidePayment,
  getApplicationDetail,
  getPaymentDetail,
  listApplications,
  listPayments,
} from "../controllers/admin.review.controller.js";
import {
  createAssignment,
  createCourse,
  createLesson,
  gradeSubmission,
  listAllCourses,
  listAllLessons,
  listCourseAssignments,
  listSubmissions,
  retireLesson,
  updateAssignment,
  updateCourse,
  updateLesson,
} from "../controllers/admin.content.controller.js";
import {
  createAnnouncement,
  getAttendanceRegister,
  getStudentAttendance,
  issueCertificate,
  listAllAnnouncements,
  listAllCertificates,
  listCompletions,
  markAttendance,
  retireAnnouncement,
  revokeCertificate,
  updateAnnouncement,
} from "../controllers/admin.records.controller.js";

const router = Router();

/* ---------------------------------------------------------------- open --- */

router.post("/auth/login", loginLimiter, adminLogin);

/* ------------------------------------------------------ authenticated --- */

router.use(requireAdmin);

router.get("/auth/me", getCurrentAdmin);
router.post("/auth/change-password", changeAdminPassword);

router.get("/overview", getAdminOverview);

// Admissions
router.get("/applications", listApplications);
router.get("/applications/:id", getApplicationDetail);
router.post("/applications/:id/decision", decideApplication);

// Payments
router.get("/payments", listPayments);
router.get("/payments/:id", getPaymentDetail);
router.post("/payments/:id/decision", decidePayment);

// Students. "/students/:id/attendance" is declared alongside the list rather than
// in the attendance block below so all the student-scoped paths stay together.
router.get("/students", listStudents);
router.get("/students/:id/attendance", getStudentAttendance);

// Courses and lessons
router.get("/courses", listAllCourses);
router.post("/courses", createCourse);
router.patch("/courses/:code", updateCourse);
router.get("/courses/:code/lessons", listAllLessons);
router.post("/courses/:code/lessons", createLesson);
router.patch("/lessons/:id", updateLesson);
router.delete("/lessons/:id", retireLesson);

// Coursework
router.get("/courses/:code/assignments", listCourseAssignments);
router.post("/courses/:code/assignments", createAssignment);
router.patch("/assignments/:id", updateAssignment);
router.get("/assignments/:id/submissions", listSubmissions);
router.post("/submissions/:id/grade", gradeSubmission);

// Announcements
router.get("/announcements", listAllAnnouncements);
router.post("/announcements", createAnnouncement);
router.patch("/announcements/:id", updateAnnouncement);
router.delete("/announcements/:id", retireAnnouncement);

// Attendance
router.get("/attendance", getAttendanceRegister);
router.post("/attendance", markAttendance);

// Certificates
router.get("/certificates", listAllCertificates);
router.post("/certificates", issueCertificate);
router.post("/certificates/:id/revoke", revokeCertificate);
router.get("/completions", listCompletions);

/* ----------------------------------------------------- super admin only --- */

router.get("/admins", requireAdminRole(ADMIN_ROLE.SUPER_ADMIN), listAdmins);
router.post("/admins", requireAdminRole(ADMIN_ROLE.SUPER_ADMIN), createAdmin);

export default router;
