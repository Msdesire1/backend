import { isValidObjectId } from "mongoose";
import ChurchMember from "../models/churchMember.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import {
  createEditToken,
  editTokenMatches,
  findChurchMembers,
  memberFormJSON,
  validateChurchMember,
} from "../services/churchMember.service.js";

const EDIT_LIMIT = 3;
const CSV_COLUMNS = [
  ["Name", "fullName"],
  ["Title", "title"],
  ["Phone", "phone"],
  ["Email", "email"],
  ["Date of birth", "dateOfBirth"],
  ["Gender", "gender"],
  ["Marital status", "maritalStatus"],
  ["Wedding anniversary", "weddingAnniversary"],
  ["Spouse name", "spouseName"],
  ["Spouse phone", "spousePhone"],
  ["Number of children", "numberOfChildren"],
  ["Address", "address"],
  ["Membership status", "membershipStatus"],
  ["WSF location", "wsfLocation"],
  ["Service unit", "serviceUnit"],
  ["SMS consent", "birthdayAnniversarySmsConsent"],
  ["Edits used", "editCount"],
  ["Joined", "createdAt"],
];

const csvValue = (value) => {
  let text = value == null ? "" : value instanceof Date ? value.toISOString().slice(0, 10) : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const validateSubmission = (body) => {
  const { errors, values } = validateChurchMember(body);
  if (Object.keys(errors).length) {
    throw ApiError.unprocessable("Please correct the highlighted fields.", errors);
  }
  return values;
};

/** POST /api/church-members */
export const createChurchMember = asyncHandler(async (req, res) => {
  const values = validateSubmission(req.body);
  const { token, hash } = createEditToken();
  const member = await ChurchMember.create({ ...values, editTokenHash: hash });

  res.status(201).json({
    success: true,
    message: "Your church member information has been submitted.",
    member: member.toPublicJSON(),
    editCredential: token,
  });
});

/** POST /api/church-members/lookup */
export const lookupChurchMember = asyncHandler(async (req, res) => {
  const reference = String(req.body?.reference || "");
  if (!isValidObjectId(reference)) {
    throw ApiError.badRequest("Enter the member reference from your confirmation.");
  }

  const member = await ChurchMember.findById(reference).select("+editTokenHash");
  if (!member || !editTokenMatches(req.body?.editCredential, member.editTokenHash)) {
    throw ApiError.unauthorized("The member reference or edit credential is incorrect.");
  }

  res.json({
    success: true,
    member: memberFormJSON(member),
  });
});

/** PATCH /api/church-members/:id */
export const updateChurchMember = asyncHandler(async (req, res) => {
  if (!isValidObjectId(req.params.id)) throw ApiError.badRequest("That member reference is invalid.");
  const values = validateSubmission(req.body);
  const member = await ChurchMember.findById(req.params.id).select("+editTokenHash");
  if (!member || !editTokenMatches(req.body?.editCredential, member.editTokenHash)) {
    throw ApiError.unauthorized("The member reference or edit credential is incorrect.");
  }
  if (member.editCount >= EDIT_LIMIT) {
    throw ApiError.forbidden("You have used all 3 allowed updates for this member record.", {
      code: "EDIT_LIMIT_REACHED",
    });
  }

  const updated = await ChurchMember.findOneAndUpdate(
    { _id: member._id, editTokenHash: member.editTokenHash, editCount: { $lt: EDIT_LIMIT } },
    { $set: values, $inc: { editCount: 1 } },
    { new: true, runValidators: true },
  );
  if (!updated) {
    throw ApiError.forbidden("You have used all 3 allowed updates for this member record.", {
      code: "EDIT_LIMIT_REACHED",
    });
  }

  res.json({
    success: true,
    message: "Your information has been updated.",
    member: updated.toPublicJSON(),
  });
});

/** GET /api/admin/church-members */
export const listChurchMembers = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 25, 1), 100);
  const page = Math.max(Number.parseInt(req.query.page, 10) || 1, 1);
  const { members, total } = await findChurchMembers({
    search: String(req.query.search || "").trim().slice(0, 100),
    skip: (page - 1) * limit,
    limit,
  });

  res.json({
    success: true,
    members: members.map((member) => member.toPublicJSON()),
    pagination: { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) },
  });
});

/** GET /api/admin/church-members/export */
export const exportChurchMembers = asyncHandler(async (req, res) => {
  const { members } = await findChurchMembers({
    search: String(req.query.search || "").trim().slice(0, 100),
    limit: 0,
  });
  const rows = [
    CSV_COLUMNS.map(([label]) => csvValue(label)).join(","),
    ...members.map((member) =>
      CSV_COLUMNS.map(([, field]) => csvValue(member[field])).join(","),
    ),
  ];

  res
    .status(200)
    .set("Content-Type", "text/csv; charset=utf-8")
    .set("Content-Disposition", `attachment; filename="church-members-${new Date().toISOString().slice(0, 10)}.csv"`)
    .send(`\uFEFF${rows.join("\r\n")}`);
});
