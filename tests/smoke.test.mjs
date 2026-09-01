/**
 * End-to-end smoke test over real HTTP, with no database.
 *
 * Everything here exercises the app as a client sees it — a real socket, real
 * header parsing, the real middleware chain — while staying off the paths that
 * touch MongoDB. That is a deliberate line: it means this suite runs anywhere,
 * including CI with no Mongo available, and it still catches the failures that
 * unit tests miss (middleware ordering, error-handler branches, a router mounted
 * at the wrong prefix, a guard that lets an unauthenticated request through).
 *
 * The tokens used below are signed with the wrong secret on purpose, so the guards
 * reject them at the signature check and never reach a `findById`. Anything that
 * needs a real query is in the manual checklist in README.md instead.
 *
 * Run: node tests/smoke.test.mjs
 */
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

/* Set before importing the app: the CORS middleware caches its origin list. */
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "smoke-test-student-secret";
process.env.ADMIN_JWT_SECRET = "smoke-test-admin-secret";
process.env.CLIENT_URL = "http://localhost:3000";
process.env.ALLOWED_ORIGINS = "";
// Left off deliberately — the rate limiter is one of the things under test.
delete process.env.DISABLE_RATE_LIMIT;

const { default: app } = await import("../app.js");

const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const call = async (path, options = {}) => {
  const response = await fetch(`${base}${path}`, options);
  const isJson = (response.headers.get("content-type") || "").includes("application/json");
  return {
    status: response.status,
    body: isJson ? await response.json() : await response.text(),
    headers: response.headers,
  };
};

let checks = 0;
const failures = [];
const check = (label, fn) => {
  try {
    fn();
    checks += 1;
  } catch (error) {
    console.error(`\n  ✗ ${label}\n    ${error.message}\n`);
    failures.push(label);
  }
};

/* ------------------------------------------------------------------ liveness -- */

{
  const { status, body, headers } = await call("/api/health");
  check("health returns 200 with a timestamp", () => {
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.ok(Date.parse(body.time), "time should be a parseable date");
  });
  check("the server does not advertise Express", () => {
    assert.equal(headers.get("x-powered-by"), null);
  });
}

/* ------------------------------------------------------------- unknown route -- */

{
  const { status, body } = await call("/api/does-not-exist");
  check("unknown routes 404 in the standard error shape", () => {
    assert.equal(status, 404);
    assert.equal(body.success, false);
    assert.equal(body.code, "ROUTE_NOT_FOUND");
    assert.match(body.message, /GET \/api\/does-not-exist/);
  });
}

{
  // A path that exists for GET but not for POST must still answer, not hang.
  const { status, body } = await call("/api/health", { method: "POST" });
  check("a wrong method on a real path 404s rather than hanging", () => {
    assert.equal(status, 404);
    assert.equal(body.code, "ROUTE_NOT_FOUND");
  });
}

/* -------------------------------------------------------------- body parsing -- */

{
  const { status, body } = await call("/api/anything", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ not valid json",
  });
  check("malformed JSON is a clean 400, not a stack trace", () => {
    assert.equal(status, 400);
    assert.equal(body.code, "INVALID_JSON");
    assert.equal(body.success, false);
  });
}

{
  const oversized = JSON.stringify({ essay: "x".repeat(200 * 1024) });
  const { status, body } = await call("/api/anything", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: oversized,
  });
  check("a body over the 100kb limit is refused with PAYLOAD_TOO_LARGE", () => {
    assert.equal(status, 413);
    assert.equal(body.code, "PAYLOAD_TOO_LARGE");
  });
}

{
  // Just under the limit must still be accepted by the parser — the 401 below is
  // the auth guard, which proves the body got through.
  const { status } = await call("/api/applications/me", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ testimony: "x".repeat(80 * 1024) }),
  });
  check("a body under the limit reaches the router", () => {
    assert.equal(status, 401);
  });
}

/* -------------------------------------------------------------- auth guards -- */

const studentToken = jwt.sign({ sub: "64b7f0000000000000000001" }, process.env.JWT_SECRET);
const adminToken = jwt.sign(
  { sub: "64b7f0000000000000000002", scope: "admin" },
  process.env.ADMIN_JWT_SECRET,
);

for (const path of [
  "/api/dashboard",
  "/api/applications/me",
  "/api/payments/me",
  "/api/courses",
  "/api/attendance/me",
  "/api/assignments",
  "/api/announcements",
  "/api/certificates/me",
]) {
  const { status, body } = await call(path);
  check(`${path} rejects an unauthenticated request`, () => {
    assert.equal(status, 401);
    assert.equal(body.success, false);
    assert.ok(body.message, "a 401 should still explain itself");
  });
}

