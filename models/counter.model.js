/**
 * Atomic sequence counters.
 *
 * Human-readable references (APP-1284, PAY-26041, WOF/26/01482) need to be
 * gapless and collision-free even with concurrent writes. `findOneAndUpdate`
 * with `$inc` and `upsert` is a single atomic document operation, so two
 * simultaneous submissions can never receive the same number.
 */
import mongoose from "mongoose";

const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  sequence: { type: Number, default: 0 },
});

const Counter = mongoose.model("Counter", counterSchema);

/** Increments `key` and returns the new value. */
export const nextSequence = async (key) => {
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return counter.sequence;
};

export default Counter;
