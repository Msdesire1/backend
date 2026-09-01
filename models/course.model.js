import mongoose from "mongoose";
import { COURSE_FEE_NAIRA, formatNaira } from "../config/constants.js";

/**
 * A WOFBI programme: Basic Certificate, Leadership Certificate, Leadership Diploma.
 *
 * These are the three cards in CourseEnrollment.jsx, so the presentation fields
 * (`period`, `accent`, `lockedMessage`) live here too — the API can then serve a
 * ready-to-render card and the frontend needs no lookup table of its own.
 *
 * `requiresCourseCode` encodes the progression rule the UI shows as
 * "Complete Basic Certificate first": a course only unlocks once the course it
 * points at has been completed.
 */
const courseSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true }, // "BCC"
    name: { type: String, required: true, unique: true, trim: true },
    period: { type: String, trim: true, default: "" }, // "Two-week intensive"
    /**
     * How long the programme runs, as a plain phrase: "2 weeks", "6 weeks".
     *
     * Separate from `period`, which is a marketing eyebrow ("Next level",
     * "Advanced level") and answers a different question. Applicants need to know
     * how much time they are committing before they choose, so this is what the
     * course cards show next to the fee.
     */
    duration: { type: String, trim: true, default: "" },
    description: { type: String, trim: true, default: "" },

    availableMessage: { type: String, trim: true, default: "Available now" },
    lockedMessage: { type: String, trim: true, default: "Complete the previous course first" },
    accent: { type: String, trim: true, default: "" }, // Tailwind classes used by the card

    order: { type: Number, required: true, default: 1 },
    /** Course code that must be completed before this one unlocks. */
    requiresCourseCode: { type: String, trim: true, uppercase: true, default: null },

    lecturer: {
      name: { type: String, trim: true, default: "" }, // "Pst. Michael Adebayo"
      title: { type: String, trim: true, default: "" },
    },

    feeNaira: { type: Number, default: COURSE_FEE_NAIRA, min: 0 },
    published: { type: Boolean, default: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

courseSchema.index({ order: 1 });

courseSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    code: this.code,
    name: this.name,
    period: this.period,
    duration: this.duration,
    description: this.description,
    accent: this.accent,
    order: this.order,
    requiresCourseCode: this.requiresCourseCode,
    lecturer: this.lecturer?.name || "",
    fee: this.feeNaira,
    // Formatted here so every place the fee appears reads "₦3,000" identically,
    // rather than each client reinventing the thousands separator.
    feeDisplay: formatNaira(this.feeNaira),
  };
};

export default mongoose.model("Course", courseSchema);
