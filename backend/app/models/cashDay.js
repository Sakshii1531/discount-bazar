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
  },
  { timestamps: true },
);

cashDaySchema.index({ seller: 1, dateKey: 1 }, { unique: true });

export default mongoose.model("CashDay", cashDaySchema);
