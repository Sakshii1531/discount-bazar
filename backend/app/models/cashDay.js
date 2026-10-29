import mongoose from "mongoose";

// Opening cash (and optionally physically counted closing cash) per day.
const cashDaySchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true },
    dateKey: { type: String, required: true }, // YYYY-MM-DD
    openingCash: { type: Number, default: 0 },
    countedClosingCash: { type: Number, default: null },
    closed: { type: Boolean, default: false },
    closedAt: { type: Date, default: null },
    // Audit trail of every close and reopen (a finalized day is never edited in place).
    history: [
      {
        _id: false,
        action: { type: String, enum: ["CLOSED", "REOPENED"], required: true },
        at: { type: Date, default: Date.now },
        countedClosingCash: { type: Number, default: null },
        // Required when reopening: why a finalized closing is being changed.
        reason: { type: String, trim: true, default: "" },
      },
    ],
  },
  { timestamps: true },
);

cashDaySchema.index({ seller: 1, dateKey: 1 }, { unique: true });

export default mongoose.model("CashDay", cashDaySchema);
