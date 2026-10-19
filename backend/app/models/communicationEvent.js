import mongoose from "mongoose";
import { COMM_EVENT } from "../constants/orderCommunication.js";

/**
 * Append-only audit trail for communication-related order events, reviewed
 * by Super Admin / operations. Holds no phone numbers or message bodies.
 * `eventKey` makes repeated processing of the same event a no-op.
 */
const communicationEventSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, index: true },
    type: { type: String, enum: Object.values(COMM_EVENT), required: true, index: true },
    actorRole: { type: String, default: "system" },
    actorId: { type: mongoose.Schema.Types.ObjectId },
    eventKey: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

communicationEventSchema.index(
  { eventKey: 1 },
  { unique: true, partialFilterExpression: { eventKey: { $type: "string" } } },
);
communicationEventSchema.index({ createdAt: -1 });

export default mongoose.models.CommunicationEvent ||
  mongoose.model("CommunicationEvent", communicationEventSchema);
