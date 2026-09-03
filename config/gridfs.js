/**
 * GridFS storage for the passport photographs and payment receipts uploaded by
 * the enrollment form.
 *
 * Files live in MongoDB itself (the `uploads.files` / `uploads.chunks`
 * collections), so nothing is lost when the server restarts or redeploys onto
 * an ephemeral filesystem, and no third-party storage credentials are needed.
 *
 * The GridFSBucket needs a live database handle, so `initGridFS()` is called
 * once from the server bootstrap after `connectDB()` resolves.
 */
import mongoose from "mongoose";
import { GRIDFS_BUCKET } from "./constants.js";
import ApiError from "../utils/ApiError.js";

let bucket = null;

/** Called once on boot, after the Mongoose connection is established. */
export const initGridFS = () => {
  if (!mongoose.connection?.db) {
    throw new Error("initGridFS() was called before the database was connected.");
  }
  bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: GRIDFS_BUCKET,
  });
  return bucket;
};

export const getBucket = () => {
  if (!bucket) throw new Error("GridFS is not initialised. Call initGridFS() after connectDB().");
  return bucket;
};

/** Narrow guard so a malformed id from the URL becomes a 404, not a 500. */
export const toObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!mongoose.Types.ObjectId.isValid(String(value))) return null;
  return new mongoose.Types.ObjectId(String(value));
};

/**
 * Streams a Buffer into GridFS.
 * Resolves with the stored file's id, name, content type and byte length.
 */
export const uploadBuffer = ({ buffer, filename, contentType, metadata = {} }) =>
  new Promise((resolve, reject) => {
    const stream = getBucket().openUploadStream(filename, { contentType, metadata });
    stream.on("error", reject);
    stream.on("finish", () =>
      resolve({
        fileId: stream.id,
        filename,
        contentType,
        size: buffer.length,
        uploadedAt: new Date(),
      }),
    );
    stream.end(buffer);
  });

/** The `uploads.files` document, or null when the id is unknown or malformed. */
export const findFile = async (fileId) => {
  const id = toObjectId(fileId);
  if (!id) return null;
  const [file] = await getBucket().find({ _id: id }, { limit: 1 }).toArray();
  return file || null;
};

/** A readable stream of the file's bytes. Throws a 404 if the id is unknown. */
export const openDownloadStream = (fileId) => {
  const id = toObjectId(fileId);
  if (!id) throw ApiError.notFound("File not found.");
  return getBucket().openDownloadStream(id);
};

/** Removes a file and its chunks. Missing files are ignored, so this is safe to retry. */
export const deleteFile = async (fileId) => {
  const id = toObjectId(fileId);
  if (!id) return false;
  try {
    await getBucket().delete(id);
    return true;
  } catch (error) {
    // The driver throws when the file is already gone — that's the desired end state.
    if (/File not found|FileNotFound/i.test(error.message)) return false;
    throw error;
  }
};
