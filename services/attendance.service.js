/**
 * Attendance arithmetic, kept in one place so the student's "94%" card and the
 * admin's "Attendance rate" KPI can never disagree.
 *
 * Excused absences count as attended. That is a policy decision, not an accident:
 * a student with a signed excuse should not be penalised in the same figure used
 * to judge their standing. Change the `ATTENDED` set below if the institute
 * decides otherwise.
 */
import Attendance, { startOfDayUTC } from "../models/attendance.model.js";
import { ATTENDANCE_STATUS, formatDisplayDate } from "../config/constants.js";

const ATTENDED = new Set([ATTENDANCE_STATUS.PRESENT, ATTENDANCE_STATUS.EXCUSED]);

const summarise = (counts) => {
  const present = counts[ATTENDANCE_STATUS.PRESENT] || 0;
  const absent = counts[ATTENDANCE_STATUS.ABSENT] || 0;
  const excused = counts[ATTENDANCE_STATUS.EXCUSED] || 0;
  const total = present + absent + excused;
  const attended = present + excused;
  const rate = total ? Math.round((attended / total) * 100) : 0;

  return {
    present,
    absent,
    excused,
    total,
    rate,
    // The dashboard card shows a bare percentage; "—" reads better than "0%" when
    // no class has been held yet.
    rateLabel: total ? `${rate}%` : "—",
  };
};

const countsFrom = (rows) =>
  rows.reduce((accumulator, row) => {
    accumulator[row._id] = row.count;
    return accumulator;
  }, {});

/** One student's attendance figures. */
export const getAttendanceSummary = async (userId) => {
  const rows = await Attendance.aggregate([
    { $match: { user: userId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]);
  return summarise(countsFrom(rows));
};

/** The whole institute's rate — the admin dashboard KPI. */
export const getInstituteAttendanceRate = async () => {
  const rows = await Attendance.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  return summarise(countsFrom(rows));
};

/** A student's recent class days, newest first, ready to render. */
export const getRecentAttendance = async (userId, limit = 30) => {
  const records = await Attendance.find({ user: userId })
    .sort({ date: -1 })
    .limit(limit)
    .populate("course", "code name");

  return records.map((record) => ({
    id: record._id,
    date: record.date,
    dateLabel: formatDisplayDate(record.date),
    status: record.status,
    course: record.course ? { code: record.course.code, name: record.course.name } : null,
    note: record.note || null,
    checkedInAt: record.checkedInAt,
  }));
};

/** Today's record, if the student has already been marked. */
export const findTodaysAttendance = (userId) =>
  Attendance.findOne({ user: userId, date: startOfDayUTC(new Date()) });

/**
 * The same figures from documents that are already in memory.
 *
 * The admin register loads every record for a day in order to render it, so
 * re-running an aggregation over the same rows just to count them would be a
 * second round trip for information it is already holding.
 */
export const summariseRecords = (records = []) =>
  summarise(
    records.reduce((accumulator, record) => {
      accumulator[record.status] = (accumulator[record.status] || 0) + 1;
      return accumulator;
    }, {}),
  );

export { ATTENDED as ATTENDED_STATUSES, summarise as summariseCounts };
