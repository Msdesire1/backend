import mongoose from "mongoose";
import { CURRENT_INTAKE, ENROLLMENT_STATUS, ENROLLMENT_STATUSES } from "../config/constants.js";

/**
 * A student's place on a programme, and their progress through it.
 *
 * Completed lessons are stored as an array of references rather than a counter so
 * progress is idempotent: marking the same lesson complete twice cannot inflate
 * the percentage, and un-completing one is a simple pull.
 *
 * The percentage itself is deliberately not stored — it is derived from the
 * programme's current published lesson count whenever it is read, so adding a
 * lesson recalculates everyone's progress instead of leaving stale numbers behind.
 */
const completedLessonSchema = new mongoose.Schema(
  {
    lesson: { type: mongoose.Schema.Types.ObjectId, ref: "Lesson", required: true },
    completedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const enrollmentSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },

    status: { type: String, enum: ENROLLMENT_STATUSES, default: ENROLLMENT_STATUS.ACTIVE },

    intake: {
      code: { type: String, trim: true, default: CURRENT_INTAKE.code },
      label: { type: String, trim: true, default: CURRENT_INTAKE.label },
    },

    completedLessons: { type: [completedLessonSchema], default: [] },

    enrolledAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    /** Last lesson opened, so "Resume" returns to the right place. */
    lastLesson: { type: mongoose.Schema.Types.ObjectId, ref: "Lesson", default: null },
    lastActiveAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// A student can only hold one place per programme.
enrollmentSchema.index({ user: 1, course: 1 }, { unique: true });
<<<<<<< HEAD
=======
// Keep the one-active-course rule true even when two enrollment requests race.
enrollmentSchema.index(
  { user: 1 },
  { unique: true, partialFilterExpression: { status: ENROLLMENT_STATUS.ACTIVE } },
);
>>>>>>> 7e53228efe71c50c11375ed3b88dbc06ec66029d
enrollmentSchema.index({ course: 1, status: 1 });

enrollmentSchema.methods.hasCompleted = function hasCompleted(lessonId) {
  return this.completedLessons.some((entry) => String(entry.lesson) === String(lessonId));
};

export default mongoose.model("Enrollment", enrollmentSchema);
