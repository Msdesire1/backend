/**
 * Admissions and payment review — the actions behind ApplicantDetailsModal.jsx and
 * PaymentDetailsModal.jsx.
 *
 * Both detail modals pass back the human reference they were rendered with
 * ("APP-1284", "PAY-26041") rather than a Mongo id, so every lookup here accepts
 * either. See `byIdOrReference`.
 *
 * Approving an application is the one place in the system that issues a
 * matriculation number and creates a place on a programme, so it is written to be
 * safe to retry: each step checks whether it has already happened.
 */
import Application from "../models/application.model.js";
import Payment from "../models/payment.model.js";
import Course from "../models/course.model.js";
import Enrollment from "../models/enrollment.model.js";
import User from "../models/user.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { generateStudentId } from "../utils/ids.js";
import { byIdOrReference } from "../services/stats.service.js";
import { findActiveEnrollment } from "../services/course.service.js";
import { parsePaging } from "./admin.controller.js";
import {
  sendApplicationApprovedEmail,
  sendApplicationInfoRequestedEmail,
  sendApplicationRejectedEmail,
  sendPaymentApprovedEmail,
  sendPaymentRejectedEmail,
} from "../utils/email.js";
import {
  APPLICATION_STATUS,
  APPLICATION_STATUSES,
  CURRENT_INTAKE,
  ENROLLMENT_STATUS,
  PAYMENT_STATUS,
  PAYMENT_STATUSES,
  formatNaira,
} from "../config/constants.js";

const clean = (value) => (typeof value === "string" ? value.trim() : "");

