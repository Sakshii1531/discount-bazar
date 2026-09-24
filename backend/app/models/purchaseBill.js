import mongoose from "mongoose";

const itemSchema = new mongoose.Schema(
  {
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
    name: String,
    variantSku: { type: String, default: "" },
    quantity: { type: Number, required: true, min: 1 },
    cost: { type: Number, required: true, min: 0 }, // per unit, ex-GST
    gstPercent: { type: Number, default: 0, min: 0 },
    lineTotal: { type: Number, default: 0 },
  },
  { _id: false },
);

const purchaseBillSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", required: true },
    billNo: { type: String, required: true, trim: true },
    billDate: { type: Date, default: Date.now },
    items: { type: [itemSchema], validate: (v) => v.length > 0 },
    subtotal: { type: Number, default: 0 },
    gstTotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    amountPaid: { type: Number, default: 0, min: 0 },
    paymentMethod: { type: String, enum: ["CASH", "CARD", "UPI", "OTHER", ""], default: "" },
    status: { type: String, enum: ["DRAFT", "CONFIRMED", "CANCELLED"], default: "DRAFT" },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

purchaseBillSchema.index({ seller: 1, billDate: -1 });

export default mongoose.model("PurchaseBill", purchaseBillSchema);
