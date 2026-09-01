/**
 * Student attendance: the "94%" card on the dashboard, the register behind it,
 * and daily check-in.
 *
 * Administrators can amend any record (admin.controller.js); a student can only
 * mark themselves present for today, and only once.
 */
import Attendance, { startOfDayUTC } from "../models/attendance.model.js";
import Enrollment from "../models/enrollment.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import {
  ATTENDANCE_STATUS,
  CLASS_SCHEDULE,
  ENROLLMENT_STATUS,
  formatDisplayDate,
} from "../config/constants.js";
import {
  findTodaysAttendance,
  getAttendanceSummary,
  getRecentAttendance,
} from "../services/attendance.service.js";

/** GET /api/attendance/me */
export const getMyAttendance = asyncHandler(async (req, res) => {
  const [summary, records, today] = await Promise.all([
    getAttendanceSummary(req.user._id),
    getRecentAttendance(req.user._id),
    findTodaysAttendance(req.user._id),
  ]);

  res.json({
    success: true,
    summary,
    records,
    today: today
      ? { status: today.status, checkedInAt: today.checkedInAt, dateLabel: formatDisplayDate(today.date) }
      : null,
    checkedIn: Boolean(today),
    schedule: {
      ...CLASS_SCHEDULE,
      timeRange: `${CLASS_SCHEDULE.startTime} – ${CLASS_SCHEDULE.endTime}`,
    },
  });
});

/**
 * POST /api/attendance/me/check-in
 *
 * Idempotent by design — the unique index on (user, date) with the date
 * normalised to UTC midnight means a double tap cannot create a second record,
 * and this handler reports the existing one instead of failing.
 */
export const checkIn = asyncHandler(async (req, res) => {
  const enrollment = await Enrollment.findOne({
    user: req.user._id,
    status: ENROLLMENT_STATUS.ACTIVE,
  });
  if (!enrollment) {
    throw ApiError.forbidden(
      "You need an active course enrollment before you can check in to class.",
      { code: "NOT_ENROLLED" },
    );
  }

  const existing = await findTodaysAttendance(req.user._id);
  if (existing) {
    return res.json({
      success: true,
      message: "You are already checked in for today.",
      checkedIn: true,
      attendance: { status: existing.status, checkedInAt: existing.checkedInAt },
      summary: await getAttendanceSummary(req.user._id),
    });
  }

  const attendance = await Attendance.create({
    user: req.user._id,
    course: enrollment.course,
    date: startOfDayUTC(new Date()),
    status: ATTENDANCE_STATUS.PRESENT,
    checkedInAt: new Date(),
  });

  res.status(201).json({
    success: true,
    message: "You are checked in. Have a great class.",
    checkedIn: true,
    attendance: { status: attendance.status, checkedInAt: attendance.checkedInAt },
    summary: await getAttendanceSummary(req.user._id),
  });
});
