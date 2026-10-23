import mongoose from "mongoose";
import {
  CANCELLATION_STATUS,
  CANCELLATION_TYPE,
  INVENTORY_STATUS,
  NOTIFICATION_DELIVERY_STATUS,
  REFUND_SOURCE,
  REFUND_STATUS,
  RETURN_LEG_STATUS,
  SETTLEMENT_ADJUSTMENT_STATUS,
} from "../constants/cancellation.js";

const refundAllocationSchema = new mongoose.Schema(
  {
    source: { type: String, enum: Object.values(REFUND_SOURCE), required: true },
    // Where the money goes back to (WALLET or ORIGINAL_SOURCE).
    destination: { type: String, default: "WALLET" },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: Object.values(REFUND_STATUS),
      default: REFUND_STATUS.PENDING,
    },
    gatewayPaymentId: { type: String, default: null },
    gatewayRefundId: { type: String, default: null },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    initiatedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { _id: true },
);

const inventoryItemSchema = new mongoose.Schema(
  {
    itemIndex: Number,
    product: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    name: String,
    variantSku: { type: String, default: null },
    quantity: { type: Number, default: 0 },
    restoredQty: { type: Number, default: 0 },
    damagedQty: { type: Number, default: 0 },
    missingQty: { type: Number, default: 0 },
    note: { type: String, default: null },
  },
  { _id: false },
);

const notificationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    event: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: {
      type: String,
      enum: Object.values(NOTIFICATION_DELIVERY_STATUS),
      default: NOTIFICATION_DELIVERY_STATUS.PENDING,
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    sentAt: { type: Date, default: null },
  },
  { _id: false },
);

const auditEntrySchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    actorRole: { type: String, default: "system" },
    actorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    at: { type: Date, default: Date.now },
    previousStatus: { type: String, default: null },
    newStatus: { type: String, default: null },
    orderStatusBefore: { type: String, default: null },
    orderStatusAfter: { type: String, default: null },
    financial: { type: mongoose.Schema.Types.Mixed, default: undefined },
    note: { type: String, default: null },
  },
  { _id: false },
);

const adjustmentSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: Object.values(SETTLEMENT_ADJUSTMENT_STATUS),
      default: SETTLEMENT_ADJUSTMENT_STATUS.PENDING,
    },
    amount: { type: Number, default: 0 },
    detail: { type: String, default: null },
    ledgerEntryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "LedgerEntry" }],
    appliedAt: { type: Date, default: null },
  },
  { _id: false },
);

