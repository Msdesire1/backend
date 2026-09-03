/**
 * The student side of the WOFBI application.
 *
 * Mirrors how the enrollment wizard in
 * app/dashboard/user/_components/CourseEnrollment.jsx actually behaves:
 *
 *   - The applicant picks a course first, because that decides the rest: LCC and
 *     LDC ask for a leadership section BCC does not, so the number of steps is a
 *     function of the choice (see `stepsForCourse`).
 *   - It keeps one object of form state and lets the applicant move freely between
 *     steps, so drafts are saved partially and often (PATCH /me).
 *   - It only enforces required fields at the end, so submit is the one place
 *     validation bites (POST /me/submit) — and it enforces the set that belongs to
 *     the chosen course, never a fixed list.
 *   - It stores the photo and receipt as files chosen on the personal-details and
 *     declaration steps, so each can be uploaded on its own (PUT /me/files/:kind).
 *
 * Everything is scoped to `req.user`; there is no application id in any student
 * route, so one applicant can never address another's record.
 */
import Application from "../models/application.model.js";
import Payment from "../models/payment.model.js";
import Course from "../models/course.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { deleteFile, uploadBuffer } from "../config/gridfs.js";
import { generateApplicationId, generatePaymentReferences } from "../utils/ids.js";
import { sendApplicationSubmittedEmail } from "../utils/email.js";
import {
  APPLICATION_RULES_BY_COURSE,
  APPLICATION_STATUS,
  APPLICATION_STEPS,
  BANK_DETAILS,
  COURSE_FEE_NAIRA,
  COURSES,
  CURRENT_INTAKE,
  FORM_OPTIONS,
  LEADERSHIP_FIELDS,
  LEADERSHIP_STEP,
  MAX_UPLOAD_BYTES,
  PAYMENT_STATUS,
  PHOTO_MIME_TYPES,
  RECEIPT_MIME_TYPES,
  REQUIRED_APPLICATION_FIELDS,
  courseFee,
  formatNaira,
  requiredFieldsForCourse,
  stepsForCourse,
} from "../config/constants.js";

/**
 * The writable form fields, read straight off the schema. Deriving the whitelist
 * means a field added to the model is accepted immediately, and a key the client
 * invents (or `applicationComplete`, which the frontend keeps alongside the form
 * in localStorage) is silently dropped rather than stored.
 */
const FORM_FIELDS = new Set(Object.keys(Application.schema.path("form").schema.paths));

/** Human labels for the required-field errors, so messages read like the form. */
const FIELD_LABELS = {
  title: "Title",
  firstName: "First name",
  lastName: "Surname",
  email: "Email address",
  phone: "Phone number",
  gender: "Gender",
  dateOfBirth: "Date of birth",
  placeOfBirth: "Place of birth",
  nativeTown: "Native town",
  state: "State of origin",
  country: "Country",
  address: "Residential address",
  maritalStatus: "Marital status",
  languages: "Languages spoken",
  understandsEnglish: "Understanding of English",
  writesEnglish: "Ability to write English",
  occupation: "Occupation",
  schoolType: "Type of school attended",
  schoolName: "Name of school",
  dateAttended: "Dates attended",
  certificate: "Certificate obtained",
  physicalDefects: "Physical defects",
  bornAgainDate: "Date born again",
  waterBaptized: "Water baptism",
  holySpiritBaptized: "Holy Spirit baptism",
  discipleshipClass: "Discipleship class",
  bibleTraining: "Previous Bible training",
  wofbiReason: "Reason for attending WOFBI",
  afterCoursePlan: "Plans after the course",
  christianService: "Christian service experience",
  pastorNameAddress: "Pastor's name and address",
  churchSponsorship: "Church sponsorship",
  preferredCourse: "Preferred course",
  declarationName: "Declaration name",
  declarationDate: "Declaration date",

  // Leadership & ministry service — LCC and LDC only.
  currentOffice: "Current office or position",
  serviceYears: "Years in church service",
  churchDepartment: "Department or unit",
  previousLeadershipTraining: "Previous leadership training",
  previousTrainingDetails: "Previous training details",
  ministryExperience: "Ministry and leadership experience",
  refereeName: "Referee's name",
  refereeOffice: "Referee's office or position",
  refereeContact: "Referee's phone or email",
};

const labelFor = (field) => FIELD_LABELS[field] || field;

/** Statuses in which the applicant may still edit their own application. */
const EDITABLE_STATUSES = [APPLICATION_STATUS.DRAFT, APPLICATION_STATUS.REQUEST_INFO];

