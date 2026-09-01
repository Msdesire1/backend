/**
 * Seed the reference data the dashboard needs before anyone can use it: the three
 * WOFBI programmes, their lessons, the administrator accounts, and a welcome
 * announcement.
 *
 *   npm run seed
 *
 * Safe to run more than once. Everything is upserted on its natural key — course
 * code, (course, lesson number), admin email — so a second run updates the
 * curriculum rather than duplicating it. Student-owned collections (users,
 * applications, payments, attendance, submissions) are never touched: this script
 * is for content the institute maintains, not for fake students.
 *
 * An existing admin's password is never rewritten, so re-running this to publish a
 * new lesson cannot reset a password somebody has already changed.
 *
 * Pass --replace-lessons to delete lessons that are no longer in this file. The
 * default is to leave them alone, because a lesson removed here may still be
 * referenced by a student's completion record.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../config/database.js";
import Course from "../models/course.model.js";
import Lesson from "../models/lesson.model.js";
import Admin from "../models/admin.model.js";
import { Announcement } from "../models/announcement.model.js";
import { ADMIN_ROLE, COURSES } from "../config/constants.js";

dotenv.config({ path: ".env", override: true, quiet: true });

const replaceLessons = process.argv.includes("--replace-lessons");

/* ---------------------------------------------------------------- lecturers -- */

/**
 * Teaching assignments. "Pst. Michael Adebayo" is the name the dashboard card
 * already shows for the Basic Certificate Course, so it stays as-is — swapping it
 * would make the seeded data disagree with the UI's own copy.
 */
const LECTURERS = {
  BCC: { name: "Pst. Michael Adebayo", title: "Resident Pastor" },
  LCC: { name: "Pst. Grace Okonkwo", title: "Leadership Faculty" },
  LDC: { name: "Dr. Samuel Aluko", title: "Diploma Faculty" },
};

/* ------------------------------------------------------------------ lessons -- */

/**
 * The curriculum, grouped by module. Lesson numbers are assigned sequentially
 * across the whole programme (not restarted per module) because the dashboard
 * renders them as one running count — "NEXT LESSON · 09".
 */
const CURRICULUM = {
  BCC: [
    {
      module: "Foundations of Faith",
      lessons: [
        ["The Word of God as Final Authority", 24],
        ["Understanding Salvation", 26],
        ["Repentance and the New Birth", 22],
        ["Assurance of Salvation", 20],
      ],
    },
    {
      module: "Growing in Grace",
      lessons: [
        ["The Place of Prayer", 28],
        ["Studying the Scriptures", 25],
        ["Water Baptism", 18],
        ["The Baptism of the Holy Spirit", 30],
      ],
    },
    {
      module: "Victorious Living",
      lessons: [
        ["Faith That Works", 27],
        ["Walking in Love", 24],
        ["Christian Stewardship", 26],
        ["The Believer's Authority", 32],
      ],
    },
  ],
  LCC: [
    {
      module: "Called to Lead",
      lessons: [
        ["Biblical Patterns of Leadership", 30],
        ["Character Before Gifting", 28],
        ["Vision and Followership", 26],
        ["Leading Yourself First", 24],
      ],
    },
    {
      module: "Serving the Church",
      lessons: [
        ["Understanding Church Order", 27],
        ["Departmental Stewardship", 25],
        ["Pastoral Care and Follow-up", 29],
        ["Handling Conflict in Ministry", 26],
      ],
    },
    {
      module: "Ministry in Practice",
      lessons: [
        ["Preparing and Delivering the Word", 34],
        ["Personal Evangelism", 28],
      ],
    },
  ],
  LDC: [
    {
      module: "Advanced Doctrine",
      lessons: [
        ["The Doctrine of Christ", 34],
        ["The Holy Spirit and His Gifts", 32],
        ["Covenant and the Blessing", 30],
        ["Eschatology in Outline", 28],
      ],
    },
    {
      module: "Leadership at Scale",
      lessons: [
        ["Building and Delegating to Teams", 30],
        ["Administration and Record Keeping", 26],
        ["Financial Integrity in Ministry", 28],
        ["Mentoring the Next Generation", 27],
      ],
    },
    {
      module: "Commissioned",
      lessons: [
        ["Church Planting Principles", 33],
        ["Missions and the Great Commission", 31],
      ],
    },
  ],
};

