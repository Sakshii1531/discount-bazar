import mongoose from "mongoose";

// Store-level customer (udhaar / credit ledger holder). Distinct from the
// app User model: counter customers usually have no app account.
const posCustomerSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true, default: "" },
    address: { type: String, trim: true, default: "" },
  },
  { timestamps: true },
);

export default mongoose.model("PosCustomer", posCustomerSchema);