const uploadRules = {
  photo: { mimeTypes: PHOTO_MIME_TYPES, label: "passport photograph" },
  receipt: { mimeTypes: RECEIPT_MIME_TYPES, label: "payment receipt" },
};

/** Prefills the wizard from the account the applicant already created. */
const prefillFromUser = (user) => ({
  firstName: user.firstName || "",
  lastName: user.lastName || "",
  email: user.email || "",
  phone: user.phoneNumber || "",
});

const findApplication = (user) => Application.findOne({ user: user._id });

/**
 * Returns the applicant's application, creating the row on first write.
 * Reads deliberately do not create anything — see `getMyApplication`.
 */
const getOrCreateApplication = async (user) => {
  const existing = await findApplication(user);
  if (existing) return existing;
  return Application.create({
    user: user._id,
    form: prefillFromUser(user),
    intake: {
      code: CURRENT_INTAKE.code,
      label: CURRENT_INTAKE.label,
      adminLabel: CURRENT_INTAKE.adminLabel,
    },
  });
};

/**
 * Static reference data the wizard renders: courses, fees, bank account, steps.
 *
 * `courses` now carries a fee and a duration per programme, and
 * `rulesByCourse` carries each course's step list and required fields. Both are
 * sent up front so the wizard can react to a course being picked without a round
 * trip, and — more to the point — without reimplementing the rules and drifting
 * from the server that enforces them.
 */
const applicationMeta = () => ({
  steps: APPLICATION_STEPS,
  requiredFields: REQUIRED_APPLICATION_FIELDS,
  rulesByCourse: APPLICATION_RULES_BY_COURSE,
  leadership: { step: LEADERSHIP_STEP, fields: LEADERSHIP_FIELDS },
  options: FORM_OPTIONS,
  courses: COURSES.map((course) => ({
    ...course,
    feeDisplay: formatNaira(course.feeNaira),
  })),
  // Kept for the payment panel, which quotes one figure before a course is known.
  fee: { amount: COURSE_FEE_NAIRA, display: formatNaira(COURSE_FEE_NAIRA) },
  bank: { ...BANK_DETAILS, amountDisplay: formatNaira(BANK_DETAILS.amount) },
  intake: CURRENT_INTAKE,
  uploads: {
    maxBytes: MAX_UPLOAD_BYTES,
    maxSizeLabel: "5 MB",
    photo: { accept: PHOTO_MIME_TYPES },
    receipt: { accept: RECEIPT_MIME_TYPES },
  },
});

/** Copies whitelisted form fields from a request body onto the document. */
const applyFormFields = (application, body = {}) => {
  let touched = false;
  for (const [key, value] of Object.entries(body)) {
    if (!FORM_FIELDS.has(key)) continue;
    // A missing key means "not on this step"; an empty string means "cleared".
    if (value === null || value === undefined) continue;
    application.form[key] = typeof value === "string" ? value : String(value);
    touched = true;
  }
  return touched;
};

/** Stores an uploaded file in GridFS and swaps it for the previous one. */
const storeUpload = async (application, kind, file) => {
  const stored = await uploadBuffer({
    buffer: file.buffer,
    filename: file.filename,
    contentType: file.contentType,
    metadata: {
      user: application.user,
      application: application._id,
      kind,
    },
  });
  const previous = application[kind]?.fileId;
  application[kind] = stored;
  // Delete only after the replacement is safely stored, and never let a failed
  // cleanup fail the request — an orphaned chunk is cheaper than a lost receipt.
  if (previous) {
    deleteFile(previous).catch((error) =>
      console.error(`[gridfs] could not remove replaced ${kind}: ${error.message}`),
    );
  }
  return stored;
};

const assertEditable = (application) => {
  if (EDITABLE_STATUSES.includes(application.status)) return;
  const reason =
    application.status === APPLICATION_STATUS.REVIEW
      ? "Your application is being reviewed, so it can no longer be edited. Contact the admissions office if something needs to change."
      : application.status === APPLICATION_STATUS.APPROVED
        ? "Your application has already been approved and can no longer be edited."
        : "This application has been closed and can no longer be edited.";
  throw new ApiError(409, reason, { code: "APPLICATION_LOCKED" });
};

/* ------------------------------------------------------------------- reads -- */

/**
 * GET /api/applications/me
 *
 * Always returns an application object so the wizard has one shape to bind to.
 * When nothing has been saved yet it returns an unsaved draft — prefilled from
 * the account, with `exists: false` — rather than creating a row for every
 * curious visitor.
 */
