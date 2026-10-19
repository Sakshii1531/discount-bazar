import mongoose from "mongoose";
import { COMM_CHANNEL } from "../constants/orderCommunication.js";

/**
 * One conversation per (order, channel, rider assignment). A reassigned rider
 * gets a fresh conversation, so the new rider never inherits the previous
 * rider's private history and the old rider's thread is revoked in place.
 *
 * Receipts are stored as high-water marks per side rather than per message:
 * every message with `seq <= readSeq` has been read by that side.
 */
const sideReceiptSchema = new mongoose.Schema(
  {
    deliveredSeq: { type: Number, default: 0 },
    readSeq: { type: Number, default: 0 },
  },
  { _id: false },
);

const orderConversationSchema = new mongoose.Schema(
  {
    orderMongoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
    },
    orderId: { type: String, required: true, index: true },
    channel: {
      type: String,
      enum: Object.values(COMM_CHANNEL),
      required: true,
    },
    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Delivery",
      required: true,
      index: true,
    },
    // Exactly one of these is set, depending on channel.
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sellerId: { type: mongoose.Schema.Types.ObjectId, ref: "Seller" },
    assignmentVersion: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["active", "closed", "revoked"],
      default: "active",
      index: true,
    },
    closedAt: Date,
    closedReason: String,
    lastSeq: { type: Number, default: 0 },
    lastMessageAt: Date,
    receipts: {
      rider: { type: sideReceiptSchema, default: () => ({}) },
      counterpart: { type: sideReceiptSchema, default: () => ({}) },
    },
  },
  { timestamps: true },
);

orderConversationSchema.index(
  { orderId: 1, channel: 1, riderId: 1 },
  { unique: true },
);
orderConversationSchema.index({ orderId: 1, status: 1 });

export default mongoose.models.OrderConversation ||
  mongoose.model("OrderConversation", orderConversationSchema);
