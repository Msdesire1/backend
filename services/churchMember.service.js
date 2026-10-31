import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import ChurchMember from "../models/churchMember.model.js";

const clean = (value) => (typeof value === "string" ? value.trim() : "");
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;
const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed"];
const MEMBERSHIP_STATUSES = ["New Member", "Existing Member", "First-time visitor"];

const parseDate = (value) => {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toISOString().slice(0, 10) === value ? date : null;
};

const normalizePhone = (value) => {
  const compact = clean(value).replace(/[\s()-]/g, "");
  if (/^0\d{8,14}$/.test(compact)) return `+234${compact.slice(1)}`;
  if (/^234\d{8,13}$/.test(compact)) return `+${compact}`;
  return compact;
};

export const validateChurchMember = (body = {}) => {
  const errors = {};
  const fullName = clean(body.fullName).replace(/\s+/g, " ");
  const title = clean(body.title);
  const phone = normalizePhone(body.phone);
  const email = clean(body.email).toLowerCase();
  const dateOfBirth = parseDate(body.dateOfBirth);
  const dateOrdained = body.dateOrdained ? parseDate(body.dateOrdained) : null;
  const occupation = clean(body.occupation);
  const workingPlace = clean(body.workingPlace);
  const dateJoinedCommission = body.dateJoinedCommission ? parseDate(body.dateJoinedCommission) : null;
  const commissionLocation = clean(body.commissionLocation);
  const newBirthDate = body.newBirthDate ? parseDate(body.newBirthDate) : null;
  const dateJoinedLfcNewJerusalem = body.dateJoinedLfcNewJerusalem
    ? parseDate(body.dateJoinedLfcNewJerusalem)
    : null;
  const wofbiProgramme = clean(body.wofbiProgramme);
  const wofbiDateAttended = body.wofbiDateAttended ? parseDate(body.wofbiDateAttended) : null;
  const gender = clean(body.gender);
  const maritalStatus = clean(body.maritalStatus);
  const weddingAnniversary =
    maritalStatus === "Married" ? parseDate(body.weddingAnniversary) : null;
  const spouseName = clean(body.spouseName);
  const spousePhone = body.spousePhone ? normalizePhone(body.spousePhone) : "";
  const address = clean(body.address);
  const membershipStatus = clean(body.membershipStatus);
  const wsfLocation = clean(body.wsfLocation);
  const serviceUnit = clean(body.serviceUnit);
  const numberOfChildren =
    body.numberOfChildren === "" || body.numberOfChildren == null
      ? null
      : Number(body.numberOfChildren);

  if (fullName.length < 2 || fullName.length > 120) errors.fullName = "Enter your full name.";
  if (!title || title.length > 30) errors.title = "Choose a title.";
  if (!PHONE_PATTERN.test(phone)) errors.phone = "Enter a valid phone number, such as 08012345678.";
  if (!EMAIL_PATTERN.test(email) || email.length > 254) errors.email = "Enter a valid email address.";
  if (!dateOfBirth || dateOfBirth >= new Date()) errors.dateOfBirth = "Enter a valid date of birth.";
  for (const [field, value, label] of [
    ["dateOrdained", dateOrdained, "ordination date"],
    ["dateJoinedCommission", dateJoinedCommission, "commission joining date"],
    ["newBirthDate", newBirthDate, "new birth date"],
    ["dateJoinedLfcNewJerusalem", dateJoinedLfcNewJerusalem, "church joining date"],
    ["wofbiDateAttended", wofbiDateAttended, "WOFBI attendance date"],
  ]) {
    if (body[field] && (!value || value >= new Date())) {
      errors[field] = `Enter a valid ${label}.`;
    }
  }
  if (occupation.length > 120) errors.occupation = "Use 120 characters or fewer.";
  if (workingPlace.length > 160) errors.workingPlace = "Use 160 characters or fewer.";
  if (commissionLocation.length > 160) errors.commissionLocation = "Use 160 characters or fewer.";
  if (wofbiProgramme.length > 120) errors.wofbiProgramme = "Use 120 characters or fewer.";
  if (!["Male", "Female"].includes(gender)) errors.gender = "Choose a gender.";
  if (!MARITAL_STATUSES.includes(maritalStatus)) errors.maritalStatus = "Choose a marital status.";
  if (maritalStatus === "Married" && !weddingAnniversary) {
    errors.weddingAnniversary = "Enter your wedding anniversary.";
  }
  if (spousePhone && !PHONE_PATTERN.test(spousePhone)) {
    errors.spousePhone = "Enter a valid phone number.";
  }
  if (!address || address.length > 300) errors.address = "Enter your residential address or area.";
  if (!MEMBERSHIP_STATUSES.includes(membershipStatus)) {
    errors.membershipStatus = "Choose a membership status.";
  }
  if (Number.isNaN(numberOfChildren) || (numberOfChildren !== null && (!Number.isInteger(numberOfChildren) || numberOfChildren < 0 || numberOfChildren > 100))) {
    errors.numberOfChildren = "Enter a whole number between 0 and 100.";
  }
  if (wsfLocation.length > 240) errors.wsfLocation = "Use 240 characters or fewer.";
  if (serviceUnit.length > 80) errors.serviceUnit = "Use 80 characters or fewer.";
  if (!body.consent) errors.consent = "Confirm that the information is correct.";

  return {
    errors,
    values: {
      fullName,
      title,
      phone,
      email,
      dateOfBirth,
      dateOrdained,
      occupation,
      workingPlace,
      dateJoinedCommission,
      commissionLocation,
      newBirthDate,
      dateJoinedLfcNewJerusalem,
      wofbiProgramme,
      wofbiDateAttended,
      gender,
      maritalStatus,
      weddingAnniversary,
      spouseName,
      spousePhone,
      numberOfChildren,
      address,
      membershipStatus,
      wsfLocation,
      serviceUnit,
      birthdayAnniversarySmsConsent: body.birthdayAnniversarySmsConsent === true,
      consent: body.consent === true,
    },
  };
};

