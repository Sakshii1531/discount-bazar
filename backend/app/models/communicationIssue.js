import mongoose from "mongoose";
import { COMM_CHANNEL } from "../constants/orderCommunication.js";

/**
 * "Report Issue" record raised from a customer/seller/rider communication
 * flow. Reporting never changes the order status — it only records the
 * problem and routes it to operations (and the existing support ticket desk).
 */
const communicationIssueSchema = new mongoose.Schema(
  {
    orderMongoId: { type: mongoose.Schema.Types.ObjectId, ref: "Order", required: true },
    orderId: { type: String, required: true, index: true },
    channel: { type: String, enum: Object.values(COMM_CHANNEL), required: true },
    reporterRole: {
      type: String,
      enum: ["customer", "seller", "delivery"],
      required: true,
    },
    reporterId: { type: mongoose.Schema.Types.ObjectId, required: true },
    riderId: { type: mongoose.Schema.Types.ObjectId, ref: "Delivery" },
    reason: { type: String, required: true },
    note: { type: String, default: "", maxlength: 500 },
    clientRequestId: { type: String },
    status: {
      type: String,
      enum: ["open", "acknowledged", "resolved"],
      default: "open",
      index: true,
    },
    isPickupDelay: { type: Boolean, default: false },
    escalatedAt: Date,
    resolvedAt: Date,
    resolutionNote: String,
    ticketId: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket" },
  },
  { timestamps: true },
);

communicationIssueSchema.index(
  { reporterId: 1, clientRequestId: 1 },
  { unique: true, partialFilterExpression: { clientRequestId: { $type: "string" } } },
);
communicationIssueSchema.index({ status: 1, isPickupDelay: 1, escalatedAt: 1, createdAt: 1 });

export default mongoose.models.CommunicationIssue ||
  mongoose.model("CommunicationIssue", communicationIssueSchema);
