/**
 * Certificates a student has been awarded, plus public verification.
 *
 * Verification is the only unauthenticated endpoint in the API. Someone holding a
 * printed certificate — an employer, another institution — needs to be able to
 * confirm it is genuine without an account, so the response is limited to what is
 * already printed on the paper: number, holder, programme, issue date, validity.
 * No email, no phone number, no student id.
 */
import Certificate from "../models/certificate.model.js";
import ApiError from "../utils/ApiError.js";
import asyncHandler from "../utils/asyncHandler.js";

/** GET /api/certificates/me */
export const getMyCertificates = asyncHandler(async (req, res) => {
  const certificates = await Certificate.find({ user: req.user._id })
    .sort({ issuedAt: -1 })
    .populate("course", "code name");

  res.json({
    success: true,
    certificates: certificates.map((certificate) => ({
      ...certificate.toPublicJSON(),
      course: certificate.course
        ? { code: certificate.course.code, name: certificate.course.name }
        : null,
    })),
  });
});

/** GET /api/certificates/verify/:number — public. */
export const verifyCertificate = asyncHandler(async (req, res) => {
  const number = String(req.params.number || "").trim().toUpperCase();
  const certificate = await Certificate.findOne({ certificateNumber: number });

  if (!certificate) {
    // 404 with a plain answer rather than an error: "we have no record of this"
    // is the useful result for whoever is checking.
    return res.status(404).json({
      success: false,
      found: false,
      message: "No certificate was found with that number.",
    });
  }

  res.json({
    success: true,
    found: true,
    certificate: certificate.toVerificationJSON(),
    message: certificate.revoked
      ? "This certificate has been revoked."
      : "This certificate is valid.",
  });
});

/** GET /api/certificates/:id/download — the stored PDF, if one was generated. */
export const downloadMyCertificate = asyncHandler(async (req, res) => {
  const certificate = await Certificate.findOne({
    _id: req.params.id,
    user: req.user._id,
  });
  if (!certificate) throw ApiError.notFound("That certificate could not be found.");
  if (!certificate.document?.fileId) {
    throw ApiError.notFound(
      "A printable copy of this certificate is not available yet. Please contact the institute office.",
    );
  }

  // The file route already handles streaming, range-free downloads and access
  // checks, so point at it rather than duplicating that logic here.
  res.json({
    success: true,
    url: `/api/files/${certificate.document.fileId}?download=1`,
    filename: certificate.document.filename,
  });
});
