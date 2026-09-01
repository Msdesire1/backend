import mongoose from "mongoose";
import fileRefSchema, { toFileJSON } from "./fileRef.schema.js";
import { formatTimeAgo } from "../config/constants.js";

/**
 * Announcements shown on the student dashboard ("Latest announcements", with a
 * "2 new" badge) and in the admin activity feed.
 *
 * Read state is a separate collection rather than an array on the announcement.
 * A church-wide announcement could accumulate thousands of reader ids, and
 * MongoDB documents cap at 16 MB — an unbounded array inside a hot document is
 * the classic way to hit that wall. A separate row per read also makes the
 * unread count a cheap indexed query.
 */

const AUDIENCE = { ALL: "all", STUDENTS: "students", COURSE: "course" };

const announcementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    body: { type: String, required: true, trim: true, maxlength: 5000 },

    audience: { type: String, enum: Object.values(AUDIENCE), default: AUDIENCE.ALL },
    /** Required when audience is "course" — limits it to that programme's students. */
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", default: null },

    /** Renders the amber warning treatment on the dashboard card. */
    important: { type: Boolean, default: false },
    attachment: { type: fileRefSchema, default: null },

    publishedAt: { type: Date, default: Date.now },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

announcementSchema.index({ active: 1, publishedAt: -1 });

announcementSchema.methods.toPublicJSON = function toPublicJSON({ read = false } = {}) {
  return {
    id: this._id,
    title: this.title,
    body: this.body,
    important: this.important,
    attachment: toFileJSON(this.attachment),
    publishedAt: this.publishedAt,
    publishedAgo: formatTimeAgo(this.publishedAt),
    read,
  };
};

export const Announcement = mongoose.model("Announcement", announcementSchema);

/* ------------------------------------------------------------- read receipts -- */

const announcementReadSchema = new mongoose.Schema(
  {
    announcement: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Announcement",
      required: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    readAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

announcementReadSchema.index({ announcement: 1, user: 1 }, { unique: true });
announcementReadSchema.index({ user: 1 });

export const AnnouncementRead = mongoose.model("AnnouncementRead", announcementReadSchema);
export { AUDIENCE as ANNOUNCEMENT_AUDIENCE };
