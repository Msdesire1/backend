/**
 * Administrator account maintenance.
 *
 *   node scripts/admin.js list
 *   node scripts/admin.js set-password <email> <newPassword>
 *   node scripts/admin.js create <email> <password> [full name]
 *
 * `npm run seed` creates the first admin but deliberately never touches the
 * password of one that already exists — a seed script that silently reset live
 * credentials would be a bad thing to leave in a repository. This is the escape
 * hatch for the case the seed refuses to handle: the account is there and the
 * password is not what you thought.
 *
 * Every write goes through admin.save(), never updateOne, because the bcrypt
 * hashing lives in a pre("save") hook on the model. An updateOne would store the
 * password in plain text and login would then fail for a much more confusing
 * reason than the one you started with.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import connectDB from "../config/database.js";
import Admin from "../models/admin.model.js";
import { ADMIN_ROLE } from "../config/constants.js";

dotenv.config({ path: ".env", override: true, quiet: true });

const [command, ...args] = process.argv.slice(2);

const usage = () => {
  console.log(`Usage:
  node scripts/admin.js list
  node scripts/admin.js set-password <email> <newPassword>
  node scripts/admin.js create <email> <password> [full name]`);
};

const list = async () => {
  const admins = await Admin.find({}).sort({ createdAt: 1 });
  if (admins.length === 0) {
    console.log("No administrator accounts exist.");
    console.log("Run `npm run seed` to create the first one from SEED_ADMIN_* in .env.");
    return;
  }
  console.log(`${admins.length} administrator account(s):\n`);
  for (const admin of admins) {
    console.log(`  ${admin.email}`);
    console.log(`      name        ${admin.name}`);
    console.log(`      role        ${admin.role}`);
    console.log(`      active      ${admin.active}`);
    console.log(`      last login  ${admin.lastLoginAt ? admin.lastLoginAt.toISOString() : "never"}`);
    console.log(`      created     ${admin.createdAt.toISOString()}`);
  }
  // A deactivated admin fails login with a *different* message
  // ("This administrator account has been deactivated."), so if you are seeing
  // "Incorrect email address or password." the cause is the email or the password,
  // not this flag.
};

const setPassword = async (rawEmail, password) => {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!email || !password) {
    usage();
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("The password must be at least 8 characters — the model enforces this too.");
    process.exitCode = 1;
    return;
  }

  // +password because the field is `select: false`; without it the pre-save hook
  // would hash `undefined`.
  const admin = await Admin.findOne({ email }).select("+password");
  if (!admin) {
    console.error(`No administrator with the email ${email}.`);
    console.error("Run `node scripts/admin.js list` to see which accounts exist.");
    process.exitCode = 1;
    return;
  }

  admin.password = password;
  await admin.save();
  console.log(`Password updated for ${admin.email} (${admin.role}).`);
  console.log("Any admin token issued before now stays valid until it expires.");
};

const create = async (rawEmail, password, ...nameParts) => {
  const email = String(rawEmail || "").trim().toLowerCase();
  const name = nameParts.join(" ").trim() || "WOFBI Administrator";
  if (!email || !password) {
    usage();
    process.exitCode = 1;
    return;
  }
  if (password.length < 8) {
    console.error("The password must be at least 8 characters.");
    process.exitCode = 1;
    return;
  }
  if (await Admin.exists({ email })) {
    console.error(`${email} already exists. Use set-password to change its password.`);
    process.exitCode = 1;
    return;
  }

  // The first account has to be a super admin or nobody can create the others;
  // after that, plain admin is the safer default.
  const first = (await Admin.countDocuments({})) === 0;
  const admin = new Admin({
    name,
    email,
    password,
    role: first ? ADMIN_ROLE.SUPER_ADMIN : ADMIN_ROLE.ADMIN,
  });
  await admin.save();
  console.log(`Created ${admin.email} (${admin.role}).`);
};

const run = async () => {
  if (!command || command === "help" || command === "--help") {
    usage();
    return;
  }
  if (!["list", "set-password", "create"].includes(command)) {
    console.error(`Unknown command: ${command}\n`);
    usage();
    process.exitCode = 1;
    return;
  }

  await connectDB();

  if (command === "list") await list();
  else if (command === "set-password") await setPassword(...args);
  else await create(...args);
};

run()
  .catch((error) => {
    console.error(`\nFailed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close().catch(() => {});
  });
