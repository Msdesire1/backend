/**
 * Single source of truth for values the dashboard renders.
 *
 * The frontend (lfc/app/dashboard/**) currently hardcodes these strings. Every
 * label, enum option and format below is copied verbatim from those components
 * so the API can replace the mock data without touching a single .jsx file.
 */

export const DB_NAME = "main";

/* ------------------------------------------------------------------ money -- */

// The dashboard shows "₦3,000" for the WOFBI registration fee.
export const COURSE_FEE_NAIRA = 3000;
export const CURRENCY_SYMBOL = "₦";

/** 3000 -> "₦3,000" — matches COURSE_FEE in app/dashboard/user/payments/page.jsx */
export const formatNaira = (amount) =>
  `${CURRENCY_SYMBOL}${Number(amount || 0).toLocaleString("en-NG")}`;

/** 18400000 -> "₦18.4m" — matches the Revenue KPI card in admin/page.jsx */
export const formatCompactNaira = (amount) => {
  const value = Number(amount || 0);
  if (value >= 1_000_000) return `${CURRENCY_SYMBOL}${(value / 1_000_000).toFixed(1)}m`;
  if (value >= 1_000) return `${CURRENCY_SYMBOL}${(value / 1_000).toFixed(1)}k`;
  return formatNaira(value);
};

/* ------------------------------------------------------------------ dates -- */

/** Date -> "10 Aug 2026" — the format admin/payments/page.jsx displays. */
export const formatDisplayDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

/**
 * Date -> "2026-07-18" — the format admin/page.jsx recentRegistrations uses.
 *
 * Built from the local calendar fields rather than `toISOString().slice(0, 10)`.
 * Lagos is UTC+1, so a registration made at half past midnight would come back
 * from `toISOString` as the previous day — and then disagree with the
 * `formatDisplayDate` of the very same timestamp. Two date formatters that
 * describe different days is the kind of bug that gets found in a support call.
 *
 * Attendance dates are the exception and are handled separately: those are stored
 * normalised to UTC midnight on purpose (see models/attendance.model.js), so the
 * register formats them with `toISOString` to keep the round trip exact.
 */
export const formatIsoDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return toLocalIsoDate(date);
};

/** Local-calendar "YYYY-MM-DD", with no timezone shift. */
export const toLocalIsoDate = (date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");

/** Date -> "Fri, 27 Mar" — the assignment due-date format in UserDashboard.jsx. */
export const formatDueDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short" });
};

/** "In 4 days" / "Due today" / "Overdue" — the amber pill in UserDashboard.jsx. */
export const formatRelativeDue = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const startOfDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  if (days < 0) return days === -1 ? "Overdue by 1 day" : `Overdue by ${Math.abs(days)} days`;
  if (days === 0) return "Due today";
  if (days === 1) return "In 1 day";
  return `In ${days} days`;
};

/** "2 minutes ago" — the notification timestamps in admin/page.jsx. */
export const formatTimeAgo = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const units = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [label, size] of units) {
    const amount = Math.floor(seconds / size);
    if (amount >= 1) return `${amount} ${label}${amount === 1 ? "" : "s"} ago`;
  }
  return "Just now";
};

/* ---------------------------------------------------------------- statuses -- */

// admin/admissions/page.jsx renders these exact status strings.
export const APPLICATION_STATUS = {
  DRAFT: "Draft",
  REVIEW: "Review",
  REQUEST_INFO: "Request info",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};
export const APPLICATION_STATUSES = Object.values(APPLICATION_STATUS);

// admin/payments/page.jsx + PaymentDetailsModal.jsx drive off these.
export const PAYMENT_STATUS = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected" };
export const PAYMENT_STATUSES = Object.values(PAYMENT_STATUS);

export const PAYMENT_METHOD = { BANK_TRANSFER: "Bank transfer" };
export const PAYMENT_METHODS = Object.values(PAYMENT_METHOD);

export const ATTENDANCE_STATUS = { PRESENT: "Present", ABSENT: "Absent", EXCUSED: "Excused" };
export const ATTENDANCE_STATUSES = Object.values(ATTENDANCE_STATUS);

export const ENROLLMENT_STATUS = {
  ACTIVE: "Active",
  COMPLETED: "Completed",
  WITHDRAWN: "Withdrawn",
};
export const ENROLLMENT_STATUSES = Object.values(ENROLLMENT_STATUS);

export const ADMIN_ROLE = { ADMIN: "admin", SUPER_ADMIN: "super_admin" };
export const ADMIN_ROLES = Object.values(ADMIN_ROLE);

/* ----------------------------------------------------------------- courses -- */

