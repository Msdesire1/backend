/**
 * Boots a throwaway Express app to exercise the upload middleware and the rate
 * limiter over real HTTP. No database, no network — just the middleware layer.
 */
import express from "express";
import assert from "node:assert/strict";
import { acceptUploads, requireUploads } from "../middleware/upload.middleware.js";
import { rateLimit } from "../middleware/rateLimit.middleware.js";
import { PHOTO_MIME_TYPES, RECEIPT_MIME_TYPES } from "../config/constants.js";

const app = express();
app.use(express.json({ limit: "10kb" }));

const uploads = acceptUploads({
  photo: { mimeTypes: PHOTO_MIME_TYPES, maxBytes: 5 * 1024 * 1024 },
  receipt: { mimeTypes: RECEIPT_MIME_TYPES, maxBytes: 5 * 1024 * 1024 },
});

const echo = (req, res) => {
  res.json({
    body: req.body,
    files: Object.fromEntries(
      Object.entries(req.files).map(([field, file]) => [
        field,
        {
          filename: file.filename,
          contentType: file.contentType,
          size: file.size,
          sha: [...file.buffer].reduce((a, b) => (a * 31 + b) % 1000003, 7),
        },
      ]),
    ),
  });
};

app.post("/upload", uploads, echo);
app.post("/upload/strict", uploads, requireUploads("photo", "receipt"), echo);
app.post("/upload/:kind", uploads, echo);
app.post(
  "/limited",
  rateLimit({ scope: "test", max: 2, windowMs: 60_000, keyGenerator: () => "fixed" }),
  (_req, res) => res.json({ ok: true }),
);

app.use((error, _req, res, _next) => {
  res.status(error.statusCode || error.status || 500).json({
    success: false,
    message: error.message,
    code: error.code,
    errors: error.errors,
  });
});

const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // real PNG magic, embedded CRLF
  Buffer.from("payload\r\n--not-a-boundary\r\n"),
]);
const sha = (buffer) => [...buffer].reduce((a, b) => (a * 31 + b) % 1000003, 7);

/* 1. JSON bodies are untouched by the raw parser -------------------------------- */
let response = await fetch(`${base}/upload`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ surname: "Adebayo", preferredCourse: "Basic Certificate Course" }),
});
let payload = await response.json();
assert.equal(response.status, 200, "json request should succeed");
assert.equal(payload.body.surname, "Adebayo", "json body must survive express.raw");
assert.deepEqual(payload.files, {}, "json request has no files");

/* 2. multipart with text fields and two files ---------------------------------- */
const form = new FormData();
form.append("surname", "Adebayo");
form.append("otherNames", "Michael\r\nOluwaseun"); // CRLF inside a text field
form.append("photo", new Blob([png], { type: "image/png" }), "C:\\Users\\HP\\shot.png");
form.append("receipt", new Blob([Buffer.from("%PDF-1.4 receipt")], { type: "application/pdf" }), "r.pdf");
response = await fetch(`${base}/upload`, { method: "POST", body: form });
payload = await response.json();
assert.equal(response.status, 200);
assert.equal(payload.body.surname, "Adebayo");
assert.equal(payload.body.otherNames, "Michael\r\nOluwaseun", "CRLF preserved in text field");
assert.equal(payload.files.photo.filename, "shot.png", "windows path stripped");
assert.equal(payload.files.photo.contentType, "image/png");
assert.equal(payload.files.photo.size, png.length, "photo size exact");
assert.equal(payload.files.photo.sha, sha(png), "photo bytes identical after round trip");
assert.equal(payload.files.receipt.contentType, "application/pdf");

/* 3. a JSON blob in a `form` field is unwrapped -------------------------------- */
const wrapped = new FormData();
wrapped.append("form", JSON.stringify({ surname: "Okoro", stateOfOrigin: "Kwara" }));
wrapped.append("photo", new Blob([png], { type: "image/png" }), "p.png");
response = await fetch(`${base}/upload`, { method: "POST", body: wrapped });
payload = await response.json();
assert.equal(payload.body.surname, "Okoro", "`form` JSON field unwrapped onto body");
assert.equal(payload.body.stateOfOrigin, "Kwara");
assert.equal(payload.body.form, undefined, "raw `form` string removed");

