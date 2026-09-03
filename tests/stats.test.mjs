/**
 * Pure-function tests for the admin statistics helpers and the shared date
 * formatters. No database is needed for any of these — anything that talks to
 * mongo is covered by the smoke test instead.
 *
 * Run with: node tests/stats.test.mjs
 */
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { deltaLabel, formatCount, getUpcomingClasses, byIdOrReference } = await import(
  pathToFileURL(path.join(root, "services/stats.service.js")).href
);
const { formatIsoDate, formatDisplayDate, toLocalIsoDate, formatTimeAgo, formatCompactNaira } =
  await import(pathToFileURL(path.join(root, "config/constants.js")).href);
const auth = await import(pathToFileURL(path.join(root, "middleware/auth.middleware.js")).href);

/* --------------------------------------------------------------- KPI deltas -- */

assert.equal(deltaLabel(112, 100), "+12.0%");
assert.equal(deltaLabel(96, 100), "-4.0%");
assert.equal(deltaLabel(100, 100), "0.0%");
// Growth from a base of zero has no meaningful percentage.
assert.equal(deltaLabel(3, 0), "+3 this month");
assert.equal(deltaLabel(0, 0), "No change this month");

assert.equal(formatCount(1246), "1,246");
assert.equal(formatCount(0), "0");
assert.equal(formatCount(undefined), "0");

assert.equal(formatCompactNaira(18_400_000), "₦18.4m");
assert.equal(formatCompactNaira(3000), "₦3.0k");
assert.equal(formatCompactNaira(500), "₦500");

/* ---------------------------------------------------------- upcoming classes -- */

const classes = getUpcomingClasses(5);
assert.equal(classes.length, 5);
for (const session of classes) {
  const [year, month, day] = session.isoDate.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  assert.ok(weekday >= 1 && weekday <= 5, `expected a weekday, got ${session.date}`);
  assert.equal(session.timeRange, "7:00 AM – 3:00 PM");
  assert.equal(session.title, "Covenant Practice");
}
// Strictly ascending, and the first session is always after today — the card is
// "upcoming classes", so a class that has already started does not belong in it.
for (let index = 1; index < classes.length; index += 1) {
  assert.ok(classes[index - 1].isoDate < classes[index].isoDate);
}
assert.ok(classes[0].isoDate > toLocalIsoDate(new Date()));

/* ------------------------------------------------------------------- dates -- */

// The regression this guards: `toISOString().slice(0, 10)` on a local-midnight
// date reports the previous day anywhere east of UTC, so the ISO date and the
// human label would describe different days.
const justAfterMidnight = new Date(2026, 6, 18, 0, 30);
assert.equal(formatIsoDate(justAfterMidnight), "2026-07-18");
assert.equal(formatDisplayDate(justAfterMidnight), "18 Jul 2026");
assert.equal(toLocalIsoDate(new Date(2026, 0, 5)), "2026-01-05");
assert.equal(formatIsoDate("not a date"), "—");
assert.equal(formatDisplayDate("not a date"), "—");

assert.equal(formatTimeAgo(new Date(Date.now() - 2 * 60_000)), "2 minutes ago");
assert.equal(formatTimeAgo(new Date(Date.now() - 60 * 60_000)), "1 hour ago");
assert.equal(formatTimeAgo(new Date()), "Just now");

/* ------------------------------------------------------- reference lookups -- */

// The admin modals hand back the reference they were rendered with, not an id.
assert.deepEqual(byIdOrReference("APP-1284", "applicationId"), { applicationId: "APP-1284" });
assert.deepEqual(byIdOrReference("app-1284", "applicationId"), { applicationId: "APP-1284" });
assert.deepEqual(byIdOrReference("pay-26041", "paymentId"), { paymentId: "PAY-26041" });
assert.deepEqual(byIdOrReference("64b7f1c2a1b2c3d4e5f60718", "_id"), {
  _id: "64b7f1c2a1b2c3d4e5f60718",
});
// A 12-character string is technically a valid ObjectId input; it must still be
// treated as a reference.
assert.deepEqual(byIdOrReference("APP-12345678", "applicationId"), {
  applicationId: "APP-12345678",
});

/* ------------------------------------------------------------------ guards -- */

assert.equal(typeof auth.requireAuth, "function");
assert.equal(typeof auth.requireAdmin, "function");
assert.equal(typeof auth.requireAdminRole("super_admin"), "function");
assert.equal(typeof auth.requireAuthOrAdmin, "function");

console.log("admin stats + date helpers: all assertions passed");
