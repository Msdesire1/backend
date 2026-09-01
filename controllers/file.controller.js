/**
 * Serves the files held in GridFS: passport photographs, payment receipts,
 * assignment attachments and generated certificates.
 *
 * Access is decided from the file's own `metadata.user`, written at upload time.
 * An administrator may fetch any file; a student may fetch only their own. There
 * is no public file route — a receipt is a financial document and a passport
 * photograph is personal data, so neither is served on a guessable public URL.
 */
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";
import { findFile, openDownloadStream } from "../config/gridfs.js";

const ownsFile = (file, user) =>
  Boolean(user) && String(file.metadata?.user || "") === String(user._id);

/** Inline for images and PDFs so browsers preview them; attachment on request. */
const dispositionFor = (file, wantsDownload) => {
  const type = wantsDownload ? "attachment" : "inline";
  // RFC 5987 encoding so non-ASCII filenames survive, with a plain fallback.
  const plain = file.filename.replace(/["\\]/g, "").replace(/[^\x20-\x7e]/g, "_");
  return `${type}; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`;
};

/** GET /api/files/:id */
export const streamFile = asyncHandler(async (req, res) => {
  const file = await findFile(req.params.id);
  if (!file) throw ApiError.notFound("File not found.");

  if (!req.admin && !ownsFile(file, req.user)) {
    // Deliberately the same message a missing file gets: confirming that an id
    // exists but belongs to someone else is itself a small leak.
    throw ApiError.notFound("File not found.");
  }

  const wantsDownload = req.query.download === "1" || req.query.download === "true";

  res.setHeader("Content-Type", file.contentType || "application/octet-stream");
  res.setHeader("Content-Length", file.length);
  res.setHeader("Content-Disposition", dispositionFor(file, wantsDownload));
  // Private: these are per-user documents and must not be held by shared caches.
  res.setHeader("Cache-Control", "private, max-age=300");
  if (file.uploadDate) res.setHeader("Last-Modified", new Date(file.uploadDate).toUTCString());

  const stream = openDownloadStream(file._id);
  stream.on("error", (error) => {
    // Headers are already out by the time chunks flow, so the only honest thing
    // left is to break the connection rather than append an error body.
    console.error(`[gridfs] stream failed for ${file._id}: ${error.message}`);
    res.destroy(error);
  });
  // Aborted downloads should not keep reading from the database.
  res.on("close", () => stream.destroy());
  stream.pipe(res);
});

/** GET /api/files/:id/meta — size and type without transferring the bytes. */
export const getFileMeta = asyncHandler(async (req, res) => {
  const file = await findFile(req.params.id);
  if (!file) throw ApiError.notFound("File not found.");
  if (!req.admin && !ownsFile(file, req.user)) throw ApiError.notFound("File not found.");

  res.json({
    success: true,
    file: {
      id: file._id,
      filename: file.filename,
      contentType: file.contentType || "application/octet-stream",
      size: file.length,
      uploadedAt: file.uploadDate,
      kind: file.metadata?.kind || null,
      url: `/api/files/${file._id}`,
    },
  });
});