/** Case-insensitive contains, with regex metacharacters neutralised. */
const searchPattern = (term) =>
  new RegExp(String(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

/* -------------------------------------------------------------- admissions -- */

/** GET /api/admin/applications */
export const listApplications = asyncHandler(async (req, res) => {
  const { limit, page, skip } = parsePaging(req.query);
  const filter = {};

  const status = clean(req.query.status);
  if (status && status !== "All") {
    if (!APPLICATION_STATUSES.includes(status)) {
      throw ApiError.badRequest(
        `Unknown status "${status}". Expected one of: ${APPLICATION_STATUSES.join(", ")}.`,
      );
    }
    filter.status = status;
  } else if (!status) {
    // Drafts are half-typed forms, not submissions — they would only clutter the
    // queue. `?status=Draft` still returns them for anyone who wants to look.
    filter.status = { $ne: APPLICATION_STATUS.DRAFT };
  }

  const intake = clean(req.query.intake);
  if (intake) filter["intake.adminLabel"] = intake;

  const search = clean(req.query.search);
  if (search) {
    const pattern = searchPattern(search);
    filter.$or = [
      { applicationId: pattern },
      { "form.firstName": pattern },
      { "form.lastName": pattern },
      { "form.email": pattern },
      { "form.phone": pattern },
    ];
  }

  const [applications, total] = await Promise.all([
    Application.find(filter).sort({ submittedAt: -1, createdAt: -1 }).skip(skip).limit(limit),
    Application.countDocuments(filter),
  ]);

  const payments = await Payment.find({
    application: { $in: applications.map((application) => application._id) },
  });
  const byApplication = new Map(payments.map((payment) => [String(payment.application), payment]));

  res.json({
    success: true,
    applications: applications.map((application) =>
      application.toAdminJSON(byApplication.get(String(application._id)) || null),
    ),
    statuses: APPLICATION_STATUSES,
    pagination: { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) },
  });
});

const findApplicationOr404 = async (idOrReference) => {
  const application = await Application.findOne(byIdOrReference(idOrReference, "applicationId"));
  if (!application) throw ApiError.notFound("That application could not be found.");
  return application;
};

/** GET /api/admin/applications/:id */
export const getApplicationDetail = asyncHandler(async (req, res) => {
  const application = await findApplicationOr404(req.params.id);
  const [payment, applicant] = await Promise.all([
    Payment.findOne({ application: application._id }),
    User.findById(application.user),
  ]);

  res.json({
    success: true,
    // The modal's summary row and the full form, so one request serves both the
    // quick look and a full read-through.
    summary: application.toAdminJSON(payment),
    application: application.toPublicJSON(),
    payment: payment ? payment.toAdminJSON() : null,
    account: applicant ? applicant.toPublicJSON() : null,
  });
});

/**
 * Give the student their matriculation number and their place on the programme.
 *
 * Written as a series of "has this happened yet?" checks rather than a single
 * transaction. MongoDB transactions need a replica set, which a small
 * single-node deployment will not have, and re-running this is harmless: the
 * student ID is only generated when absent, and the enrollment index makes a
 * duplicate place impossible.
 */
const grantAdmission = async (application) => {
  const applicant = await User.findById(application.user);
  if (!applicant) {
    throw ApiError.conflict(
      "The account behind this application no longer exists, so it cannot be approved.",
    );
  }

  // The course was resolved from form.preferredCourse at submit time; fall back to
  // resolving it again in case the applicant changed their choice after a
  // "Request info" round trip.
  //
  // Resolved up here, before anything is written, so that the refusal below leaves
  // no half-approved record behind — no student id issued, no registration flag set.
  const course =
    (application.course && (await Course.findById(application.course))) ||
    (await Course.findOne({ name: application.form?.preferredCourse }));

  // One course at a time, the same rule /api/courses/:code/enroll enforces. An
  // approval is the other way an enrollment comes into being, so without this check
  // the invariant would hold for students and quietly not for admins.
  //
  // The blocking course is named because the admin is the one who can clear it:
  // mark the old place completed or withdrawn, then approve.
  if (course) {
    const active = await findActiveEnrollment(applicant._id);
    if (active && String(active.course?._id || active.course) !== String(course._id)) {
      throw ApiError.conflict(
        `This applicant is already taking the ${active.course?.name || "another course"}. Mark that enrollment completed or withdrawn before approving them for the ${course.name} — students may only take one course at a time.`,
      );
    }
  }

  let issuedStudentId = false;
  if (!applicant.studentId) {
    applicant.studentId = await generateStudentId();
    issuedStudentId = true;
  }
  applicant.registrationComplete = true;
  applicant.intake = {
    code: application.intake?.code || CURRENT_INTAKE.code,
    label: application.intake?.label || CURRENT_INTAKE.label,
  };
  await applicant.save({ validateModifiedOnly: true });

  let enrollment = null;
  if (course) {
    application.course = course._id;
    enrollment = await Enrollment.findOneAndUpdate(
      { user: applicant._id, course: course._id },
      {
        $setOnInsert: {
          user: applicant._id,
          course: course._id,
          status: ENROLLMENT_STATUS.ACTIVE,
          intake: {
            code: application.intake?.code || CURRENT_INTAKE.code,
            label: application.intake?.label || CURRENT_INTAKE.label,
          },
          enrolledAt: new Date(),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    // A previously withdrawn place is reactivated rather than duplicated.
    if (enrollment.status === ENROLLMENT_STATUS.WITHDRAWN) {
      enrollment.status = ENROLLMENT_STATUS.ACTIVE;
      await enrollment.save();
    }
  }

  return { applicant, course, enrollment, issuedStudentId };
};

/**
 * POST /api/admin/applications/:id/decision
 * Body: { decision: "Approved" | "Request info" | "Rejected", note?: string }
 */
export const decideApplication = asyncHandler(async (req, res) => {
  const decision = clean(req.body?.decision);
  const note = clean(req.body?.note);

  const allowed = [
    APPLICATION_STATUS.APPROVED,
    APPLICATION_STATUS.REQUEST_INFO,
    APPLICATION_STATUS.REJECTED,
  ];
  if (!allowed.includes(decision)) {
    throw ApiError.badRequest(`\`decision\` must be one of: ${allowed.join(", ")}.`, {
      code: "INVALID_DECISION",
    });
  }

  // Asking for more information without saying what is missing leaves the
  // applicant staring at their own form with no idea what to change.
  if (decision === APPLICATION_STATUS.REQUEST_INFO && !note) {
    throw ApiError.unprocessable("Tell the applicant what you need from them.", {
      note: "Add a note explaining what is missing.",
    });
  }

  const application = await findApplicationOr404(req.params.id);
  if (application.status === APPLICATION_STATUS.DRAFT) {
    throw ApiError.conflict("This application has not been submitted yet.", {
      code: "APPLICATION_NOT_SUBMITTED",
    });
  }
  if (application.status === decision && decision !== APPLICATION_STATUS.REQUEST_INFO) {
    // Idempotent: a double-click on Approve must not issue a second student ID.
    const payment = await Payment.findOne({ application: application._id });
    return res.json({
      success: true,
      message: `This application is already marked "${decision}".`,
      application: application.toAdminJSON(payment),
    });
  }

  const applicant = await User.findById(application.user);
  const programme = application.form?.preferredCourse || "";
  let outcome = null;

  if (decision === APPLICATION_STATUS.APPROVED) {
    outcome = await grantAdmission(application);
  } else if (
    application.status === APPLICATION_STATUS.APPROVED &&
    decision === APPLICATION_STATUS.REJECTED
  ) {
    // Reversing an approval withdraws the place but keeps the matriculation
    // number. Student IDs get printed, filed and quoted in letters; recycling one
    // would mean two people sharing a number in somebody's records.
    await Enrollment.updateMany(
      { user: application.user, status: ENROLLMENT_STATUS.ACTIVE },
      { $set: { status: ENROLLMENT_STATUS.WITHDRAWN } },
    );
    if (applicant) {
      applicant.registrationComplete = false;
      await applicant.save({ validateModifiedOnly: true });
    }
  }

  application.status = decision;
  application.reviewNote = note;
  application.reviewedAt = new Date();
  application.reviewedBy = req.admin._id;
  await application.save();

  const email = application.form?.email || applicant?.email;
  const name = application.form?.firstName || applicant?.firstName || "there";
  if (email) {
    if (decision === APPLICATION_STATUS.APPROVED) {
      await sendApplicationApprovedEmail(email, {
        name,
        studentId: outcome?.applicant?.studentId,
        programme,
        intake: application.intake?.label || CURRENT_INTAKE.label,
      });
    } else if (decision === APPLICATION_STATUS.REQUEST_INFO) {
      await sendApplicationInfoRequestedEmail(email, { name, note });
    } else {
      await sendApplicationRejectedEmail(email, { name, note });
    }
  }

  const payment = await Payment.findOne({ application: application._id });
  res.json({
    success: true,
    message:
      decision === APPLICATION_STATUS.APPROVED
        ? `Approved. ${name} is now ${outcome?.applicant?.studentId || "registered"}.`
        : decision === APPLICATION_STATUS.REQUEST_INFO
          ? "The applicant has been asked for more information."
          : "Application rejected.",
    application: application.toAdminJSON(payment),
    studentId: outcome?.applicant?.studentId || null,
    issuedStudentId: Boolean(outcome?.issuedStudentId),
    enrolledIn: outcome?.course ? { code: outcome.course.code, name: outcome.course.name } : null,
  });
});

/* ---------------------------------------------------------------- payments -- */

/** GET /api/admin/payments */
export const listPayments = asyncHandler(async (req, res) => {
  const { limit, page, skip } = parsePaging(req.query);
  const filter = {};

  const status = clean(req.query.status);
  if (status && status !== "All") {
    if (!PAYMENT_STATUSES.includes(status)) {
      throw ApiError.badRequest(
        `Unknown status "${status}". Expected one of: ${PAYMENT_STATUSES.join(", ")}.`,
      );
    }
    filter.status = status;
  }

  const search = clean(req.query.search);
  if (search) {
    const pattern = searchPattern(search);
    filter.$or = [{ paymentId: pattern }, { receiptNumber: pattern }, { studentName: pattern }];
  }

  const [payments, total, counts] = await Promise.all([
    Payment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Payment.countDocuments(filter),
    Payment.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
  ]);

  const byStatus = Object.fromEntries(PAYMENT_STATUSES.map((value) => [value, 0]));
  for (const row of counts) if (row._id in byStatus) byStatus[row._id] = row.count;
  const records = Object.values(byStatus).reduce((sum, value) => sum + value, 0);

  res.json({
    success: true,
    payments: payments.map((payment) => payment.toAdminJSON()),
    statuses: PAYMENT_STATUSES,
    // The three cards above the admin payments table.
    summary: {
      records,
      pending: byStatus[PAYMENT_STATUS.PENDING],
      processed: byStatus[PAYMENT_STATUS.APPROVED] + byStatus[PAYMENT_STATUS.REJECTED],
      byStatus,
    },
    pagination: { page, limit, total, pages: Math.max(Math.ceil(total / limit), 1) },
  });
});

const findPaymentOr404 = async (idOrReference) => {
  const reference = clean(idOrReference).toUpperCase();
  const payment =
    (await Payment.findOne(byIdOrReference(idOrReference, "paymentId"))) ||
    // The modal displays the receipt number in its heading, so accept that too.
    (await Payment.findOne({ receiptNumber: reference }));
  if (!payment) throw ApiError.notFound("That payment could not be found.");
  return payment;
};

/** GET /api/admin/payments/:id */
export const getPaymentDetail = asyncHandler(async (req, res) => {
  const payment = await findPaymentOr404(req.params.id);
  const [application, payer] = await Promise.all([
    Application.findById(payment.application),
    User.findById(payment.user),
  ]);

  res.json({
    success: true,
    payment: payment.toAdminJSON(),
    application: application ? application.toAdminJSON(payment) : null,
    account: payer ? payer.toPublicJSON() : null,
  });
});

/**
 * POST /api/admin/payments/:id/decision
 * Body: { status: "Approved" | "Rejected", note?: string }
 *
 * The modal calls this as onUpdateStatus(payment.id, "Approved").
 */
export const decidePayment = asyncHandler(async (req, res) => {
  const status = clean(req.body?.status || req.body?.decision);
  const note = clean(req.body?.note);

  const allowed = [PAYMENT_STATUS.APPROVED, PAYMENT_STATUS.REJECTED];
  if (!allowed.includes(status)) {
    throw ApiError.badRequest(`\`status\` must be one of: ${allowed.join(", ")}.`, {
      code: "INVALID_DECISION",
    });
  }
  // A rejection the student cannot act on is a dead end — they need to know
  // whether to reupload a clearer photo or to pay again.
  if (status === PAYMENT_STATUS.REJECTED && !note) {
    throw ApiError.unprocessable("Say why the receipt was not accepted.", {
      note: "Add a note the student can act on.",
    });
  }

  const payment = await findPaymentOr404(req.params.id);
  if (payment.status === status) {
    return res.json({
      success: true,
      message: `This payment is already marked "${status}".`,
      payment: payment.toAdminJSON(),
    });
  }
  if (status === PAYMENT_STATUS.APPROVED && !payment.receipt) {
    throw ApiError.conflict("There is no receipt attached to this payment yet.", {
      code: "RECEIPT_MISSING",
    });
  }

  payment.status = status;
  payment.reviewNote = note;
  payment.reviewedAt = new Date();
  payment.reviewedBy = req.admin._id;
  await payment.save();

  const payer = await User.findById(payment.user);
  const email = payer?.email;
  const name = payer?.firstName || payment.studentName;
  if (email) {
    if (status === PAYMENT_STATUS.APPROVED) {
      await sendPaymentApprovedEmail(email, {
        name,
        receiptNumber: payment.receiptNumber,
        amount: formatNaira(payment.amount),
        programme: payment.programme,
      });
    } else {
      await sendPaymentRejectedEmail(email, {
        name,
        receiptNumber: payment.receiptNumber,
        note,
      });
    }
  }

  res.json({
    success: true,
    message:
      status === PAYMENT_STATUS.APPROVED
        ? `${payment.receiptNumber} confirmed.`
        : `${payment.receiptNumber} rejected. The student has been asked to reupload.`,
    payment: payment.toAdminJSON(),
  });
});
