/**
 * A minimal, dependency-free `multipart/form-data` parser (RFC 7578).
 *
 * Written by hand rather than pulling in multer/busboy: the form uploads exactly
 * two small files, both capped at 5 MB, so buffering the request and slicing it
 * is entirely adequate — and it keeps the project installable with no extra
 * packages.
 *
 * Scope and limits, stated plainly:
 *   - The whole body is buffered in memory. Fine for 5 MB caps, not for
 *     multi-gigabyte uploads. If limits ever grow substantially, swap this for a
 *     streaming parser; `parseMultipart` is the only function that would change.
 *   - Handles quoted and unquoted parameter values, per-part Content-Type,
 *     multiple files, and repeated field names.
 *   - Does not implement `multipart/mixed` nesting or RFC 2231 continuations;
 *     browsers do not emit either for form uploads.
 */
import ApiError from "./ApiError.js";

const CRLF = Buffer.from("\r\n");
const DOUBLE_CRLF = Buffer.from("\r\n\r\n");

/** Pulls `boundary` out of a Content-Type header, quoted or bare. */
export const getBoundary = (contentType = "") => {
  const match = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] || match?.[2];
  return boundary ? boundary.trim() : null;
};

export const isMultipart = (contentType = "") =>
  /^multipart\/form-data/i.test(String(contentType).trim());

/** Splits a buffer on every occurrence of `separator`. */
const splitBuffer = (buffer, separator) => {
  const segments = [];
  let start = 0;
  let index = buffer.indexOf(separator, start);
  while (index !== -1) {
    segments.push(buffer.subarray(start, index));
    start = index + separator.length;
    index = buffer.indexOf(separator, start);
  }
  segments.push(buffer.subarray(start));
  return segments;
};

/** "form-data; name="photo"; filename="a.png"" -> { name: "photo", filename: "a.png" } */
const parseContentDisposition = (value = "") => {
  const result = {};
  const pattern = /;\s*([\w*-]+)\s*=\s*(?:"([^"]*)"|([^;]*))/g;
  let match = pattern.exec(value);
  while (match) {
    const key = match[1].toLowerCase().replace(/\*$/, "");
    result[key] = (match[2] ?? match[3] ?? "").trim();
    match = pattern.exec(value);
  }
  return result;
};

const parseHeaders = (block) => {
  const headers = {};
  for (const line of block.toString("utf8").split("\r\n")) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
  }
  return headers;
};

/**
 * Strips any directory component a browser might include (Opera historically
 * sent full paths) so a filename can never be used to traverse outside its
 * intended location. Also removes control characters.
 */
export const sanitizeFilename = (filename = "") => {
  const base = String(filename).replace(/\\/g, "/").split("/").pop() || "";
  // Strip C0 control characters and DEL, which have no business in a filename.
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200);
};

/**
 * Parses a buffered multipart body.
 *
 * @returns {{ fields: Record<string, string>, files: Record<string, object[]> }}
 *   `fields` holds text parts (last value wins for repeats); `files` maps each
 *   field name to an array of `{ fieldName, filename, contentType, buffer, size }`.
 */
export const parseMultipart = (body, contentType) => {
  const boundary = getBoundary(contentType);
  if (!boundary) {
    throw ApiError.badRequest("Malformed multipart request: the boundary parameter is missing.");
  }
  if (!Buffer.isBuffer(body) || !body.length) {
    throw ApiError.badRequest("The request body is empty.");
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const segments = splitBuffer(body, delimiter);

  const fields = {};
  const files = {};

  // segments[0] is the preamble and the final segment is the "--" epilogue;
  // everything in between is a part.
  for (let index = 1; index < segments.length - 1; index += 1) {
    let part = segments[index];

    // Each part is introduced by the CRLF that followed the delimiter, and
    // terminated by the CRLF preceding the next one.
    if (part.subarray(0, 2).equals(CRLF)) part = part.subarray(2);
    if (part.subarray(-2).equals(CRLF)) part = part.subarray(0, part.length - 2);
    if (!part.length) continue;

    const headerEnd = part.indexOf(DOUBLE_CRLF);
    if (headerEnd === -1) continue; // no header block — not a well-formed part

    const headers = parseHeaders(part.subarray(0, headerEnd));
    const content = part.subarray(headerEnd + DOUBLE_CRLF.length);

    const disposition = parseContentDisposition(headers["content-disposition"] || "");
    const fieldName = disposition.name;
    if (!fieldName) continue;

    if (disposition.filename === undefined) {
      fields[fieldName] = content.toString("utf8");
      continue;
    }

    const filename = sanitizeFilename(disposition.filename);
    // A file input left empty still sends an empty part; ignore it.
    if (!filename && !content.length) continue;

    files[fieldName] = files[fieldName] || [];
    files[fieldName].push({
      fieldName,
      filename: filename || "upload",
      contentType: (headers["content-type"] || "application/octet-stream").split(";")[0].trim(),
      buffer: content,
      size: content.length,
    });
  }

  return { fields, files };
};