for (const path of ["/api/admin/overview", "/api/admin/applications", "/api/admin/admins"]) {
  const { status, body } = await call(path);
  check(`${path} demands an administrator`, () => {
    assert.equal(status, 401);
    assert.match(body.message, /[Aa]dministrator/);
  });
}

{
  // The point of two secrets: a valid student token is worthless on an admin route.
  const { status } = await call("/api/admin/overview", {
    headers: { Authorization: `Bearer ${studentToken}` },
  });
  check("a student token cannot open an admin route", () => {
    assert.equal(status, 401);
  });
}

{
  // And the reverse, so neither secret is quietly accepted by both guards.
  const { status } = await call("/api/dashboard", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  check("an admin token is not a student token", () => {
    assert.equal(status, 401);
  });
}

{
  const { status } = await call("/api/dashboard", { headers: { Authorization: "Basic abc123" } });
  check("a non-Bearer Authorization header is rejected", () => {
    assert.equal(status, 401);
  });
}

/**
 * Note on what is *not* here: `GET /api/certificates/verify/:number` is the one
 * public route that queries the database, so it cannot be exercised without one.
 * Firing a request at it and watching it wait would prove it is not behind a
 * guard, but it would also leave an abandoned query holding the event loop open
 * and make this suite take ten seconds to say nothing useful. It is in the manual
 * checklist in README.md instead, where there is a real database to answer it.
 */

/* ------------------------------------------------------------ file token path -- */

{
  const { status } = await call("/api/files/64b7f0000000000000000009");
  check("a stored file needs a token", () => {
    assert.equal(status, 401);
  });
}

{
  const { status } = await call("/api/files/64b7f0000000000000000009?token=not-a-real-token");
  check("the ?token= query parameter is verified, not merely present", () => {
    assert.equal(status, 401);
  });
}

/* -------------------------------------------------------------------- CORS -- */

{
  const { status, headers } = await call("/api/dashboard", {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "GET" },
  });
  check("preflight from the Next.js origin is answered", () => {
    assert.equal(status, 204);
    assert.equal(headers.get("access-control-allow-origin"), "http://localhost:3000");
    assert.equal(headers.get("access-control-allow-credentials"), "true");
    assert.match(headers.get("access-control-allow-headers"), /Authorization/);
    assert.match(headers.get("access-control-allow-methods"), /PATCH/);
  });
}

{
  const { headers } = await call("/api/health", { headers: { Origin: "http://evil.example.com" } });
  check("an origin that is not on the list gets no allow header", () => {
    assert.equal(headers.get("access-control-allow-origin"), null);
  });
}

{
  const { headers } = await call("/api/health", { headers: { Origin: "http://localhost:3000/" } });
  check("a trailing slash on the Origin does not defeat the match", () => {
    assert.equal(headers.get("access-control-allow-origin"), "http://localhost:3000");
  });
}

/* --------------------------------------------------------------- rate limits -- */

{
  /**
   * An invalid email is rejected by the controller before it queries anything, so
   * this loop exercises the limiter without a database. loginLimiter allows eight
   * attempts per fifteen minutes.
   */
  const attempt = () =>
    call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "not-an-email", password: "x" }),
    });

  const results = [];
  for (let index = 0; index < 9; index += 1) results.push(await attempt());

  check("the first eight sign-in attempts are allowed through", () => {
    for (const [index, result] of results.slice(0, 8).entries()) {
      assert.equal(result.status, 422, `attempt ${index + 1} should reach the validator`);
    }
  });

  check("the ninth is throttled with a retry hint", () => {
    const throttled = results[8];
    assert.equal(throttled.status, 429);
    assert.equal(throttled.body.code, "RATE_LIMITED");
    assert.ok(
      throttled.body.errors?.retryAfterSeconds > 0,
      "the client needs to know how long to wait",
    );
    assert.equal(throttled.headers.get("x-ratelimit-limit"), "8");
    assert.equal(throttled.headers.get("x-ratelimit-remaining"), "0");
    assert.ok(Number(throttled.headers.get("retry-after")) > 0);
  });

  check("the limiter counts down in a header while attempts remain", () => {
    assert.equal(results[0].headers.get("x-ratelimit-remaining"), "7");
  });

  // Limits are scoped, so being throttled at sign-in must leave other routes alone.
  const afterThrottling = await call("/api/health");
  check("throttling one scope does not throttle the rest of the API", () => {
    assert.equal(afterThrottling.status, 200);
  });
}

/* ------------------------------------------------------------------- report -- */

await new Promise((resolve) => server.close(resolve));

if (failures.length) {
  console.error(`smoke test: ${failures.length} of ${checks + failures.length} checks failed`);
  process.exitCode = 1;
} else {
  console.log(`smoke test over HTTP: ${checks} checks passed (no database required)`);
}
