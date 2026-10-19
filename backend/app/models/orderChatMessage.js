import mongoose from "mongoose";
import { COMM_CHANNEL } from "../constants/orderCommunication.js";

/**
 * A single chat message. `seq` is allocated by the server from the
 * conversation counter and is the only ordering clients should trust.
 * `clientMessageId` is generated once by the sending device and reused on
 * every retry, so a retried send resolves to the already-stored message
 * instead of creating a duplicate.
 */
const orderChatMessageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrderConversation",
      required: true,
    },
    orderId: { type: String, required: true, index: true },
    channel: {
      type: String,
      enum: Object.values(COMM_CHANNEL),
      required: true,
    },
    seq: { type: Number, required: true },
    senderRole: {
      type: String,
      enum: ["customer", "seller", "delivery"],
      required: true,
    },
    senderId: { type: mongoose.Schema.Types.ObjectId, required: true },
    clientMessageId: { type: String, required: true },
    type: { type: String, enum: ["text"], default: "text" },
    text: { type: String, required: true },
    // TTL — retention is configured centrally (messageRetentionDays).
    expiresAt: { type: Date },
  },
  { timestamps: true },
);

orderChatMessageSchema.index({ conversationId: 1, seq: 1 }, { unique: true });
orderChatMessageSchema.index(
  { conversationId: 1, senderId: 1, clientMessageId: 1 },
  { unique: true },
);
orderChatMessageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.models.OrderChatMessage ||
  mongoose.model("OrderChatMessage", orderChatMessageSchema);