export const getMyApplication = asyncHandler(async (req, res) => {
  const application = await findApplication(req.user);

  if (application) {
    return res.json({
      success: true,
      application: { ...application.toPublicJSON(), exists: true },
      meta: applicationMeta(),
    });
  }

  const draft = new Application({
    user: req.user._id,
    form: prefillFromUser(req.user),
  });

  res.json({
    success: true,
    application: { ...draft.toPublicJSON(), id: null, exists: false },
    meta: applicationMeta(),
  });
});

/* ------------------------------------------------------------------ writes -- */

/**
 * PATCH /api/applications/me
 *
 * Saves whatever the wizard has so far. Accepts JSON or multipart/form-data, so
 * a step that includes a file can be saved in one request. Partial by design:
 * fields that are absent are left alone.
 */
export const saveMyApplication = asyncHandler(async (req, res) => {
  const application = await getOrCreateApplication(req.user);
  assertEditable(application);

  applyFormFields(application, req.body);

  // furthestStep only ever moves forward, so navigating back does not lose the
  // "Continue where you left off" position. The ceiling comes from the course the
  // applicant has chosen, since LCC and LDC have one step more than BCC.
  const stepCount = stepsForCourse(application.form?.preferredCourse).length;
  const step = Number(req.body?.furthestStep);
  if (Number.isInteger(step) && step >= 0 && step < stepCount) {
    application.furthestStep = Math.max(application.furthestStep, step);
  }
  // Switching down from a leadership course to BCC shortens the wizard, so a
  // marker left past the new last step has to come back inside it.
  application.furthestStep = Math.min(application.furthestStep, stepCount - 1);

  for (const kind of Object.keys(uploadRules)) {
    if (req.files?.[kind]) await storeUpload(application, kind, req.files[kind]);
  }

  await application.save();

  res.json({
    success: true,
    message: "Your progress has been saved.",
    application: { ...application.toPublicJSON(), exists: true },
  });
});

/**
 * PUT /api/applications/me/files/:kind  (kind = photo | receipt)
 *
 * Uploads one file on its own, so the form can store a photograph the moment it
 * is chosen instead of holding 5 MB in browser memory until the final step.
 */
export const uploadMyApplicationFile = asyncHandler(async (req, res) => {
  const { kind } = req.params;
  if (!uploadRules[kind]) {
    throw ApiError.notFound(`Unknown upload type "${kind}". Expected photo or receipt.`);
  }

  const file = req.files?.[kind];
  if (!file) {
    throw ApiError.unprocessable(`Please attach a ${uploadRules[kind].label}.`, {
      [kind]: "This file is required.",
    });
  }

  const application = await getOrCreateApplication(req.user);
  assertEditable(application);
  await storeUpload(application, kind, file);
  await application.save();

  // Keep an already-reviewed payment's receipt in step with the application's.
  if (kind === "receipt") {
    await Payment.updateOne(
      { application: application._id, status: PAYMENT_STATUS.PENDING },
      { $set: { receipt: application.receipt } },
    );
  }

  res.json({
    success: true,
    message: `Your ${uploadRules[kind].label} has been uploaded.`,
    [kind]: application.toPublicJSON()[kind],
  });
});

/** DELETE /api/applications/me/files/:kind — lets an applicant swap a wrong file out. */
export const deleteMyApplicationFile = asyncHandler(async (req, res) => {
  const { kind } = req.params;
  if (!uploadRules[kind]) {
    throw ApiError.notFound(`Unknown upload type "${kind}". Expected photo or receipt.`);
  }

  const application = await findApplication(req.user);
  if (!application || !application[kind]) {
    throw ApiError.notFound(`No ${uploadRules[kind].label} has been uploaded.`);
  }
  assertEditable(application);

  const { fileId } = application[kind];
  application[kind] = null;
  await application.save();
  await deleteFile(fileId);

  res.json({
    success: true,
    message: `Your ${uploadRules[kind].label} has been removed.`,
  });
});

/* ------------------------------------------------------------------ submit -- */

/**
 * Collects everything missing in one pass, so the applicant sees every problem
 * at once instead of fixing them one request at a time.
 *
 * Only the fields the form itself marks required are enforced, and which fields
 * those are depends on the course: LCC and LDC add the leadership section, BCC
 * does not ask for it at all. Inventing extra rules here would make the form
 * unsubmittable through the UI, which is the worst possible failure — the
 * applicant would have no way to satisfy the API. Demanding leadership answers of
 * a BCC applicant would be exactly that bug.
 */
