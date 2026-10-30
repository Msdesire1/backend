import mongoose from "mongoose";

const churchMemberMessageSchema = new mongoose.Schema(
  {
    member: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChurchMember",
      required: true,
    },
    event: { type: String, required: true, enum: ["birthday", "anniversary"] },
    year: { type: Number, required: true },
    status: {
      type: String,
      required: true,
      enum: ["processing", "sent", "failed"],
      default: "processing",
    },
    leaseUntil: { type: Date, required: true },
    sentAt: { type: Date, default: null },
    error: { type: String, default: "", maxlength: 300 },
  },
  { timestamps: true },
);

churchMemberMessageSchema.index({ member: 1, event: 1, year: 1 }, { unique: true });

export default mongoose.model("ChurchMemberMessage", churchMemberMessageSchema);