/** Flatten a programme's modules into numbered lesson documents. */
const lessonsFor = (code, courseId) => {
  const rows = [];
  let number = 0;
  CURRICULUM[code].forEach((module, moduleIndex) => {
    for (const [title, durationMinutes] of module.lessons) {
      number += 1;
      rows.push({
        course: courseId,
        number,
        title,
        summary: "",
        moduleNumber: moduleIndex + 1,
        moduleTitle: module.module,
        durationMinutes,
        type: "Video lesson",
        lecturer: LECTURERS[code].name,
        published: true,
      });
    }
  });
  return rows;
};

/* -------------------------------------------------------------------- steps -- */

const seedCourses = async () => {
  const summary = [];
  for (const course of COURSES) {
    const { code, requiresCourseCode, ...rest } = course;
    // Existence is checked first rather than read back out of an upsert result:
    // the shape of that result has changed between Mongoose majors, and "did this
    // row already exist" is only needed for the log line.
    const existed = await Course.exists({ code });
    // Everything in the COURSES table is $set, so editing constants.js and
    // re-running keeps the database in step — that now includes `feeNaira` and
    // `duration`, which are the figures applicants are quoted and so must not be
    // allowed to drift from the one place they are written down.
    //
    // `published` and `active` stay insert-only: those are operational switches an
    // admin flips through the console, and a seed run should not un-retire a course.
    const document = await Course.findOneAndUpdate(
      { code },
      {
        $set: { ...rest, requiresCourseCode, lecturer: LECTURERS[code] },
        $setOnInsert: { code, published: true, active: true },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    summary.push({ code, name: document.name, created: !existed });
  }
  return summary;
};

const seedLessons = async () => {
  const counts = { created: 0, updated: 0, removed: 0 };

  for (const code of Object.keys(CURRICULUM)) {
    const course = await Course.findOne({ code });
    if (!course) continue;

    const rows = lessonsFor(code, course._id);
    const operations = rows.map((lesson) => ({
      updateOne: {
        filter: { course: course._id, number: lesson.number },
        // Only the lesson's own content is overwritten. `published` is
        // $setOnInsert so a lesson an admin has retired stays retired.
        update: {
          $set: {
            title: lesson.title,
            moduleNumber: lesson.moduleNumber,
            moduleTitle: lesson.moduleTitle,
            durationMinutes: lesson.durationMinutes,
            type: lesson.type,
            lecturer: lesson.lecturer,
          },
          $setOnInsert: { course: course._id, number: lesson.number, published: true, summary: "" },
        },
        upsert: true,
      },
    }));

    const result = await Lesson.bulkWrite(operations, { ordered: false });
    counts.created += result.upsertedCount || 0;
    counts.updated += result.modifiedCount || 0;

    if (replaceLessons) {
      const { deletedCount } = await Lesson.deleteMany({
        course: course._id,
        number: { $gt: rows.length },
      });
      counts.removed += deletedCount || 0;
    }
  }

  return counts;
};

/**
 * The administrator accounts, from the environment.
 *
 * The institute runs the console from its two official church addresses, so this
 * reads a list rather than a single pair. Set them in `.env`:
 *
 *   SEED_ADMIN_EMAILS=first@church.org,second@church.org
 *   SEED_ADMIN_NAMES=First Person,Second Person
 *   SEED_ADMIN_PASSWORD=<a strong shared first-login password>
 *
 * `SEED_ADMIN_NAMES` is positional — the first name goes with the first email —
 * and any address without a matching name falls back to a generic one. The
 * singular `SEED_ADMIN_EMAIL`/`SEED_ADMIN_NAME` still work so an existing .env
 * keeps functioning; they are simply treated as a list of one.
 *
 * The password is only ever used to *create* an account. An existing admin's
 * password is never overwritten by a seed run — otherwise re-seeding to add a
 * course would silently reset a password the holder had already changed, and
 * quietly hand it back to whoever can read .env.
 */
const adminList = () => {
  const raw = process.env.SEED_ADMIN_EMAILS || process.env.SEED_ADMIN_EMAIL || "";
  const emails = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  const names = (process.env.SEED_ADMIN_NAMES || process.env.SEED_ADMIN_NAME || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  // Two people sharing one address in the list would collide on the unique email
  // index, so the same address twice is one account. Deduped before the names are
  // matched up, so a list that collapses to one account gets an unnumbered name.
  const unique = [...new Set(emails)];
  return unique.map((email, index) => ({
    email,
    name: names[index] || `WOFBI Administrator${unique.length > 1 ? ` ${index + 1}` : ""}`,
  }));
};

/**
 * The placeholder account from before the church addresses were known.
 *
 * Deactivated rather than deleted once at least one real super admin can sign in:
 * every decision it ever made is stamped `reviewedBy: <that id>`, and removing the
 * document would leave those records pointing at nothing. `active: false` is
 * enough — the login route refuses an inactive admin.
 */
const PLACEHOLDER_ADMIN_EMAIL = "admin@wofbi.local";

const seedAdmins = async () => {
  const wanted = adminList();
  const password = process.env.SEED_ADMIN_PASSWORD || "";

  if (!wanted.length) {
    return {
      results: [],
      skipped:
        "SEED_ADMIN_EMAILS is not set — no admin created. Put the two church addresses there.",
    };
  }
  if (!password) {
    return { results: [], skipped: "SEED_ADMIN_PASSWORD is not set — no admin created." };
  }
  if (password.length < 8) {
    return { results: [], skipped: "SEED_ADMIN_PASSWORD must be at least 8 characters." };
  }

  const results = [];
  for (const { email, name } of wanted) {
    const existing = await Admin.findOne({ email });
    if (existing) {
      // A previously retired address that is now back on the list should work
      // again; nothing else about the account is touched.
      if (!existing.active) {
        existing.active = true;
        await existing.save();
        results.push({ email, created: false, reactivated: true });
        continue;
      }
      results.push({ email, created: false });
      continue;
    }

    // Every seeded account is a super admin. Both church addresses need to be able
    // to create the ordinary admins, and there is no public admin sign-up by
    // design. `new` + `save` rather than `create` so the password-hashing hook runs.
    const admin = new Admin({ name, email, password, role: ADMIN_ROLE.SUPER_ADMIN });
    await admin.save();
    results.push({ email, created: true });
  }

  // Retire the placeholder, but only once a real account can actually get in —
  // deactivating it first would lock everyone out of the console. "Can get in"
  // means present and active, whether this run created it or a previous one did.
  const realAdmins = results.filter((entry) => entry.email !== PLACEHOLDER_ADMIN_EMAIL);
  let retired = null;
  if (realAdmins.length) {
    const placeholder = await Admin.findOne({ email: PLACEHOLDER_ADMIN_EMAIL, active: true });
    if (placeholder) {
      placeholder.active = false;
      await placeholder.save();
      retired = placeholder.email;
    }
  }

  return { results, retired };
};

const seedAnnouncement = async () => {
  const title = "Welcome to WOFBI online registration";
  const existing = await Announcement.findOne({ title });
  if (existing) return { created: false };

  await Announcement.create({
    title,
    body:
      "Registration is open for the current intake. Complete your application form, " +
      "pay the ₦3,000 registration fee, and upload your receipt. Once your payment is " +
      "confirmed your student ID and course materials will appear on this dashboard.",
    audience: "all",
    important: false,
  });
  return { created: true };
};

/* --------------------------------------------------------------------- main -- */

const run = async () => {
  if (!process.env.MONGODB_URI) {
    console.error("MONGODB_URI is not set. Copy .env.example to .env first.");
    process.exit(1);
  }

  await connectDB();
  console.log("");

  const courses = await seedCourses();
  for (const course of courses) {
    console.log(`  ${course.created ? "created" : "updated"}  course   ${course.code} — ${course.name}`);
  }

  const lessons = await seedLessons();
  console.log(
    `  lessons: ${lessons.created} created, ${lessons.updated} updated` +
      (replaceLessons ? `, ${lessons.removed} removed` : ""),
  );

  const admin = await seedAdmins();
  if (admin.skipped) {
    console.log(`  skipped  admin    ${admin.skipped}`);
  } else {
    for (const entry of admin.results) {
      if (entry.created) console.log(`  created  admin    ${entry.email} (super_admin)`);
      else if (entry.reactivated) console.log(`  enabled  admin    ${entry.email} — reactivated`);
      else console.log(`  exists   admin    ${entry.email} — password left unchanged`);
    }
    if (admin.retired) {
      console.log(`  retired  admin    ${admin.retired} — deactivated, real accounts are in place`);
    }
  }

  const announcement = await seedAnnouncement();
  console.log(`  ${announcement.created ? "created" : "exists "}  announcement`);

  console.log("\nSeed complete.");

  // Printed every run, not just the first: "where do I sign in?" is the question
  // this script is asked most, and the answer belongs in its own output rather
  // than in a document nobody has open.
  const site = (process.env.CLIENT_URL || "http://localhost:3000").replace(/\/+$/, "");
  console.log(`\nAdministrator console:  ${site}/admin`);
  console.log(`Student sign-in:        ${site}/login`);
  if (admin.results?.some((entry) => entry.created)) {
    console.log("\nSign in with SEED_ADMIN_PASSWORD and change it from the console straight away.");
  }

  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (error) => {
  console.error(`\nSeed failed: ${error.message}`);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
