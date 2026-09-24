import mongoose from "mongoose";

/**
 * A walk-in counter return/refund against a POS sale (see posSaleService.js).
 * One document per return transaction — a cashier can return several lines
 * from the same order in one go. Unlike the online-order return flow
 * (Order.returnStatus / returnItems — pickup + QC + delivery-partner legs),
 * a POS return is immediate: the item is physically in the cashier's hand,
 * so there is no separate request/approve/pickup state machine. Restocking
 * only happens for items marked "good" — "damaged" items are logged here
 * for audit but never touch Product.stock, so they can't be resold.
 */
const posReturnItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    productName: String,
    variantSlot: String,
    quantity: {
      type: Number,
      required: true,
      min: 1,
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    refundAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    condition: {
      type: String,
      enum: ["good", "damaged"],
      required: true,
    },
    restocked: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

const posReturnSchema = new mongoose.Schema(
  {
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    orderId: {
      type: String,
      required: true,
      index: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Seller",
      required: true,
      index: true,
    },
    items: {
      type: [posReturnItemSchema],
      validate: (v) => Array.isArray(v) && v.length > 0,
    },
    refundMethod: {
      type: String,
      enum: ["CASH", "CARD", "QR", "CREDIT"],
      required: true,
    },
    refundTotal: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { timestamps: true },
);

posReturnSchema.index({ seller: 1, createdAt: -1 });

export default mongoose.model("PosReturn", posReturnSchema);
