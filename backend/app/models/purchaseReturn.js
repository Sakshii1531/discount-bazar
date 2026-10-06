import mongoose from "mongoose";

const purchaseReturnSchema = new mongoose.Schema(
  {
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", required: true, index: true },
    supplier: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", default: null },
    returnNo: { type: String, required: true },
    purchaseBill: { type: mongoose.Schema.Types.ObjectId, ref: "PurchaseBill", default: null },
    date: { type: Date, default: Date.now },
    items: [
      {
        _id: false,
        product: { type: mongoose.Schema.Types.ObjectId, ref: "Product", required: true },
        name: String,
        variantSku: { type: String, default: "" },
        quantity: { type: Number, required: true, min: 1 },
        cost: { type: Number, required: true, min: 0 },
        gstPercent: { type: Number, default: 0 },
        purchaseGstType: { type: String, enum: ["INCLUSIVE", "EXCLUSIVE"], default: "EXCLUSIVE" },
        lineTotal: { type: Number, default: 0 },
      },
    ],
    total: { type: Number, default: 0 },
    reason: { type: String, default: "" },
  },
  { timestamps: true },
);

purchaseReturnSchema.index({ seller: 1, date: -1 });

export default mongoose.model("PurchaseReturn", purchaseReturnSchema);
