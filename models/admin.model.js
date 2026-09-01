import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { ADMIN_ROLE, ADMIN_ROLES } from "../config/constants.js";

/**
 * Administrators live in their own collection with their own login route
 * (POST /api/admin/auth/login) and their own JWT secret.
 *
 * Keeping them separate from `users` means a student token can never satisfy an
 * admin guard — the tokens are signed with different secrets and looked up in
 * different collections — and student self-service routes can never
 * accidentally grant elevated access.
 */
const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address."],
    },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ADMIN_ROLES, default: ADMIN_ROLE.ADMIN },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

adminSchema.pre("save", async function hashPassword() {
  if (!this.isModified("password")) return;
  this.password = await bcrypt.hash(this.password, 12);
});

adminSchema.methods.comparePassword = function comparePassword(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

adminSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    id: this._id,
    name: this.name,
    email: this.email,
    role: this.role,
    lastLoginAt: this.lastLoginAt,
    createdAt: this.createdAt,
  };
};

export default mongoose.model("Admin", adminSchema);
