import mongoose from "mongoose";

const expenseSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    category: { type: String, trim: true, default: "General" },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ["CASH", "CARD", "UPI", "OTHER"], default: "CASH" },
    note: { type: String, trim: true, default: "" },
    date: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

expenseSchema.index({ seller: 1, date: -1 });

export default mongoose.model("Expense", expenseSchema);