const collectSubmissionErrors = (application) => {
  const errors = {};
  const form = application.form || {};

  for (const field of requiredFieldsForCourse(form.preferredCourse)) {
    const value = form[field];
    if (typeof value === "string" ? value.trim() === "" : value == null) {
      errors[field] = `${labelFor(field)} is required.`;
    }
  }

  if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) {
    errors.email = "Enter a valid email address.";
  }
  if (!application.photo) {
    errors.photo = "Upload a passport photograph.";
  }
  if (!application.receipt) {
    errors.receipt = "Upload your payment receipt.";
  }
  return errors;
};

/**
 * POST /api/applications/me/submit
 *
 * Accepts the final step's fields and files in the same request, validates
 * everything, assigns the reference number, and opens the payment record the
 * admissions team will review. Idempotent for an application already under
 * review: it reports the existing reference rather than issuing a second one.
 */
export const submitMyApplication = asyncHandler(async (req, res) => {
  const application = await getOrCreateApplication(req.user);

  if (application.status === APPLICATION_STATUS.APPROVED) {
    throw new ApiError(409, "Your application has already been approved.", {
      code: "ALREADY_APPROVED",
    });
  }
  if (application.status === APPLICATION_STATUS.REVIEW) {
    return res.json({
      success: true,
      message: "Your application is already with the admissions team.",
      application: { ...application.toPublicJSON(), exists: true },
    });
  }

  // A submit may carry the last step's answers and files.
  applyFormFields(application, req.body);
  for (const kind of Object.keys(uploadRules)) {
    if (req.files?.[kind]) await storeUpload(application, kind, req.files[kind]);
  }

  // The last step of *this applicant's* wizard, which is one further along for a
  // leadership course than for BCC.
  const lastStep = stepsForCourse(application.form?.preferredCourse).length - 1;

  const errors = collectSubmissionErrors(application);
  if (Object.keys(errors).length) {
    // Save the progress anyway — a failed submit should never cost typing.
    application.furthestStep = lastStep;
    await application.save();
    throw ApiError.unprocessable(
      "Your application is not quite complete. Please fill in the highlighted fields.",
      errors,
    );
  }

  const course = await Course.findOne({ name: application.form.preferredCourse });

  application.status = APPLICATION_STATUS.REVIEW;
  application.furthestStep = lastStep;
  application.submittedAt = new Date();
  application.course = course?._id || null;
  application.reviewNote = undefined;
  if (!application.applicationId) {
    application.applicationId = await generateApplicationId();
  }

  // Every submitted application gets a payment record so the receipt lands in the
  // admin review queue. Re-submitting after "Request info" reuses the same one.
  let payment = await Payment.findOne({ application: application._id });
  if (payment) {
    payment.receipt = application.receipt;
    payment.studentName = application.displayName();
    payment.programme = application.form.preferredCourse;
    payment.course = application.course;
    // A "Request info" round trip can change the course, and with it the fee. An
    // approved payment keeps the amount it was approved for — reopening a settled
    // figure is an accounting problem, not a form one.
    if (payment.status !== PAYMENT_STATUS.APPROVED) {
      payment.amount = courseFee(application.form.preferredCourse);
    }
    if (payment.status === PAYMENT_STATUS.REJECTED) {
      // A fresh receipt deserves a fresh look.
      payment.status = PAYMENT_STATUS.PENDING;
      payment.reviewedAt = undefined;
      payment.reviewedBy = undefined;
      payment.reviewNote = undefined;
    }
    await payment.save();
  } else {
    const { paymentId, receiptNumber } = await generatePaymentReferences();
    payment = await Payment.create({
      paymentId,
      receiptNumber,
      user: req.user._id,
      application: application._id,
      course: application.course,
      studentName: application.displayName(),
      programme: application.form.preferredCourse,
      // The fee of the course they actually picked, not a flat rate — the three
      // programmes are priced separately in constants.js, and the figure quoted on
      // the course card has to be the figure the admin is asked to reconcile.
      amount: courseFee(application.form.preferredCourse),
      receipt: application.receipt,
      paidAt: new Date(),
    });
  }

  application.payment = payment._id;
  await application.save();

  // Keep the account's intake in step, so the dashboard's "Class of" card is
  // right the moment the application is in.
  if (!req.user.intake?.label) {
    req.user.intake = { code: CURRENT_INTAKE.code, label: CURRENT_INTAKE.label };
    await req.user.save();
  }

  await sendApplicationSubmittedEmail(req.user.email, {
    name: application.form.firstName || req.user.firstName,
    applicationId: application.applicationId,
    programme: application.form.preferredCourse,
  });

  res.status(201).json({
    success: true,
    message: "Your application has been submitted. We will email you once it has been reviewed.",
    application: { ...application.toPublicJSON(), exists: true },
    payment: payment.toStudentJSON(),
  });
});
