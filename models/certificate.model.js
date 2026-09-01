import mongoose from "mongoose";
import fileRefSchema, { toFileJSON } from "./fileRef.schema.js";
import { formatDisplayDate } from "../config/constants.js";

/**
 * A certificate issued on completion of a programme — the source of the
 * "Certificates issued" KPI.
 *
 * `certificateNumber` is public and safe to print, so it doubles as the lookup
 * key for unauthenticated verification (GET /api/certificates/verify/:number).
 * That endpoint returns only the holder's name, programme and issue date:
 * enough to confirm a certificate is genuine, and nothing that would leak
 * contact details to whoever is holding the paper copy.
 */
const certificateSchema = new mongoose.Schema(
  {
    certificateNumber: { type: String, required: true, unique: true, trim: true }, // "CERT-26-0001"

    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    course: { type: mongoose.Schema.Types.ObjectId, ref: "Course", required: true },

    /** Name as it should appear on the certificate, captured at issue time. */
    holderName: { type: String, required: true, trim: true },
    programme: { type: String, trim: true, default: "" },
    grade: { type: String, trim: true, default: "" },

    issuedAt: { type: Date, default: Date.now },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },

    /** Optional generated PDF held in GridFS. */
    document: { type: fileRefSchema, default: null },
    revoked: { type: Boolean, default: false },
    revokedReason: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

// One certificate per student per programme.
certificateSchema.index({ user: 1, course: 1 }, { unique: true });
certificateSchema.index({ issuedAt: -1 });

certificateSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    certificateNumber: this.certificateNumber,
    holderName: this.holderName,
    programme: this.programme,
    grade: this.grade || null,
    issuedAt: this.issuedAt,
    issuedOn: formatDisplayDate(this.issuedAt),
    revoked: this.revoked,
    document: toFileJSON(this.document),
  };
};

/** Deliberately minimal — this is served without authentication. */
certificateSchema.methods.toVerificationJSON = function toVerificationJSON() {
  return {
    certificateNumber: this.certificateNumber,
    holderName: this.holderName,
    programme: this.programme,
    issuedOn: formatDisplayDate(this.issuedAt),
    valid: !this.revoked,
  };
};

export default mongoose.model("Certificate", certificateSchema);
