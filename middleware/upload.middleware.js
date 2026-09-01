/**
 * Upload handling for the enrollment form's passport photograph and payment
 * receipt, and for assignment attachments.
 *
 * Two request styles are accepted so the frontend can use whichever is more
 * convenient:
 *
 *   1. multipart/form-data — a normal FormData POST. Text fields land on
 *      `req.body`, files on `req.files`. A field named `form` containing JSON is
 *      unwrapped automatically, so the wizard can post its React state as one blob.
 *
 *   2. A raw binary body with the file's own Content-Type (image/png,
 *      application/pdf, …) and an optional `X-File-Name` header. Handy for
 *      `fetch(url, { body: file })`, where `file` is a File/Blob straight from an
 *      <input type="file">.
 *
 * Either way controllers see the same normalised `req.files[field]` shape:
 * `{ filename, contentType, buffer, size }`.
 */
import express from "express";
import ApiError from "../utils/ApiError.js";
import { isMultipart, parseMultipart, sanitizeFilename } from "../utils/multipart.js";
import { MAX_UPLOAD_BYTES } from "../config/constants.js";

const EXTENSION_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "application/pdf": "pdf",
};

const humanSize = (bytes) => `${(bytes / (1024 * 1024)).toFixed(0)} MB`;

/** Turns ["image/png", "image/jpeg"] into "PNG or JPG" for error messages. */
const describeTypes = (mimeTypes) => {
  const names = mimeTypes.map((type) => (EXTENSION_BY_MIME[type] || type).toUpperCase());
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
};

const validateFile = (file, rule, field) => {
  const maxBytes = rule.maxBytes ?? MAX_UPLOAD_BYTES;
  if (!file.size) {
    throw ApiError.badRequest(`The ${field} file is empty.`);
  }
  if (file.size > maxBytes) {
    throw ApiError.payloadTooLarge(
      `The ${field} must be smaller than ${humanSize(maxBytes)}.`,
    );
  }
  if (rule.mimeTypes?.length && !rule.mimeTypes.includes(file.contentType)) {
    throw ApiError.unsupportedMediaType(
      `The ${field} must be a ${describeTypes(rule.mimeTypes)} file.`,
    );
  }
};

/**
 * Text fields arrive as strings. Unwrap a JSON `form` field, and drop the
 * frontend's own bookkeeping keys so they can never be written as form data.
 */
const normaliseFields = (fields) => {
  const body = { ...fields };
  if (typeof body.form === "string" && body.form.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(body.form);
      delete body.form;
      Object.assign(body, parsed);
    } catch {
      throw ApiError.badRequest("The `form` field is not valid JSON.");
    }
  }
  return body;
};

/**
 * @param {Record<string, {mimeTypes?: string[], maxBytes?: number}>} spec
 *   Accepted file fields. Anything not listed here is ignored rather than stored.
 */
export const acceptUploads = (spec) => {
  const fieldNames = Object.keys(spec);
  // Enough headroom for every declared file plus multipart framing overhead.
  const limit =
    fieldNames.reduce((total, field) => total + (spec[field].maxBytes ?? MAX_UPLOAD_BYTES), 0) +
    1024 * 1024;

  // `type: () => true` is safe here: body-parser skips any request an earlier
  // parser already handled (it checks `req._body`), so JSON bodies still arrive
  // parsed and only multipart/binary payloads reach this one.
  const rawParser = express.raw({ type: () => true, limit });

  const normalise = (req, _res, next) => {
    try {
      req.files = {};
      const contentType = req.headers["content-type"] || "";

      if (isMultipart(contentType)) {
        const { fields, files } = parseMultipart(req.body, contentType);
        req.body = normaliseFields(fields);

        for (const field of fieldNames) {
          const [file] = files[field] || [];
          if (!file) continue;
          validateFile(file, spec[field], field);
          req.files[field] = file;
        }
        return next();
      }

      // Raw binary body: one file, no text fields.
      if (Buffer.isBuffer(req.body) && req.body.length) {
        const requested = req.params?.kind || req.query?.field;
        const field = fieldNames.includes(requested)
          ? requested
          : fieldNames.length === 1
            ? fieldNames[0]
            : null;

        if (!field) {
          throw ApiError.badRequest(
            `Specify which file this is. Expected one of: ${fieldNames.join(", ")}.`,
          );
        }

        const declaredType = contentType.split(";")[0].trim();
        const file = {
          fieldName: field,
          filename:
            sanitizeFilename(req.headers["x-file-name"] || "") ||
            `${field}.${EXTENSION_BY_MIME[declaredType] || "bin"}`,
          contentType: declaredType || "application/octet-stream",
          buffer: req.body,
          size: req.body.length,
        };
        validateFile(file, spec[field], field);
        req.files[field] = file;
        req.body = {};
        return next();
      }

      // No body, or a JSON body an earlier parser already handled — nothing to do.
      if (Buffer.isBuffer(req.body)) req.body = {};
      return next();
    } catch (error) {
      return next(error);
    }
  };

  return [rawParser, normalise];
};

/** Rejects the request unless every listed field was uploaded. */
export const requireUploads =
  (...fields) =>
  (req, _res, next) => {
    const missing = fields.filter((field) => !req.files?.[field]);
    if (missing.length) {
      const errors = Object.fromEntries(
        missing.map((field) => [field, "This file is required."]),
      );
      return next(ApiError.unprocessable("Please attach the required files.", errors));
    }
    return next();
  };
