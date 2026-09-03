/**
 * The student side of payments — what app/dashboard/user/payments/page.jsx
 * renders, and the one path for replacing a receipt that was rejected.
 *
 * Approving and rejecting payments is an administrator action and lives in
 * admin.controller.js. Nothing here can change a payment's status.
 */
import Payment from "../models/payment.model.js";
import Application from "../models/application.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { deleteFile, uploadBuffer } from "../config/gridfs.js";
import {
  BANK_DETAILS,
  COURSE_FEE_NAIRA,
  PAYMENT_STATUS,
  RECEIPT_MIME_TYPES,
  formatNaira,
} from "../config/constants.js";

/**
 * GET /api/payments/me
 *
 * `payment` is the single record the payments page shows; `payments` is the full
 * history, so the page can grow into a list without an API change. Both are
 * pre-formatted display strings — "₦3,000", "10 Aug 2026" — matching what the
 * page currently hardcodes.
 */
export const getMyPayments = asyncHandler(async (req, res) => {
  const payments = await Payment.find({ user: req.user._id }).sort({ createdAt: -1 });
  const rows = payments.map((payment) => payment.toStudentJSON());

  res.json({
    success: true,
    payment: rows[0] || null,
    payments: rows,
    summary: {
      amountPaid: rows.length ? rows[0].amount : "—",
      course: rows.length ? rows[0].course : "Not registered",
      status: rows.length ? rows[0].status : "No payment",
    },
    fee: { amount: COURSE_FEE_NAIRA, display: formatNaira(COURSE_FEE_NAIRA) },
    bank: { ...BANK_DETAILS, amountDisplay: formatNaira(BANK_DETAILS.amount) },
  });
});

/**
 * PUT /api/payments/me/receipt
 *
 * Replaces the receipt on the applicant's payment and puts it back in the review
 * queue. Deliberately not gated on the application's status: if a payment was
 * rejected because the receipt was blurred, the applicant must be able to fix it
 * whatever state their admission is in — otherwise there is no way out but a
 * phone call.
 */
export const replaceMyReceipt = asyncHandler(async (req, res) => {
  const file = req.files?.receipt;
  if (!file) {
    throw ApiError.unprocessable("Please attach your payment receipt.", {
      receipt: "This file is required.",
    });
  }
  if (!RECEIPT_MIME_TYPES.includes(file.contentType)) {
    throw ApiError.unsupportedMediaType("The receipt must be a PNG, JPG or PDF file.");
  }

  const payment = await Payment.findOne({ user: req.user._id }).sort({ createdAt: -1 });
  if (!payment) {
    throw ApiError.notFound(
      "You do not have a payment record yet. Submit your application first.",
    );
  }
  if (payment.status === PAYMENT_STATUS.APPROVED) {
    throw new ApiError(409, "This payment has already been confirmed.", {
      code: "PAYMENT_ALREADY_APPROVED",
    });
  }

  const stored = await uploadBuffer({
    buffer: file.buffer,
    filename: file.filename,
    contentType: file.contentType,
    metadata: { user: req.user._id, application: payment.application, kind: "receipt" },
  });

  const previous = payment.receipt?.fileId;
  payment.receipt = stored;
  payment.status = PAYMENT_STATUS.PENDING;
  payment.paidAt = new Date();
  payment.reviewedAt = undefined;
  payment.reviewedBy = undefined;
  payment.reviewNote = undefined;
  await payment.save();

  // Keep the application's copy in step so the admissions modal shows the same file.
  await Application.updateOne({ _id: payment.application }, { $set: { receipt: stored } });

  if (previous) {
    deleteFile(previous).catch((error) =>
      console.error(`[gridfs] could not remove replaced receipt: ${error.message}`),
    );
  }

  res.json({
    success: true,
    message: "Your new receipt has been uploaded and is awaiting review.",
    payment: payment.toStudentJSON(),
  });
});
