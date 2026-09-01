/**
 * The Express application: middleware, routers, and the error handler.
 *
 * Kept separate from index.js so the app can be imported and exercised without
 * opening a port or connecting to a database — which is exactly what
 * tests/smoke.test.mjs does.
 */
import express from "express";
import cors from "./middleware/cors.middleware.js";
import ApiError from "./utils/ApiError.js";

import authRouter from "./routes/auth.routes.js";
import dashboardRouter from "./routes/dashboard.routes.js";
import applicationRouter from "./routes/application.routes.js";
import paymentRouter from "./routes/payment.routes.js";
import courseRouter from "./routes/course.routes.js";
import attendanceRouter from "./routes/attendance.routes.js";
import assignmentRouter from "./routes/assignment.routes.js";
import announcementRouter from "./routes/announcement.routes.js";
import certificateRouter from "./routes/certificate.routes.js";
import fileRouter from "./routes/file.routes.js";
import adminRouter from "./routes/admin.routes.js";

const app = express();

// Behind a reverse proxy (Render, Railway, nginx) this is what makes req.ip the
// real client address rather than the proxy's — which the rate limiter keys on.
app.set("trust proxy", 1);
app.disable("x-powered-by");

app.use(cors);

/**
 * JSON and urlencoded bodies only. File uploads are handled per-route by
 * middleware/upload.middleware.js, which installs its own raw parser — that is
 * safe to run after these because body-parser skips any request where `req._body`
 * is already set.
 *
 * The limit is 100kb rather than 10kb: the application form has 47 fields, and a
 * long "why do you want to attend WOFBI" answer plus an address and a
 * christian-service history can comfortably exceed 10kb of JSON.
 */
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.get("/api/health", (_req, res) => {
  res.status(200).json({
    success: true,
    message: "WOFBI API is running",
    time: new Date().toISOString(),
  });
});

/* ----------------------------------------------------------------- routers -- */

/**
 * The mount table. Exported so `npm run check` can print the whole route list
 * without a second copy of these prefixes going stale.
 */
export const mountedRouters = [
  ["/api/auth", authRouter],
  ["/api/dashboard", dashboardRouter],
  ["/api/applications", applicationRouter],
  ["/api/payments", paymentRouter],
  ["/api/courses", courseRouter],
  ["/api/attendance", attendanceRouter],
  ["/api/assignments", assignmentRouter],
  ["/api/announcements", announcementRouter],
  ["/api/certificates", certificateRouter],
  ["/api/files", fileRouter],
  ["/api/admin", adminRouter],
];

for (const [prefix, router] of mountedRouters) app.use(prefix, router);

/* ------------------------------------------------------------------ errors -- */

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
    code: "ROUTE_NOT_FOUND",
  });
});

/**
 * One error shape for the whole API: `{ success: false, message, code?, errors? }`.
 *
 * `errors` is a field -> message map the forms render inline, which is why
 * validation failures are translated into it rather than passed through as
 * Mongoose's own nested structure.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity.
app.use((error, req, res, next) => {
  /**
   * Body-parser failures are checked first, and by `type` rather than by status.
   * They arrive carrying `statusCode` of their own, so testing for that before
   * this point would swallow them into the generic branch below and answer with
   * body-parser's internal wording — "Unexpected token } in JSON at position 42" —
   * and no `code` for the client to branch on.
   */
  if (error.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "That request was too large. Please shorten your answers and try again.",
      code: "PAYLOAD_TOO_LARGE",
    });
  }
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      success: false,
      message: "That request body was not valid JSON.",
      code: "INVALID_JSON",
    });
  }

  if (error instanceof ApiError || typeof error.statusCode === "number") {
    // Server-side faults are the only ones worth logging; a 422 is the API doing
    // its job, and logging those buries the real problems.
    if ((error.statusCode || 500) >= 500) console.error(error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
      ...(error.code ? { code: error.code } : {}),
      ...(error.errors ? { errors: error.errors } : {}),
    });
  }

  // Mongoose validation — turned into the same per-field map the forms expect.
  if (error.name === "ValidationError") {
    const errors = Object.fromEntries(
      Object.entries(error.errors || {}).map(([field, detail]) => [
        field.split(".").pop(),
        detail.message,
      ]),
    );
    return res.status(422).json({
      success: false,
      message: "Please correct the highlighted fields.",
      errors,
    });
  }
  if (error.name === "CastError") {
    return res.status(400).json({
      success: false,
      message: "That identifier could not be read.",
      code: "INVALID_ID",
    });
  }

  // Unique index violation — e.g. two applications racing for one reference.
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern || {})[0] || "value";
    return res.status(409).json({
      success: false,
      message: `That ${field} is already in use.`,
      code: "DUPLICATE_KEY",
    });
  }

  if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
    return res.status(401).json({
      success: false,
      message: "Your session has expired. Please sign in again.",
      code: "SESSION_EXPIRED",
    });
  }

  // GridFS raises this when a file id no longer exists.
  if (/FileNotFound|File not found/i.test(error.message || "")) {
    return res.status(404).json({ success: false, message: "File not found.", code: "FILE_NOT_FOUND" });
  }

  console.error(error);
  res.status(500).json({
    success: false,
    message: "Something went wrong. Please try again.",
  });
});

export default app;
