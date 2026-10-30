import mongoose from "mongoose";

const churchMemberSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 120 },
    title: { type: String, required: true, trim: true, maxlength: 30 },
    phone: { type: String, required: true, trim: true, match: /^\+[1-9]\d{7,14}$/ },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^\S+@\S+\.\S+$/,
      maxlength: 254,
    },
    dateOfBirth: { type: Date, required: true },
    gender: { type: String, required: true, enum: ["Male", "Female"] },
    maritalStatus: {
      type: String,
      required: true,
      enum: ["Single", "Married", "Divorced", "Widowed"],
    },
    weddingAnniversary: { type: Date, default: null },
    spouseName: { type: String, trim: true, maxlength: 120, default: "" },
    spousePhone: { type: String, trim: true, default: "" },
    numberOfChildren: { type: Number, min: 0, max: 100, default: null },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    membershipStatus: {
      type: String,
      required: true,
      enum: ["New Member", "Existing Member", "First-time visitor"],
    },
    wsfLocation: { type: String, trim: true, maxlength: 120, default: "" },
    serviceUnit: { type: String, trim: true, maxlength: 80, default: "" },
    birthdayAnniversarySmsConsent: { type: Boolean, required: true, default: false },
    consent: { type: Boolean, required: true, default: false },
    editTokenHash: { type: String, required: true, select: false },
    editCount: { type: Number, default: 0, min: 0, max: 3 },
  },
  { timestamps: true },
);

churchMemberSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    fullName: this.fullName,
    title: this.title,
    phone: this.phone,
    email: this.email,
    dateOfBirth: this.dateOfBirth,
    gender: this.gender,
    maritalStatus: this.maritalStatus,
    weddingAnniversary: this.weddingAnniversary,
    spouseName: this.spouseName,
    spousePhone: this.spousePhone,
    numberOfChildren: this.numberOfChildren,
    address: this.address,
    membershipStatus: this.membershipStatus,
    wsfLocation: this.wsfLocation,
    serviceUnit: this.serviceUnit,
    birthdayAnniversarySmsConsent: this.birthdayAnniversarySmsConsent,
    consent: this.consent,
    editCount: this.editCount,
    editsRemaining: Math.max(0, 3 - this.editCount),
    createdAt: this.createdAt,
  };
};

export default mongoose.model("ChurchMember", churchMemberSchema);
