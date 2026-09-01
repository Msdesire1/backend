/**
 * A small in-memory rate limiter for the sensitive endpoints: sign-in, sign-up,
 * OTP resends and password resets.
 *
 * Honest about what it is: counters in a Map, scoped to one Node process. It
 * stops casual credential stuffing and accidental retry storms, which is the
 * realistic threat for a school portal. It does not survive a restart and does
 * not coordinate across instances — if this is ever deployed behind more than one
 * process, move the counters to Redis and keep this module's interface.
 *
 * Uses a sliding window (timestamps per key) rather than fixed buckets, so a
 * caller cannot get double the allowance by straddling a window boundary.
 */
import ApiError from "../utils/ApiError.js";

/** @type {Map<string, number[]>} key -> request timestamps inside the window */
const hits = new Map();

/** Identify by authenticated user first, then by IP. */
const defaultKey = (req) =>
  req.user?.id?.toString() ||
  req.admin?.id?.toString() ||
  req.ip ||
  req.socket?.remoteAddress ||
  "unknown";

const sweep = (now) => {
  for (const [key, timestamps] of hits) {
    if (!timestamps.length || now - timestamps.at(-1) > 60 * 60 * 1000) hits.delete(key);
  }
};

let lastSweep = Date.now();

/**
 * @param {object} [options]
 * @param {number} [options.max=10]         requests allowed per window
 * @param {number} [options.windowMs=900000] window length (default 15 minutes)
 * @param {string} [options.scope=""]        keeps separate limits from colliding
 * @param {string} [options.message]         shown to the caller when throttled
 */
export const rateLimit = ({
  max = 10,
  windowMs = 15 * 60 * 1000,
  scope = "",
  message = "Too many attempts. Please wait a few minutes and try again.",
  keyGenerator = defaultKey,
} = {}) => (req, res, next) => {
  // Escape hatch for tests and local development. Deliberately ignored when
  // NODE_ENV is production: a DISABLE_RATE_LIMIT=true left behind in a deployed
  // .env would silently remove the only brake on credential stuffing, and that
  // is exactly the kind of line that gets copied from a dev file and forgotten.
  if (process.env.DISABLE_RATE_LIMIT === "true" && process.env.NODE_ENV !== "production") {
    return next();
  }

  const now = Date.now();
  if (now - lastSweep > 5 * 60 * 1000) {
    sweep(now);
    lastSweep = now;
  }

  const key = `${scope}:${keyGenerator(req)}`;
  const window = (hits.get(key) || []).filter((time) => now - time < windowMs);

  if (window.length >= max) {
    const retryAfterSeconds = Math.ceil((windowMs - (now - window[0])) / 1000);
    hits.set(key, window);
    res.setHeader("Retry-After", retryAfterSeconds);
    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", 0);
    return next(
      new ApiError(429, message, {
        code: "RATE_LIMITED",
        errors: { retryAfterSeconds },
      }),
    );
  }

  window.push(now);
  hits.set(key, window);
  res.setHeader("X-RateLimit-Limit", max);
  res.setHeader("X-RateLimit-Remaining", Math.max(0, max - window.length));
  return next();
};

/** Clears a caller's counter — called after a successful sign-in. */
export const resetRateLimit = (scope, req, keyGenerator = defaultKey) => {
  hits.delete(`${scope}:${keyGenerator(req)}`);
};

/* Pre-configured limits used by the routers, so the numbers live in one place. */

export const loginLimiter = rateLimit({
  scope: "login",
  max: 8,
  windowMs: 15 * 60 * 1000,
  message: "Too many sign-in attempts. Please wait 15 minutes and try again.",
});

export const registerLimiter = rateLimit({
  scope: "register",
  max: 5,
  windowMs: 60 * 60 * 1000,
  message: "Too many accounts created from this device. Please try again later.",
});

export const otpLimiter = rateLimit({
  scope: "otp",
  max: 5,
  windowMs: 15 * 60 * 1000,
  message: "Too many verification codes requested. Please wait 15 minutes.",
});

export const passwordResetLimiter = rateLimit({
  scope: "password-reset",
  max: 5,
  windowMs: 60 * 60 * 1000,
  message: "Too many password reset requests. Please try again in an hour.",
});

export const uploadLimiter = rateLimit({
  scope: "upload",
  max: 40,
  windowMs: 60 * 60 * 1000,
  message: "Too many uploads. Please wait a while before trying again.",
});
