import mongoose from "mongoose";

/**
 * Pointer to a file stored in GridFS. Embedded wherever a document owns an
 * upload (application photo, payment receipt, assignment submission), so the
 * metadata needed to render or download it is available without a second query.
 */
const fileRefSchema = new mongoose.Schema(
  {
    fileId: { type: mongoose.Schema.Types.ObjectId, required: true },
    filename: { type: String, required: true, trim: true },
    contentType: { type: String, required: true, trim: true },
    size: { type: Number, required: true, min: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

/** Shape returned to clients: an id and a URL they can fetch with their token. */
export const toFileJSON = (file, pathPrefix = "/api/files") => {
  if (!file?.fileId) return null;
  return {
    id: String(file.fileId),
    filename: file.filename,
    contentType: file.contentType,
    size: file.size,
    uploadedAt: file.uploadedAt,
    url: `${pathPrefix}/${String(file.fileId)}`,
  };
};

export default fileRefSchema;
