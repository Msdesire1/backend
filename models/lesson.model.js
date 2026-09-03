import mongoose from "mongoose";

/**
 * A single lesson inside a programme.
 *
 * The dashboard shows lessons grouped into modules — "Basic Certificate Course ·
 * Module 2", lesson "09", card title "Foundations of Faith". Rather than adding a
 * third collection for modules, each lesson carries its `moduleNumber` and
 * `moduleTitle`. Modules have no data of their own beyond a name and an ordering,
 * so this keeps every field the UI displays available in one read.
 */
const lessonSchema = new mongoose.Schema(
  {
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },

    /** Lesson number within the programme — rendered zero-padded as "09". */
    number: { type: Number, required: true, min: 1 },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    summary: { type: String, trim: true, default: "", maxlength: 1000 },

    moduleNumber: { type: Number, default: 1, min: 1 },
    moduleTitle: { type: String, trim: true, default: "" }, // "Foundations of Faith"

    durationMinutes: { type: Number, default: 0, min: 0 },
    type: { type: String, trim: true, default: "Video lesson" },
    lecturer: { type: String, trim: true, default: "" },

    /** Optional media the lecturer attaches. */
    videoUrl: { type: String, trim: true, default: "" },
    resourceUrl: { type: String, trim: true, default: "" },

    published: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Lesson numbers are unique within a programme, and the dashboard always reads
// them in order.
lessonSchema.index({ course: 1, number: 1 }, { unique: true });

lessonSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    number: this.number,
    label: String(this.number).padStart(2, "0"), // "09"
    title: this.title,
    summary: this.summary,
    moduleNumber: this.moduleNumber,
    moduleTitle: this.moduleTitle,
    durationMinutes: this.durationMinutes,
    durationLabel: this.durationMinutes ? `${this.durationMinutes} min` : "",
    type: this.type,
    lecturer: this.lecturer,
    videoUrl: this.videoUrl || null,
    resourceUrl: this.resourceUrl || null,
  };
};

export default mongoose.model("Lesson", lessonSchema);
