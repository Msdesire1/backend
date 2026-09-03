/**
 * Unit tests for the multipart parser's edge cases — the ones a browser will not
 * produce for us, so they cannot be covered through real HTTP.
 */
import assert from "node:assert/strict";
import { getBoundary, isMultipart, parseMultipart, sanitizeFilename } from "../utils/multipart.js";

/* boundary extraction ---------------------------------------------------------- */
assert.equal(getBoundary("multipart/form-data; boundary=----abc123"), "----abc123");
assert.equal(getBoundary('multipart/form-data; boundary="has spaces"'), "has spaces");
assert.equal(getBoundary("multipart/form-data; charset=utf-8; boundary=x9"), "x9");
assert.equal(getBoundary("application/json"), null);

assert.equal(isMultipart("multipart/form-data; boundary=x"), true);
assert.equal(isMultipart("MULTIPART/FORM-DATA; boundary=x"), true);
assert.equal(isMultipart("application/json"), false);
assert.equal(isMultipart(undefined), false);

/* filename hardening ----------------------------------------------------------- */
assert.equal(sanitizeFilename("../../etc/passwd"), "passwd");
assert.equal(sanitizeFilename("C:\\Users\\HP\\Desktop\\slip.pdf"), "slip.pdf");
assert.equal(sanitizeFilename("a\u0000b.png"), "ab.png");
assert.equal(sanitizeFilename("  spaced.png  "), "spaced.png");
assert.equal(sanitizeFilename(""), "");
assert.equal(sanitizeFilename(`${"n".repeat(300)}.png`).length, 200, "long names truncated");

/* a hand-built body with a quoted boundary ------------------------------------ */
const boundary = "b o u n d";
const body = Buffer.from(
  [
    `--${boundary}`,
    'Content-Disposition: form-data; name="surname"',
    "",
    "Adebayo",
    `--${boundary}`,
    'Content-Disposition: form-data; name="photo"; filename="p.png"',
    "Content-Type: image/png",
    "",
    "BYTES",
    `--${boundary}--`,
    "",
  ].join("\r\n"),
);
const parsed = parseMultipart(body, `multipart/form-data; boundary="${boundary}"`);
assert.equal(parsed.fields.surname, "Adebayo");
assert.equal(parsed.files.photo[0].filename, "p.png");
assert.equal(parsed.files.photo[0].buffer.toString(), "BYTES");
assert.equal(parsed.files.photo[0].contentType, "image/png");

/* repeated field names: last value wins, files accumulate --------------------- */
const repeated = Buffer.from(
  [
    "--z",
    'Content-Disposition: form-data; name="tag"',
    "",
    "one",
    "--z",
    'Content-Disposition: form-data; name="tag"',
    "",
    "two",
    "--z",
    'Content-Disposition: form-data; name="doc"; filename="a.txt"',
    "",
    "A",
    "--z",
    'Content-Disposition: form-data; name="doc"; filename="b.txt"',
    "",
    "B",
    "--z--",
    "",
  ].join("\r\n"),
);
const many = parseMultipart(repeated, "multipart/form-data; boundary=z");
assert.equal(many.fields.tag, "two");
assert.equal(many.files.doc.length, 2);
assert.deepEqual(
  many.files.doc.map((file) => file.filename),
  ["a.txt", "b.txt"],
);

/* error paths ----------------------------------------------------------------- */
assert.throws(() => parseMultipart(body, "multipart/form-data"), /boundary/i);
assert.throws(() => parseMultipart(Buffer.alloc(0), "multipart/form-data; boundary=z"), /empty/i);
assert.throws(() => parseMultipart("not a buffer", "multipart/form-data; boundary=z"), /empty/i);

console.log("multipart parser: all assertions passed");