/**
 * The three WOFBI programmes, copied from the `courses` array in
 * app/dashboard/user/_components/CourseEnrollment.jsx. `accent` and
 * `lockedMessage` are included so the API can serve the card verbatim.
 *
 * !! CONFIRM THE FEES AND DURATIONS BEFORE LAUNCH !!
 *
 * `feeNaira` and `duration` are shown to applicants on the course-choice step, so
 * they must be the institute's real figures. What is below is the best available
 * information and no more: the ₦3,000 is the single registration fee the
 * dashboard has always displayed, repeated per course because no other figure
 * existed, and only the BCC duration ("Two-week intensive") came from the
 * original design — the LCC and LDC lengths are estimates.
 *
 * This table is the only place either value is written. Change it here, re-run
 * `npm run seed`, and the API, the course cards and the payment panel all follow.
 */
export const COURSES = [
  {
    code: "BCC",
    name: "Basic Certificate Course",
    period: "Two-week intensive",
    duration: "2 weeks",
    feeNaira: 3000,
    description:
      "Build a solid foundation in the Word and develop habits for victorious living.",
    availableMessage: "Available now",
    lockedMessage: "Complete the previous course first",
    accent: "border-red-500 bg-red-50",
    order: 1,
    requiresCourseCode: null,
  },
  {
    code: "LCC",
    name: "Leadership Certificate Course",
    period: "Next level",
    duration: "6 weeks",
    feeNaira: 3000,
    description:
      "Deepen your understanding of leadership, stewardship, and ministry service.",
    availableMessage: "Available now",
    lockedMessage: "Complete Basic Certificate first",
    accent: "border-amber-300 bg-amber-50",
    order: 2,
    requiresCourseCode: "BCC",
  },
  {
    code: "LDC",
    name: "Leadership Diploma Course",
    period: "Advanced level",
    duration: "12 weeks",
    feeNaira: 3000,
    description:
      "A deeper equipping programme for leaders pursuing excellence in every sphere.",
    availableMessage: "Available now",
    lockedMessage: "Available after Leadership Certificate",
    accent: "border-slate-200 bg-slate-50",
    order: 3,
    requiresCourseCode: "LCC",
  },
];

export const COURSE_NAMES = COURSES.map((course) => course.name);

/**
 * Look a course up by either identifier, because the two halves of the app hold
 * different ones: the application form stores `preferredCourse` as the full name
 * ("Leadership Certificate Course") since that is what the select posts, while
 * enrollments, prerequisites and the seed all work in codes ("LCC").
 */
export const findCourse = (codeOrName) => {
  const key = String(codeOrName || "").trim();
  if (!key) return null;
  return (
    COURSES.find((course) => course.code === key.toUpperCase()) ||
    COURSES.find((course) => course.name.toLowerCase() === key.toLowerCase()) ||
    null
  );
};

/** The fee for one programme, falling back to the flat fee for anything unknown. */
export const courseFee = (codeOrName) =>
  findCourse(codeOrName)?.feeNaira ?? COURSE_FEE_NAIRA;

/** "Basic Certificate Course" -> "Basic Certificate" (admin tables shorten it). */
export const shortProgrammeName = (courseName) =>
  String(courseName || "").replace(/\s*Course$/, "").replace(/^Leadership Certificate$/, "Leadership");

/* ------------------------------------------------------- application form -- */

/**
 * Select options for the enrollment form. Values match the `options` arrays in
 * CourseEnrollment.jsx exactly, including capitalisation and trailing dots —
 * the form posts these strings straight through, so the schema must accept them.
 */
export const FORM_OPTIONS = {
  title: ["Mr.", "Mrs.", "Miss", "Dr.", "Pastor", "Dcn.", "Dcnss."],
  gender: ["Male", "Female"],
  maritalStatus: ["Single", "Engaged", "Married", "Separated", "Divorced", "Widow", "Widower"],
  yesNo: ["Yes", "No"],
  preferredCourse: COURSE_NAMES,
  // Leadership step (LCC and LDC only). Ranges rather than a free-text number:
  // they are easier to answer honestly and far easier to report on.
  serviceYears: ["Under 1 year", "1 - 2 years", "3 - 5 years", "6 - 10 years", "Over 10 years"],
  churchDepartment: [
    "Choir / Music",
    "Ushering",
    "Protocol",
    "Children",
    "Teens / Youth",
    "Evangelism",
    "Media / Technical",
    "Sanctuary Keeping",
    "Welfare",
    "Prayer",
    "Drama",
    "Transport",
    "Other",
  ],
};

/**
 * Fields the frontend marks with a red asterisk, grouped by the step they sit on.
 *
 * `preferredCourse` leads because the course choice now comes first in the wizard:
 * LCC and LDC ask for a leadership section that BCC does not, so the form cannot
 * know which steps to show until the applicant has picked. It also means the fee
 * and the length of the programme are the first things they see.
 */
