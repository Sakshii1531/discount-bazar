import mongoose from "mongoose";

// Manual cash-drawer movements (owner deposit / withdrawal etc.).
const cashEntrySchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    direction: { type: String, enum: ["IN", "OUT"], required: true },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, default: "" },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

cashEntrySchema.index({ seller: 1, date: -1 });

export default mongoose.model("CashEntry", cashEntrySchema);
