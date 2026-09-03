import mongoose from "mongoose";
import fileRefSchema, { toFileJSON } from "./fileRef.schema.js";
import {
  COURSE_FEE_NAIRA,
  PAYMENT_METHOD,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  PAYMENT_STATUSES,
  formatDisplayDate,
  formatNaira,
  shortProgrammeName,
} from "../config/constants.js";

/**
 * A registration-fee payment awaiting or having completed admin review.
 *
 * Created automatically when an application is submitted with a receipt
 * attached, then approved or rejected from admin/payments.
 *
 * `studentName` and `programme` are denormalised copies taken at submit time.
 * That's intentional: a receipt is a financial record, and it should keep
 * showing the name and programme it was reviewed under even if the student
 * later edits their profile.
 */
const paymentSchema = new mongoose.Schema(
  {
    paymentId: { type: String, required: true, unique: true, trim: true }, // "PAY-26041"
    receiptNumber: { type: String, required: true, unique: true, trim: true }, // "RCT-26041"

    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    application: { type: mongoose.Schema.Types.ObjectId, ref: "Application", required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", default: null },

    studentName: { type: String, required: true, trim: true },
    programme: { type: String, trim: true, default: "" },

    amount: { type: Number, required: true, min: 0, default: COURSE_FEE_NAIRA },
    currency: { type: String, default: "NGN" },
    method: { type: String, enum: PAYMENT_METHODS, default: PAYMENT_METHOD.BANK_TRANSFER },

    status: { type: String, enum: PAYMENT_STATUSES, default: PAYMENT_STATUS.PENDING },

    /** Date the student says they paid — drives the "Date paid" column. */
    paidAt: { type: Date, default: Date.now },
    receipt: { type: fileRefSchema, default: null },

    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    reviewNote: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

paymentSchema.index({ status: 1, createdAt: -1 });
paymentSchema.index({ user: 1, createdAt: -1 });

/**
 * The row shape admin/payments/page.jsx renders. `id` is the human reference
 * rather than the ObjectId because the table keys and selects on it.
 */
paymentSchema.methods.toAdminJSON = function toAdminJSON() {
  return {
    id: this.paymentId,
    receiptNumber: this.receiptNumber,
    name: this.studentName,
    programme: shortProgrammeName(this.programme),
    amount: formatNaira(this.amount),
    method: this.method,
    date: formatDisplayDate(this.paidAt),
    status: this.status,
    receipt: toFileJSON(this.receipt),
    reviewNote: this.reviewNote || null,
    // Raw values alongside the display strings, for sorting or CSV export.
    raw: {
      _id: this._id,
      amount: this.amount,
      currency: this.currency,
      paidAt: this.paidAt,
      reviewedAt: this.reviewedAt || null,
      user: this.user,
      application: this.application,
    },
  };
};

/** The row shape app/dashboard/user/payments/page.jsx renders. */
paymentSchema.methods.toStudentJSON = function toStudentJSON() {
  return {
    ref: this.paymentId,
    receiptNumber: this.receiptNumber,
    name: this.studentName,
    course: this.programme || "—",
    amount: formatNaira(this.amount),
    method: this.method,
    receiptName: this.receipt?.filename || "Payment receipt",
    status: this.status,
    date: formatDisplayDate(this.paidAt),
    reviewNote: this.reviewNote || null,
    receipt: toFileJSON(this.receipt),
  };
};

export default mongoose.model("Payment", paymentSchema);