/* 4. raw binary body, field taken from the route param ------------------------- */
response = await fetch(`${base}/upload/receipt`, {
  method: "POST",
  headers: { "Content-Type": "application/pdf", "X-File-Name": "../../etc/transfer slip.pdf" },
  body: png,
});
payload = await response.json();
assert.equal(response.status, 200);
assert.equal(payload.files.receipt.filename, "transfer slip.pdf", "traversal stripped from header");
assert.equal(payload.files.receipt.contentType, "application/pdf");
assert.equal(payload.files.receipt.sha, sha(png), "raw binary bytes identical");

/* 5. rejected media type ------------------------------------------------------- */
const badType = new FormData();
badType.append("photo", new Blob([Buffer.from("GIF89a")], { type: "image/gif" }), "a.gif");
response = await fetch(`${base}/upload`, { method: "POST", body: badType });
payload = await response.json();
assert.equal(response.status, 415, "gif photo rejected");
assert.match(payload.message, /PNG or JPG/, "message names the accepted types");

/* 6. per-file size cap -------------------------------------------------------- */
const bigApp = express();
const smallSpec = acceptUploads({ photo: { mimeTypes: PHOTO_MIME_TYPES, maxBytes: 1024 } });
bigApp.post("/x", smallSpec, echo);
bigApp.use((error, _req, res, _next) =>
  res.status(error.statusCode || 500).json({ message: error.message }),
);
const bigServer = bigApp.listen(0);
await new Promise((resolve) => bigServer.once("listening", resolve));
const bigForm = new FormData();
bigForm.append("photo", new Blob([Buffer.alloc(4096, 1)], { type: "image/png" }), "big.png");
response = await fetch(`http://127.0.0.1:${bigServer.address().port}/x`, {
  method: "POST",
  body: bigForm,
});
assert.equal(response.status, 413, "oversize file rejected");
bigServer.close();

/* 7. missing required files -> 422 with a field map ---------------------------- */
const partial = new FormData();
partial.append("photo", new Blob([png], { type: "image/png" }), "p.png");
response = await fetch(`${base}/upload/strict`, { method: "POST", body: partial });
payload = await response.json();
assert.equal(response.status, 422);
assert.deepEqual(payload.errors, { receipt: "This file is required." });

/* 8. an empty file input is ignored, not treated as an upload ------------------ */
const empty = new FormData();
empty.append("surname", "Bello");
empty.append("photo", new Blob([], { type: "application/octet-stream" }), "");
response = await fetch(`${base}/upload`, { method: "POST", body: empty });
payload = await response.json();
assert.equal(response.status, 200, "empty file input must not fail the request");
assert.deepEqual(payload.files, {}, "empty file input ignored");
assert.equal(payload.body.surname, "Bello");

/* 9. unknown file fields are dropped rather than stored ----------------------- */
const stray = new FormData();
stray.append("avatar", new Blob([png], { type: "image/png" }), "x.png");
response = await fetch(`${base}/upload`, { method: "POST", body: stray });
payload = await response.json();
assert.deepEqual(payload.files, {}, "undeclared file field ignored");

/* 10. rate limiter ------------------------------------------------------------ */
delete process.env.DISABLE_RATE_LIMIT;
const hit = () => fetch(`${base}/limited`, { method: "POST" });
assert.equal((await hit()).status, 200);
const second = await hit();
assert.equal(second.status, 200);
assert.equal(second.headers.get("x-ratelimit-remaining"), "0");
const third = await hit();
payload = await third.json();
assert.equal(third.status, 429, "third request throttled");
assert.equal(payload.code, "RATE_LIMITED");
assert.ok(Number(third.headers.get("retry-after")) > 0, "Retry-After header set");

server.close();
console.log("upload + rate limit middleware: all assertions passed");