export const REQUIRED_APPLICATION_FIELDS = [
  // Step 1 — Choose your course
  "preferredCourse",
  // Step 2 — Personal details
  "title", "gender", "firstName", "lastName", "email", "phone",
  "dateOfBirth", "placeOfBirth", "nativeTown", "state", "country",
  "maritalStatus", "languages", "address", "understandsEnglish", "writesEnglish",
  // Step 3 — Work, education & health
  "occupation", "schoolType", "schoolName", "dateAttended", "certificate", "physicalDefects",
  // Step 4 — Spiritual information
  "bornAgainDate", "waterBaptized", "holySpiritBaptized", "discipleshipClass",
  "bibleTraining", "wofbiReason", "afterCoursePlan", "christianService",
  // Final step — Declaration
  "pastorNameAddress", "churchSponsorship",
  "declarationName", "declarationDate",
];

/**
 * The extra step LCC and LDC applicants fill in.
 *
 * Both are leadership programmes, so the institute needs to see where the
 * applicant already serves and who can vouch for them — a Basic Certificate
 * applicant is often new to the church and has none of this to give.
 */
export const LEADERSHIP_STEP = "Leadership & ministry service";

/** Course codes whose paperwork includes the leadership step. */
export const LEADERSHIP_COURSE_CODES = ["LCC", "LDC"];

export const LEADERSHIP_REQUIRED_FIELDS = [
  "currentOffice", "serviceYears", "churchDepartment",
  "previousLeadershipTraining", "ministryExperience",
  "refereeName", "refereeOffice", "refereeContact",
];

/** Every field on the leadership step, required or not. */
export const LEADERSHIP_FIELDS = [
  ...LEADERSHIP_REQUIRED_FIELDS,
  "previousTrainingDetails", // only asked when previousLeadershipTraining is "Yes"
];

/** The steps every applicant fills in, in order. */
const BASE_APPLICATION_STEPS = [
  "Choose your course",
  "Personal details",
  "Work, education & health",
  "Spiritual information",
  "Declaration",
];

export const needsLeadershipStep = (codeOrName) =>
  LEADERSHIP_COURSE_CODES.includes(findCourse(codeOrName)?.code);

/**
 * The wizard steps for one course. The leadership step goes in second-to-last,
 * ahead of the declaration — signing off on the form should stay the last thing
 * that happens.
 */
export const stepsForCourse = (codeOrName) => {
  const steps = [...BASE_APPLICATION_STEPS];
  if (needsLeadershipStep(codeOrName)) steps.splice(steps.length - 1, 0, LEADERSHIP_STEP);
  return steps;
};

/** Everything a course requires before it can be submitted. */
export const requiredFieldsForCourse = (codeOrName) =>
  needsLeadershipStep(codeOrName)
    ? [...REQUIRED_APPLICATION_FIELDS, ...LEADERSHIP_REQUIRED_FIELDS]
    : [...REQUIRED_APPLICATION_FIELDS];

/**
 * Per-course step lists and required fields, ready to serve to the client so the
 * wizard never has to reimplement the rules above. Keyed by course code.
 */
export const APPLICATION_RULES_BY_COURSE = Object.fromEntries(
  COURSES.map((course) => [
    course.code,
    { steps: stepsForCourse(course.code), requiredFields: requiredFieldsForCourse(course.code) },
  ]),
);

/** The default (shortest) step list, for a draft with no course picked yet. */
export const APPLICATION_STEPS = BASE_APPLICATION_STEPS;

/** Upper bound for `furthestStep`, taken from the longest wizard any course has. */
export const MAX_APPLICATION_STEPS = BASE_APPLICATION_STEPS.length + 1;

/* ------------------------------------------------------------- file rules -- */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // "maximum 5 MB" per the form copy
export const PHOTO_MIME_TYPES = ["image/png", "image/jpeg"];
export const RECEIPT_MIME_TYPES = ["image/png", "image/jpeg", "application/pdf"];
export const GRIDFS_BUCKET = "uploads";

/* ------------------------------------------------------------ institution -- */

/** Bank details rendered in the UserDashboard.jsx payment card. */
export const BANK_DETAILS = {
  accountName: "Living Faith Church",
  bankName: "Access Bank",
  accountNumber: "0123456789",
  amount: COURSE_FEE_NAIRA,
};

/** The "Covenant Practice" class card in UserDashboard.jsx. */
export const CLASS_SCHEDULE = {
  title: "Covenant Practice",
  startTime: "7:00 AM",
  endTime: "3:00 PM",
  days: "Monday-Friday",
  venue: "Winners Chapel New Jerusalem Church, Gaa-imam Ilorin, Kwara state",
};

/** Current intake. "Spring 2026" is the student-facing label, "Aug 2026" the admin one. */
export const CURRENT_INTAKE = {
  code: "SPRING2026",
  label: "Spring 2026",
  adminLabel: "Aug 2026",
  year: 2026,
};

/** The four milestones in app/dashboard/user/overview/page.jsx. */
export const MILESTONE_NAMES = [
  "Application submitted",
  "Payment confirmed",
  "Coursework complete",
  "Graduation",
];

export const STUDENT_ID_PREFIX = "WOF";
