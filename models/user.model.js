import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const nameValidator = {
  validator: (value) => /^[a-zA-Z][a-zA-Z '-]{1,49}$/.test(value),
  message:
    "Names must contain 2-50 letters and may include spaces, apostrophes, or hyphens.",
};

const userSchema = new mongoose.Schema(
  { 
    firstName: {
      type: String,
      required: true,
      trim: true,
      validate: nameValidator,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
      validate: nameValidator,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address."],
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
      match: [
        /^\+[1-9]\d{7,14}$/,
        "Use an international phone number, e.g. +2348000000000.",
      ],
    },
    password: { type: String, required: true, minlength: 8, select: false },
    // acceptedTermsAt: { type: Date, required: true },
    registrationComplete: { type: Boolean, default: false },
    emailVerified: { type: Boolean, default: false },
    emailOtpHash: { type: String, select: false },
    emailOtpExpires: { type: Date, select: false },
    profile: {
      dateOfBirth: Date,
      gender: { type: String, enum: ["female", "male", "prefer_not_to_say"] },
      address: { type: String, trim: true, maxlength: 200 },
      city: { type: String, trim: true, maxlength: 80 },
      state: { type: String, trim: true, maxlength: 80 },
      country: { type: String, trim: true, maxlength: 80 },
      homeChurch: { type: String, trim: true, maxlength: 120 },
      emergencyContactName: { type: String, trim: true, maxlength: 100 },
      emergencyContactPhone: { type: String, trim: true },
    },
    passwordResetToken: { type: String, select: false },
    passwordResetExpires: { type: Date, select: false },
  },
  { timestamps: true },
);

userSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = function comparePassword(
  candidatePassword,
) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    firstName: this.firstName,
    lastName: this.lastName,
    email: this.email,
    phoneNumber: this.phoneNumber,
    registrationComplete: this.registrationComplete,
    emailVerified: this.emailVerified,
    profile: this.profile,
    createdAt: this.createdAt,
  };
};

export default mongoose.model("User", userSchema);
