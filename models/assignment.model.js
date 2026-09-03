import mongoose from "mongoose";
import fileRefSchema, { toFileJSON } from "./fileRef.schema.js";
import { formatDueDate, formatIsoDate, formatRelativeDue } from "../config/constants.js";

/**
 * Coursework, and the students' submissions against it.
 *
 * Both models live in one file because a submission has no meaning apart from its
 * assignment and the two are always reasoned about together.
 */

const assignmentSchema = new mongoose.Schema(
  {
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },
    lesson: { type: mongoose.Schema.Types.ObjectId, ref: "Lesson", default: null },

    title: { type: String, required: true, trim: true, maxlength: 200 },
    instructions: { type: String, trim: true, default: "", maxlength: 4000 },

    dueAt: { type: Date, required: true },
    maxScore: { type: Number, default: 100, min: 1 },
    published: { type: Boolean, default: true },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true },
);

assignmentSchema.index({ course: 1, dueAt: 1 });

/** Matches the "Upcoming assignments" card in UserDashboard.jsx. */
assignmentSchema.methods.toPublicJSON = function toPublicJSON(submission = null) {
  return {
    id: this._id,
    title: this.title,
    instructions: this.instructions,
    // "Due Fri, 27 Mar" and "In 4 days", exactly as the card renders them.
    dueLabel: `Due ${formatDueDate(this.dueAt)}`,
    dueRelative: formatRelativeDue(this.dueAt),
    dueDate: formatIsoDate(this.dueAt),
    dueAt: this.dueAt,
    maxScore: this.maxScore,
    submitted: Boolean(submission),
    submission: submission ? submission.toPublicJSON() : null,
  };
};

export const Assignment = mongoose.model("Assignment", assignmentSchema);

/* -------------------------------------------------------------- submissions -- */

const SUBMISSION_STATUS = { SUBMITTED: "Submitted", GRADED: "Graded" };

const submissionSchema = new mongoose.Schema(
  {
    assignment: { type: mongoose.Schema.Types.ObjectId, ref: "Assignment", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    text: { type: String, trim: true, default: "", maxlength: 20000 },
    attachment: { type: fileRefSchema, default: null },

    submittedAt: { type: Date, default: Date.now },
    /** True when submittedAt fell after the assignment's dueAt. */
    late: { type: Boolean, default: false },

    status: {
      type: String,
      enum: Object.values(SUBMISSION_STATUS),
      default: SUBMISSION_STATUS.SUBMITTED,
    },
    score: { type: Number, min: 0, default: null },
    feedback: { type: String, trim: true, default: "", maxlength: 2000 },
    gradedAt: { type: Date },
    gradedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
  },
  { timestamps: true },
);

// One submission per student per assignment; resubmitting updates it in place.
submissionSchema.index({ assignment: 1, user: 1 }, { unique: true });

submissionSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    text: this.text,
    attachment: toFileJSON(this.attachment),
    submittedAt: this.submittedAt,
    late: this.late,
    status: this.status,
    score: this.score,
    feedback: this.feedback || null,
    gradedAt: this.gradedAt || null,
  };
};

export const Submission = mongoose.model("Submission", submissionSchema);
export { SUBMISSION_STATUS };
