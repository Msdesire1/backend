/**
 * CORS, hand-rolled to keep the dependency list at zero.
 *
 * The Next.js app runs on a different origin (localhost:3000) from the API
 * (localhost:5000), so the browser will not send Authorization headers without
 * these response headers and a correct preflight answer.
 *
 * Allowed origins come from CLIENT_URL / ALLOWED_ORIGINS in .env — comma
 * separated. Requests without an Origin header (curl, Postman, server-side
 * fetches from Next.js) are always allowed; CORS only governs browsers.
 */

const parseOrigins = () => {
  const raw = [process.env.CLIENT_URL, process.env.ALLOWED_ORIGINS]
    .filter(Boolean)
    .join(",");
  const origins = raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
  // Sensible dev defaults so the app works before .env is filled in.
  if (!origins.length) return ["http://localhost:3000", "http://127.0.0.1:3000"];
  return origins;
};

let allowedOrigins = null;
const getAllowedOrigins = () => {
  if (!allowedOrigins) allowedOrigins = parseOrigins();
  return allowedOrigins;
};

const ALLOWED_HEADERS = "Content-Type, Authorization, X-File-Name, X-Requested-With";
const ALLOWED_METHODS = "GET, POST, PATCH, PUT, DELETE, OPTIONS";

const cors = (req, res, next) => {
  const origin = req.headers.origin?.replace(/\/$/, "");
  const origins = getAllowedOrigins();

  if (origin && (origins.includes("*") || origins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    // Caches must not serve one origin's response to another.
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
  res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  // Lets the browser read the filename we set on receipt/photo downloads.
  res.setHeader("Access-Control-Expose-Headers", "Content-Disposition, Content-Length");

  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.status(204).end();
  }

  next();
};

export default cors;
