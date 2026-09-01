/**
 * Human-readable reference generators.
 *
 * Formats are taken from the dashboard mock data so existing screens keep
 * rendering identically:
 *   WOF/26/01482  student ID   (UserDashboard.jsx)
 *   APP-1284      application  (admin/admissions/page.jsx)
 *   PAY-26041     payment      (admin/payments/page.jsx)
 *   RCT-26041     receipt      (PaymentDetailsModal.jsx)
 */
import { nextSequence } from "../models/counter.model.js";
import { STUDENT_ID_PREFIX } from "../config/constants.js";

const twoDigitYear = (year = new Date().getFullYear()) => String(year).slice(-2);
const pad = (value, length) => String(value).padStart(length, "0");

/** "WOF/26/01482" — one sequence per calendar year. */
export const generateStudentId = async (year = new Date().getFullYear()) => {
  const sequence = await nextSequence(`student:${year}`);
  return `${STUDENT_ID_PREFIX}/${twoDigitYear(year)}/${pad(sequence, 5)}`;
};

/** "APP-1284" — a single running sequence across intakes. */
export const generateApplicationId = async () => {
  const sequence = await nextSequence("application");
  return `APP-${pad(sequence, 4)}`;
};

/**
 * "PAY-26041" plus the matching "RCT-26041". Both share one numeric part so a
 * receipt can always be traced back to its payment at a glance.
 */
export const generatePaymentReferences = async (year = new Date().getFullYear()) => {
  const sequence = await nextSequence(`payment:${year}`);
  const numericPart = `${twoDigitYear(year)}${pad(sequence, 3)}`;
  return { paymentId: `PAY-${numericPart}`, receiptNumber: `RCT-${numericPart}` };
};

/** "CERT-26-0001" — one sequence per calendar year. */
export const generateCertificateNumber = async (year = new Date().getFullYear()) => {
  const sequence = await nextSequence(`certificate:${year}`);
  return `CERT-${twoDigitYear(year)}-${pad(sequence, 4)}`;
};