const orderCancellationSchema = new mongoose.Schema(
  {
    // One record per order. Withdrawn requests are reopened in place, so a
    // repeated or multi-device submit always lands on the same document.
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true,
    },
    orderId: { type: String, required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "Seller", index: true },
    deliveryBoy: { type: mongoose.Schema.Types.ObjectId, ref: "Delivery", index: true },
    type: { type: String, enum: Object.values(CANCELLATION_TYPE), required: true },
    status: {
      type: String,
      enum: Object.values(CANCELLATION_STATUS),
      required: true,
      index: true,
    },
    reasonCode: { type: String, default: "OTHER" },
    reasonText: { type: String, default: null },
    initiatedBy: {
      role: { type: String, default: "customer" },
      id: { type: mongoose.Schema.Types.ObjectId, default: null },
    },
    // Order state when the request was made.
    stageAtRequest: { type: String, default: null },
    workflowStatusAtRequest: { type: String, default: null },
    paymentModeAtRequest: { type: String, default: null },
    paymentStatusAtRequest: { type: String, default: null },
    orderAmount: { type: Number, default: 0 },
    afterPickup: { type: Boolean, default: false },
    // Seller / platform / admin cancellations refund every charge.
    fullRefund: { type: Boolean, default: false },
    idempotencyKey: { type: String, default: null },

    requestedAt: { type: Date, default: Date.now },
    reviewStartedAt: { type: Date, default: null },
    decidedAt: { type: Date, default: null },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
    decisionNote: { type: String, default: null },
    cancelledAt: { type: Date, default: null },
    withdrawnAt: { type: Date, default: null },
    transferredAt: { type: Date, default: null },
    transferNote: { type: String, default: null },

    refund: {
      status: {
        type: String,
        enum: Object.values(REFUND_STATUS),
        default: REFUND_STATUS.PENDING,
        index: true,
      },
      // What the customer paid, and what policy allows back.
      paidWallet: { type: Number, default: 0 },
      paidGateway: { type: Number, default: 0 },
      amount: { type: Number, default: 0 },
      deductions: { type: mongoose.Schema.Types.Mixed, default: {} },
      allocations: { type: [refundAllocationSchema], default: [] },
      // Waiting for the gateway to settle an unconfirmed online payment.
      awaitingPaymentConfirmation: { type: Boolean, default: false },
      lastError: { type: String, default: null },
      initiatedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      manualResolution: {
        by: { type: mongoose.Schema.Types.ObjectId, ref: "Admin", default: null },
        at: { type: Date, default: null },
        note: { type: String, default: null },
      },
    },

    inventory: {
      status: {
        type: String,
        enum: Object.values(INVENTORY_STATUS),
        default: INVENTORY_STATUS.PENDING,
        index: true,
      },
      items: { type: [inventoryItemSchema], default: [] },
      restoredAt: { type: Date, default: null },
      inspectedAt: { type: Date, default: null },
      inspectedBy: {
        role: { type: String, default: null },
        id: { type: mongoose.Schema.Types.ObjectId, default: null },
      },
      inspectionNote: { type: String, default: null },
    },

    returnLeg: {
      status: {
        type: String,
        enum: Object.values(RETURN_LEG_STATUS),
        default: RETURN_LEG_STATUS.NOT_REQUIRED,
        index: true,
      },
      instructedAt: { type: Date, default: null },
      returnedAt: { type: Date, default: null },
      riderNote: { type: String, default: null },
    },

    settlement: {
      seller: { type: adjustmentSchema, default: () => ({}) },
      rider: { type: adjustmentSchema, default: () => ({}) },
      cod: { type: adjustmentSchema, default: () => ({}) },
    },

    notifications: { type: [notificationSchema], default: [] },

    // Post-commit work (stock, refund, settlement, notifications) is retried
    // by the reconcile job until everything has settled.
    processing: {
      state: {
        type: String,
        enum: ["PENDING", "DONE", "FAILED"],
        default: "PENDING",
        index: true,
      },
      attempts: { type: Number, default: 0 },
      lastError: { type: String, default: null },
      nextRetryAt: { type: Date, default: Date.now, index: true },
      lockedUntil: { type: Date, default: null },
      // One-shot steps already completed (workflow cleanup, compensation).
      steps: { type: mongoose.Schema.Types.Mixed, default: {} },
    },

    // Support ticket opened when a pending request had to move to the
    // delivery-dispute / return workflow.
    disputeTicket: { type: mongoose.Schema.Types.ObjectId, ref: "Ticket", default: null },

    auditLog: { type: [auditEntrySchema], default: [] },
  },
  { timestamps: true },
);

orderCancellationSchema.index({ status: 1, createdAt: -1 });
orderCancellationSchema.index({ "processing.state": 1, "processing.nextRetryAt": 1 });
orderCancellationSchema.index({ seller: 1, "inventory.status": 1, createdAt: -1 });
orderCancellationSchema.index({ deliveryBoy: 1, "returnLeg.status": 1 });
orderCancellationSchema.index({ reasonCode: 1, createdAt: -1 });
orderCancellationSchema.index({ "refund.allocations.gatewayRefundId": 1 }, { sparse: true });

export default mongoose.model("OrderCancellation", orderCancellationSchema);