export const createEditToken = () => {
  const token = randomBytes(32).toString("hex");
  return { token, hash: createHash("sha256").update(token).digest("hex") };
};

export const editTokenMatches = (token, storedHash) => {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/i.test(token) || !storedHash) return false;
  const actualHash = createHash("sha256").update(token).digest();
  const expectedHash = Buffer.from(storedHash, "hex");
  return actualHash.length === expectedHash.length && timingSafeEqual(actualHash, expectedHash);
};

export const memberFormJSON = (member) => ({
  ...member.toPublicJSON(),
  dateOfBirth: member.dateOfBirth.toISOString().slice(0, 10),
  dateOrdained: member.dateOrdained?.toISOString().slice(0, 10) || "",
  dateJoinedCommission: member.dateJoinedCommission?.toISOString().slice(0, 10) || "",
  newBirthDate: member.newBirthDate?.toISOString().slice(0, 10) || "",
  dateJoinedLfcNewJerusalem: member.dateJoinedLfcNewJerusalem?.toISOString().slice(0, 10) || "",
  wofbiDateAttended: member.wofbiDateAttended?.toISOString().slice(0, 10) || "",
  weddingAnniversary: member.weddingAnniversary?.toISOString().slice(0, 10) || "",
});

export const findChurchMembers = async ({ search = "", skip = 0, limit = 25 } = {}) => {
  const filter = {};
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(escaped, "i");
    filter.$or = [
      { fullName: regex },
      { email: regex },
      { phone: regex },
      { membershipStatus: regex },
      { serviceUnit: regex },
      { wsfLocation: regex },
    ];
  }

  const [members, total] = await Promise.all([
    ChurchMember.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    ChurchMember.countDocuments(filter),
  ]);
  return { members, total, filter };
};
