import mongoose from "mongoose";
import fileRefSchema, { toFileJSON } from "./fileRef.schema.js";
import {
  APPLICATION_STATUS,
  APPLICATION_STATUSES,
  CURRENT_INTAKE,
  FORM_OPTIONS,
  MAX_APPLICATION_STEPS,
  PAYMENT_STATUS,
  formatIsoDate,
  needsLeadershipStep,
  shortProgrammeName,
  stepsForCourse,
} from "../config/constants.js";

/**
 * The WOFBI student application.
 *
 * Field names mirror `initialForm` in
 * app/dashboard/user/_components/CourseEnrollment.jsx one-for-one, so the wizard
 * can POST its state object unchanged and prefill from the response unchanged.
 *
 * Two deliberate choices:
 *
 * 1. Date-like fields are stored as "YYYY-MM-DD" strings, not Dates. The form
 *    binds them to <input type="date">, which only accepts that exact format —
 *    round-tripping strings means a saved draft repopulates perfectly, with no
 *    timezone drift shifting someone's date of birth by a day.
 *
 * 2. Nothing inside `form` is required at the schema level. The wizard saves a
 *    partial draft at every step, so required-field enforcement happens once, in
 *    the controller, at submit time — and which fields those are depends on the
 *    course, so it reads `requiredFieldsForCourse(form.preferredCourse)` rather
 *    than one fixed list.
 */

const DATE_STRING = {
  validator: (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value),
  message: "Use the YYYY-MM-DD date format.",
};

/** Allows "" (an untouched draft field) alongside the real options. */
const optional = (values) => [...values, ""];

const text = (maxlength) => ({ type: String, trim: true, default: "", maxlength });
const dateText = () => ({ type: String, trim: true, default: "", validate: DATE_STRING });
const choice = (values) => ({ type: String, trim: true, default: "", enum: optional(values) });

const applicationFormSchema = new mongoose.Schema(
  {
    /* --------------------------------------- step 1: choose your course ----- */
    /**
     * First, not last. The programme decides which steps follow — LCC and LDC add
     * a leadership section — and it is what puts the fee and the length of the
     * course in front of the applicant before they fill anything in.
     */
    preferredCourse: choice(FORM_OPTIONS.preferredCourse),

    /* -------------------------------------------- step 2: personal details -- */
    title: choice(FORM_OPTIONS.title),
    firstName: text(60),
    lastName: text(60),
    email: { type: String, trim: true, lowercase: true, default: "", maxlength: 160 },
    phone: text(30),
    gender: choice(FORM_OPTIONS.gender),
    dateOfBirth: dateText(),
    placeOfBirth: text(120),
    nativeTown: text(120),
    state: text(80),
    country: text(80),
    address: text(400),
    maritalStatus: choice(FORM_OPTIONS.maritalStatus),
    // <input type="number"> arrives as a string; keep it a string but reject junk.
    children: {
      type: String,
      trim: true,
      default: "",
      validate: {
        validator: (value) => !value || /^\d{1,2}$/.test(value),
        message: "Enter the number of children as a whole number.",
      },
    },
    understandsEnglish: choice(FORM_OPTIONS.yesNo),
    writesEnglish: choice(FORM_OPTIONS.yesNo),
    languages: text(200),

    /* ------------------------------- step 3: work, education & health ------ */
    workplace: text(160),
    position: text(120),
    employmentDate: dateText(),
    occupation: text(120),
    specialSkills: text(600),
    schoolType: text(120),
    schoolName: text(160),
    // Free text on the form ("2014 - 2018"), not a date input.
    dateAttended: text(80),
    certificate: text(160),
    physicalDefects: choice(FORM_OPTIONS.yesNo),
    defectDetails: text(400),

    /* ----------------------------------- step 4: spiritual information ----- */
    bornAgainDate: dateText(),
    waterBaptized: choice(FORM_OPTIONS.yesNo),
    waterBaptizedDate: dateText(),
    holySpiritBaptized: choice(FORM_OPTIONS.yesNo),
    holySpiritBaptizedDate: dateText(),
    discipleshipClass: choice(FORM_OPTIONS.yesNo),
    discipleshipChurch: text(160),
    discipleshipDate: dateText(),
    bibleTraining: choice(FORM_OPTIONS.yesNo),
    trainingName: text(160),
    trainingCertificates: text(600),
    wofbiReason: text(1500),
    afterCoursePlan: text(1500),
    christianService: text(1500),

    /* ------------------- step 5: leadership & ministry (LCC and LDC only) --- */
    /**
     * Only asked of Leadership Certificate and Leadership Diploma applicants. A
     * Basic Certificate applicant is often new to the church and has none of this
     * to give, which is why the step is skipped for them rather than left blank.
     *
     * These stay optional at the schema level like every other field here — the
     * draft saves half-finished — and are enforced at submit time by
     * `requiredFieldsForCourse`, which only adds them for the two courses.
     */
    currentOffice: text(160),
    serviceYears: choice(FORM_OPTIONS.serviceYears),
    churchDepartment: choice(FORM_OPTIONS.churchDepartment),
    previousLeadershipTraining: choice(FORM_OPTIONS.yesNo),
    previousTrainingDetails: text(600),
    ministryExperience: text(1500),
    refereeName: text(120),
    refereeOffice: text(160),
    refereeContact: text(160),

    /* --------------------------------------------- final step: declaration -- */
    pastorNameAddress: text(600),
    churchSponsorship: choice(FORM_OPTIONS.yesNo),
    declarationName: text(120),
    declarationDate: dateText(),
  },
  { _id: false },
);

const applicationSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true, // one application per account; re-submitting edits the same record
    },
    // "APP-1284". Assigned on submit, so drafts don't consume reference numbers.
    applicationId: { type: String, trim: true, unique: true, sparse: true },
    status: { type: String, enum: APPLICATION_STATUSES, default: APPLICATION_STATUS.DRAFT },

    form: { type: applicationFormSchema, default: () => ({}) },

    /**
     * Highest wizard step reached, so "Continue registration" resumes in place.
     *
     * The ceiling is the longest wizard any course has, not the length of this
     * applicant's own: someone who filled in the leadership step for LCC and then
     * switched to BCC would otherwise be carrying a `furthestStep` their new,
     * shorter form cannot validate. The controller clamps it to the real step
     * count when it reads it back.
     */
    furthestStep: { type: Number, default: 0, min: 0, max: MAX_APPLICATION_STEPS - 1 },

    photo: { type: fileRefSchema, default: null },
    receipt: { type: fileRefSchema, default: null },

    intake: {
      code: { type: String, trim: true, default: CURRENT_INTAKE.code },
      label: { type: String, trim: true, default: CURRENT_INTAKE.label },
      adminLabel: { type: String, trim: true, default: CURRENT_INTAKE.adminLabel },
    },

    /** Resolved from form.preferredCourse on submit. */
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", default: null },
    payment: { type: mongoose.Schema.Types.ObjectId, ref: "Payment", default: null },

    submittedAt: { type: Date },
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin" },
    /** Admin note — shown to the applicant when status is "Request info" or "Rejected". */
    reviewNote: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

// Admin admissions list sorts newest-first and filters by status.
applicationSchema.index({ status: 1, submittedAt: -1 });
applicationSchema.index({ createdAt: -1 });

applicationSchema.virtual("isSubmitted").get(function isSubmitted() {
  return this.status !== APPLICATION_STATUS.DRAFT;
});

/** Full name including title, the way the dashboard and admin tables display it. */
applicationSchema.methods.displayName = function displayName() {
  const { title, firstName, lastName } = this.form || {};
  return [title, firstName, lastName].filter(Boolean).join(" ").trim();
};

/**
 * The exact object the enrollment wizard keeps in React state, so the client can
 * do `setForm(response.application.form)` with no mapping layer.
 */
applicationSchema.methods.toFormJSON = function toFormJSON() {
  const form = this.form?.toObject ? this.form.toObject() : { ...(this.form || {}) };
  return {
    ...form,
    // The frontend's own localStorage keys, preserved for drop-in compatibility.
    applicationComplete: this.status !== APPLICATION_STATUS.DRAFT,
    receiptName: this.receipt?.filename || "",
  };
};

/**
 * The row shape admin/admissions/page.jsx renders, plus the extra fields
 * ApplicantDetailsModal.jsx reads. `id` is the "APP-1284" reference rather than
 * the ObjectId because the table keys on it and passes it back to the modal.
 *
 * `payment` is passed in rather than populated here: the admissions list loads
 * every applicant's payment in one query, and a method that lazily fetched its
 * own would turn that into one query per row.
 */
applicationSchema.methods.toAdminJSON = function toAdminJSON(payment = null) {
  const paymentLabel = () => {
    if (!payment) return "Not paid";
    // The table's green pill is keyed on the literal word "Paid".
    if (payment.status === PAYMENT_STATUS.APPROVED) return "Paid";
    return payment.status; // "Pending" | "Rejected"
  };

  return {
    id: this.applicationId || String(this._id),
    name: this.displayName() || "—",
    programme: shortProgrammeName(this.form?.preferredCourse),
    intake: this.intake?.adminLabel || CURRENT_INTAKE.adminLabel,
    status: this.status,
    email: this.form?.email || "",
    phone: this.form?.phone || "",
    payment: paymentLabel(),
    // "2026-07-18" — the Registration column on the admin overview.
    registeredOn: this.submittedAt ? formatIsoDate(this.submittedAt) : formatIsoDate(this.createdAt),
    photo: toFileJSON(this.photo),
    receipt: toFileJSON(this.receipt),
    reviewNote: this.reviewNote || null,
    raw: {
      _id: this._id,
      user: this.user,
      course: this.course,
      submittedAt: this.submittedAt || null,
      reviewedAt: this.reviewedAt || null,
      programme: this.form?.preferredCourse || "",
    },
  };
};

applicationSchema.methods.toPublicJSON = function toPublicJSON() {
  // The step list follows the chosen course, and so does the ceiling on
  // `furthestStep` — switching from LCC down to BCC drops a step, and a stored
  // progress marker past the new end would strand the wizard on a step that no
  // longer exists.
  const steps = stepsForCourse(this.form?.preferredCourse);
  return {
    id: this._id,
    applicationId: this.applicationId || null,
    status: this.status,
    form: this.toFormJSON(),
    furthestStep: Math.min(this.furthestStep ?? 0, steps.length - 1),
    steps,
    /** Lets the client show the leadership fields without duplicating the rule. */
    hasLeadershipStep: needsLeadershipStep(this.form?.preferredCourse),
    photo: toFileJSON(this.photo),
    receipt: toFileJSON(this.receipt),
    intake: this.intake,
    reviewNote: this.reviewNote || null,
    submittedAt: this.submittedAt || null,
    reviewedAt: this.reviewedAt || null,
    createdAt: this.createdAt,
    updatedAt: this.updatedAt,
  };
};

export default mongoose.model("Application", applicationSchema);
