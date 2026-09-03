/**
 * Announcements for students, including the unread count behind the dashboard's
 * "2 new" badge.
 *
 * Visibility: an announcement addressed to "all" or "students" reaches everyone;
 * one addressed to a course reaches only that course's students. Read state lives
 * in its own collection, so the badge is an indexed count rather than a scan
 * through an ever-growing array on the announcement itself.
 */
import { Announcement, AnnouncementRead, ANNOUNCEMENT_AUDIENCE } from "../models/announcement.model.js";
import Enrollment from "../models/enrollment.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { ENROLLMENT_STATUS } from "../config/constants.js";

const visibilityFilter = async (userId) => {
  const enrollments = await Enrollment.find({
    user: userId,
    status: { $ne: ENROLLMENT_STATUS.WITHDRAWN },
  }).select("course");

  return {
    active: true,
    publishedAt: { $lte: new Date() },
    $or: [
      { audience: { $in: [ANNOUNCEMENT_AUDIENCE.ALL, ANNOUNCEMENT_AUDIENCE.STUDENTS] } },
      {
        audience: ANNOUNCEMENT_AUDIENCE.COURSE,
        course: { $in: enrollments.map((enrollment) => enrollment.course) },
      },
    ],
  };
};

/** GET /api/announcements */
export const listMyAnnouncements = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const filter = await visibilityFilter(req.user._id);

  const announcements = await Announcement.find(filter).sort({ publishedAt: -1 }).limit(limit);

  const reads = await AnnouncementRead.find({
    user: req.user._id,
    announcement: { $in: announcements.map((announcement) => announcement._id) },
  }).select("announcement");
  const readIds = new Set(reads.map((read) => String(read.announcement)));

  const rows = announcements.map((announcement) =>
    announcement.toPublicJSON({ read: readIds.has(String(announcement._id)) }),
  );

  res.json({
    success: true,
    announcements: rows,
    latest: rows[0] || null,
    // The badge counts unread items across everything visible, not just this page.
    unreadCount: rows.filter((row) => !row.read).length,
    unreadLabel: `${rows.filter((row) => !row.read).length} new`,
  });
});

/** POST /api/announcements/:id/read */
export const markAnnouncementRead = asyncHandler(async (req, res) => {
  const filter = await visibilityFilter(req.user._id);
  const announcement = await Announcement.findOne({ ...filter, _id: req.params.id });
  if (!announcement) throw ApiError.notFound("That announcement could not be found.");

  // upsert: reading twice is not an error, and must not create a second receipt.
  await AnnouncementRead.updateOne(
    { announcement: announcement._id, user: req.user._id },
    { $setOnInsert: { readAt: new Date() } },
    { upsert: true },
  );

  res.json({ success: true, message: "Marked as read." });
});

/** POST /api/announcements/read-all — clears the badge in one request. */
export const markAllAnnouncementsRead = asyncHandler(async (req, res) => {
  const filter = await visibilityFilter(req.user._id);
  const announcements = await Announcement.find(filter).select("_id");

  if (announcements.length) {
    await AnnouncementRead.bulkWrite(
      announcements.map((announcement) => ({
        updateOne: {
          filter: { announcement: announcement._id, user: req.user._id },
          update: { $setOnInsert: { readAt: new Date() } },
          upsert: true,
        },
      })),
    );
  }

  res.json({ success: true, message: "All announcements marked as read.", unreadCount: 0 });
});
