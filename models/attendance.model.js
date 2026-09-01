import mongoose from "mongoose";
import { ATTENDANCE_STATUS, ATTENDANCE_STATUSES } from "../config/constants.js";

/**
 * One attendance record per student per class day — the source of the "94%"
 * attendance figure on the student dashboard and the attendance-rate KPI.
 *
 * `date` is normalised to UTC midnight so the unique index actually prevents
 * duplicate check-ins: without normalising, two check-ins on the same day at
 * different clock times would be two distinct values and both would be stored.
 */

/** Strips the time component so a day is a single comparable value. */
export const startOfDayUTC = (value = new Date()) => {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const attendanceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", default: null },

    date: { type: Date, required: true, set: startOfDayUTC },
    status: { type: String, enum: ATTENDANCE_STATUSES, default: ATTENDANCE_STATUS.PRESENT },

    checkedInAt: { type: Date, default: Date.now },
    /** Set when an admin records or amends the entry on the student's behalf. */
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    note: { type: String, trim: true, maxlength: 300, default: "" },
  },
  { timestamps: true },
);

attendanceSchema.index({ user: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: -1 });

export default mongoose.model("Attendance", attendanceSchema);
