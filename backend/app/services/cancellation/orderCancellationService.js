/**
 * Order cancellation orchestration.
 *
 * Commit point: every cancellation is a single conditional update on the
 * Order whose filter names the states the cancel is valid from. Seller
 * accept, rider accept, rider pickup and delivery OTP all use the same
 * pattern on their own pre-states, so whichever commits first wins and the
 * other is rejected — there is exactly one final state.
 *
 * The order update, the OrderCancellation record, the stock release and the
 * outbox notifications commit in one transaction. Everything that talks to
 * the outside world (refunds, payouts, push, sockets) runs afterwards from
 * `processCancellation`, which is idempotent and retried by the reconcile job
 * until it settles — so a crash or an external outage leaves accurate
 * statuses and finishes later instead of half-applying work.
 */
import mongoose from "mongoose";
import Order from "../../models/order.js";
import OrderCancellation from "../../models/orderCancellation.js";
import DeliveryAssignment from "../../models/deliveryAssignment.js";
import Seller from "../../models/seller.js";
import Ticket from "../../models/ticket.js";
import { WORKFLOW_STATUS } from "../../constants/orderWorkflow.js";
import {
  CANCELLATION_ACTION,
  CANCELLATION_REASONS,
  CANCELLATION_REASON_CODES,
  CANCELLATION_STAGE,
  CANCELLATION_STATUS,
  CANCELLATION_TYPE,
  INVENTORY_STATUS,
  MAX_REASON_TEXT_LENGTH,
  OPEN_REQUEST_STATUSES,
  ORDER_CANCELLED_STATUSES,
  RECONCILE_BASE_DELAY_MS,
  RECONCILE_MAX_ATTEMPTS,
  REFUND_STATUS,
  RETURN_LEG_STATUS,
  SETTLEMENT_ADJUSTMENT_STATUS,
  cancellationReasonLabel,
} from "../../constants/cancellation.js";
import {
  evaluateCancellationEligibility,
  isPrePickupStage,
  resolveCancellationStage,
  selfCancelStateClauses,
} from "./cancellationEligibility.js";
import { getCancellationPolicy } from "./cancellationPolicyService.js";
import {
  broadcastStockUpdates,
  normalizeInspection,
  restoreInspectedInventory,
  restoreReservedInventory,
} from "./cancellationInventoryService.js";
import {
  addLateCaptureAllocation,
  processCancellationRefund,
} from "./cancellationRefundService.js";
import { applyCancellationSettlement } from "./cancellationSettlementService.js";
import { dispatchCancellationNotifications } from "./cancellationNotificationService.js";
import { appendAudit, outboxEntry, queueNotification, serviceError } from "./cancellationRecordHelpers.js";
import { compensateOrderCancellation } from "../orderCompensation.js";
import { removeDeliveryTimeout, removeSellerTimeout } from "../workflow/jobSchedulerPort.js";
import {
  emitOrderStatusUpdate,
  emitToDelivery,
  emitToSeller,
  retractDeliveryBroadcastForOrder,
} from "../orderSocketEmitter.js";
import { buildKey, invalidate } from "../cacheService.js";
import { orderMatchQueryFromRouteParam } from "../../utils/orderLookup.js";
import { roundCurrency } from "../../utils/money.js";
import logger from "../logger.js";

const LOST_RACE = "CANCELLATION_LOST_RACE";
const PROCESSING_LOCK_MS = 2 * 60 * 1000;

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function idStr(value) {
  if (!value) return null;
  return String(value?._id || value);
}

function orderAmount(order) {
  return roundCurrency(Number(order?.paymentBreakdown?.grandTotal ?? order?.pricing?.total ?? 0));
}

function legacyStatus(order) {
  return String(order?.status || "").toLowerCase();
}

function describeReason(reasonCode, reasonText) {
  const label = cancellationReasonLabel(reasonCode);
  return reasonText ? `${label}: ${reasonText}` : label;
}

function normalizeReason({ reasonCode, reasonText }) {
  const code = String(reasonCode || "").trim().toUpperCase();
  if (!CANCELLATION_REASON_CODES.includes(code)) {
    throw serviceError("Please select a valid cancellation reason", 400, "INVALID_REASON");
  }
  const text = String(reasonText || "").trim();
  if (text.length > MAX_REASON_TEXT_LENGTH) {
    throw serviceError(`Details must be ${MAX_REASON_TEXT_LENGTH} characters or fewer`, 400, "REASON_TOO_LONG");
  }
  return { reasonCode: code, reasonText: text || null };
}

async function findOrderOr404(orderParam, extraFilter = {}) {
  const key = orderMatchQueryFromRouteParam(orderParam);
  if (!key) throw serviceError("Order not found", 404, "ORDER_NOT_FOUND");
  const order = await Order.findOne({ ...key, ...extraFilter });
  if (!order) throw serviceError("Order not found", 404, "ORDER_NOT_FOUND");
  return order;
}

async function invalidateCustomerOrders(customerId) {
  if (!customerId) return;
  try {
    await invalidate(buildKey("orders", "customer", `${idStr(customerId)}:*`));
  } catch {
    /* cache is advisory */
  }
}

async function runTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    session.endSession();
  }
}

function orderSummary(record, overrides = {}) {
  return {
    "cancellation.recordId": record?._id || null,
    "cancellation.type": record?.type || overrides.type || null,
    "cancellation.status": overrides.status || record?.status || null,
    "cancellation.reasonCode": record?.reasonCode || overrides.reasonCode || null,
    "cancellation.refundStatus": overrides.refundStatus ?? record?.refund?.status ?? null,
    "cancellation.requestedAt": record?.requestedAt || overrides.requestedAt || null,
  };
}

function cancelledOrderSet(order, { cancelledBy, reason, now }) {
  const set = {
    status: "cancelled",
    orderStatus: "cancelled",
    cancelledBy,
    cancelReason: reason,
    cancelledAt: now,
  };
  if (Number(order.workflowVersion) >= 2) set.workflowStatus = WORKFLOW_STATUS.CANCELLED;
  return set;
}

/** Fields shared by every fresh / reopened record. */
function baseRecordFields(order, { type, status, actor, reasonCode, reasonText, stage, idempotencyKey, now }) {
  return {
    orderId: order.orderId,
    customer: order.customer?._id || order.customer,
    seller: order.seller?._id || order.seller || null,
    deliveryBoy: order.deliveryBoy?._id || order.deliveryBoy || null,
    type,
    status,
    reasonCode,
    reasonText,
    initiatedBy: { role: actor.role, id: actor.id || null },
    stageAtRequest: stage,
    workflowStatusAtRequest: order.workflowStatus || null,
    paymentModeAtRequest: order.paymentMode || null,
    paymentStatusAtRequest: order.paymentStatus || null,
    orderAmount: orderAmount(order),
    afterPickup: stage === CANCELLATION_STAGE.PICKED_UP,
    fullRefund: [CANCELLATION_TYPE.ADMIN, CANCELLATION_TYPE.SELLER, CANCELLATION_TYPE.SYSTEM].includes(type),
    idempotencyKey: idempotencyKey || null,
    requestedAt: now,
    reviewStartedAt: null,
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
    withdrawnAt: null,
    cancelledAt: null,
    refund: { status: REFUND_STATUS.PENDING, allocations: [], deductions: {} },
    inventory: { status: INVENTORY_STATUS.PENDING, items: [] },
    returnLeg: { status: RETURN_LEG_STATUS.NOT_REQUIRED },
    settlement: {
      seller: { status: SETTLEMENT_ADJUSTMENT_STATUS.PENDING },
      rider: { status: SETTLEMENT_ADJUSTMENT_STATUS.PENDING },
      cod: { status: SETTLEMENT_ADJUSTMENT_STATUS.PENDING },
    },
    "processing.state": "PENDING",
    "processing.attempts": 0,
    "processing.lastError": null,
    "processing.nextRetryAt": now,
    "processing.lockedUntil": null,
    "processing.steps": {},
  };
}

function stoppedPickupNotifications(order, { actorRole }) {
  const orderId = order.orderId;
  const who = actorRole === "customer" ? " by the customer" : actorRole === "admin" ? " by support" : "";
  const list = [
    outboxEntry({
      key: "order-cancelled",
      event: "ORDER_CANCELLED",
      payload: {
        orderId,
        customerId: order.customer,
        userId: order.customer,
        sellerId: order.seller,
        customerMessage: `Your order #${orderId} has been cancelled.`,
        sellerMessage: `Order #${orderId} was cancelled${who}. Stop picking and packing — do not hand it over.`,
      },
    }),
  ];
  if (order.deliveryBoy) {
    list.push(outboxEntry({
      key: "rider-stop-pickup",
      event: "RIDER_STOP_PICKUP",
      payload: { orderId, deliveryId: order.deliveryBoy },
    }));
  }
  return list;
}

/* ------------------------------------------------------------------ */
/* views                                                               */
/* ------------------------------------------------------------------ */

export function cancellationView(record, { role = "customer" } = {}) {
  if (!record) return null;
  const r = record.toObject ? record.toObject() : record;
  const view = {
    id: idStr(r._id),
    orderId: r.orderId,
    type: r.type,
    status: r.status,
    reasonCode: r.reasonCode,
    reasonLabel: cancellationReasonLabel(r.reasonCode),
    reasonText: r.reasonText,
    afterPickup: Boolean(r.afterPickup),
    requestedAt: r.requestedAt,
    decidedAt: r.decidedAt,
    // For a rejection this is the reason shown to the customer.
    decisionNote: r.decisionNote,
    cancelledAt: r.cancelledAt,
    withdrawnAt: r.withdrawnAt,
    refund: {
      status: r.refund?.status,
      amount: r.refund?.amount || 0,
      paidWallet: r.refund?.paidWallet || 0,
      paidGateway: r.refund?.paidGateway || 0,
      deductions: r.refund?.deductions || {},
      awaitingPaymentConfirmation: Boolean(r.refund?.awaitingPaymentConfirmation),
      completedAt: r.refund?.completedAt,
      allocations: (r.refund?.allocations || []).map((a) => ({
        id: idStr(a._id),
        source: a.source,
        destination: a.destination,
        amount: a.amount,
        status: a.status,
        completedAt: a.completedAt,
        ...(role === "admin"
          ? { gatewayRefundId: a.gatewayRefundId, attempts: a.attempts, lastError: a.lastError }
          : {}),
      })),
    },
    inventory: {
      status: r.inventory?.status,
      items: r.inventory?.items || [],
      inspectedAt: r.inventory?.inspectedAt,
    },
    returnLeg: { status: r.returnLeg?.status, returnedAt: r.returnLeg?.returnedAt },
  };
  if (role === "admin") {
    Object.assign(view, {
      customer: r.customer,
      seller: r.seller,
      deliveryBoy: r.deliveryBoy,
      initiatedBy: r.initiatedBy,
      stageAtRequest: r.stageAtRequest,
      paymentModeAtRequest: r.paymentModeAtRequest,
      paymentStatusAtRequest: r.paymentStatusAtRequest,
      orderAmount: r.orderAmount,
      fullRefund: r.fullRefund,
      refundLastError: r.refund?.lastError,
      manualResolution: r.refund?.manualResolution,
      settlement: r.settlement,
      notifications: (r.notifications || []).map((n) => ({
        key: n.key, event: n.event, status: n.status, attempts: n.attempts, lastError: n.lastError, sentAt: n.sentAt,
      })),
      processing: r.processing,
      disputeTicket: r.disputeTicket,
      auditLog: r.auditLog || [],
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }
  if (role === "seller" || role === "delivery") {
    delete view.refund;
  }
  return view;
}

function orderView(order) {
  return {
    _id: idStr(order._id),
    orderId: order.orderId,
    status: order.status,
    workflowStatus: order.workflowStatus || null,
    paymentMode: order.paymentMode,
    paymentStatus: order.paymentStatus,
    amount: orderAmount(order),
    itemCount: (order.items || []).reduce((s, i) => s + (Number(i.quantity) || 0), 0),
    cancelReason: order.cancelReason || null,
    cancelledAt: order.cancelledAt || null,
  };
}

/** Customer / staff view of an order's cancellation state. Always fresh. */
export async function getCancellationView({ orderParam, user }) {
  const role = String(user?.role || "").toLowerCase();
  const filter = {};
  if (role === "customer" || role === "user") filter.customer = user.id;
  else if (role === "seller") filter.seller = user.id;
  else if (role === "delivery") filter.deliveryBoy = user.id;
  else if (role !== "admin") throw serviceError("Access denied", 403);

  const order = await findOrderOr404(orderParam, filter);
  const [policy, record] = await Promise.all([
    getCancellationPolicy(),
    OrderCancellation.findOne({ order: order._id }),
  ]);
  const eligibility = evaluateCancellationEligibility(order, policy, record);
  const viewRole = role === "user" ? "customer" : role;
  return {
    order: orderView(order),
    eligibility,
    cancellation: cancellationView(record, { role: viewRole }),
    reasons: CANCELLATION_REASONS,
    policy: {
      allowWithdrawal: policy.allowWithdrawal,
      prepaidRefundTimelineText: policy.prepaidRefundTimelineText,
    },
  };
}

/** Lightweight eligibility for order lists (no record lookup unless needed). */
export async function decorateOrdersWithCancellation(orders = []) {
  if (!orders.length) return orders;
  const policy = await getCancellationPolicy();
  return orders.map((o) => {
    const record = o.cancellation?.status ? { status: o.cancellation.status } : null;
    const e = evaluateCancellationEligibility(o, policy, record);
    return {
      ...o,
      cancellationEligibility: {
        action: e.action,
        canSelfCancel: e.canSelfCancel,
        canRequest: e.canRequest,
        stage: e.stage,
      },
    };
  });
}

/* ------------------------------------------------------------------ */
/* direct (pre-pickup) cancellation                                    */
/* ------------------------------------------------------------------ */

async function executeDirectCancellation({
  order,
  type,
  actor,
  reasonCode,
  reasonText,
  policy,
  ignorePolicy = false,
  idempotencyKey = null,
  cancelledBy,
}) {
  const stage = resolveCancellationStage(order);
  const clauses = selfCancelStateClauses(order, policy, { ignorePolicy });
  if (!isPrePickupStage(stage) || clauses.length === 0) {
    throw serviceError("This order can no longer be cancelled at its current stage", 409, "NOT_CANCELLABLE");
  }

  const now = new Date();
  const reason = describeReason(reasonCode, reasonText);
  let stockUpdates = [];
  let recordId;

  try {
    await runTransaction(async (session) => {
      const updated = await Order.findOneAndUpdate(
        {
          _id: order._id,
          ...(actor.role === "customer" ? { customer: actor.id } : {}),
          pickupConfirmedAt: null,
          deliveredAt: null,
          status: { $nin: ["cancelled", "delivered", "out_for_delivery"] },
          $or: clauses,
        },
        {
          $set: {
            ...cancelledOrderSet(order, { cancelledBy, reason, now }),
            "cancellation.type": type,
            "cancellation.status": CANCELLATION_STATUS.CANCELLED,
            "cancellation.reasonCode": reasonCode,
            "cancellation.refundStatus": REFUND_STATUS.PENDING,
            "cancellation.requestedAt": now,
          },
          // A leftover expiry would let the seller-timeout job (or a TTL
          // sweep) act on an order that is already final.
          $unset: { expiresAt: 1 },
        },
        { new: true, session },
      );
      if (!updated) throw serviceError("lost race", 409, LOST_RACE);

      const record = await OrderCancellation.findOneAndUpdate(
        { order: order._id },
        {
          $set: {
            ...baseRecordFields(updated, {
              type,
              status: CANCELLATION_STATUS.CANCELLED,
              actor,
              reasonCode,
              reasonText,
              stage,
              idempotencyKey,
              now,
            }),
            cancelledAt: now,
          },
          $push: {
            auditLog: appendAudit({
              action: "ORDER_CANCELLED",
              actorRole: actor.role,
              actorId: actor.id,
              newStatus: CANCELLATION_STATUS.CANCELLED,
              orderStatusBefore: order.workflowStatus || legacyStatus(order),
              orderStatusAfter: updated.workflowStatus || "cancelled",
              note: reason,
            }),
            notifications: { $each: stoppedPickupNotifications(updated, { actorRole: actor.role }) },
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true, session },
      );
      recordId = record._id;

      // Exactly the reserved / deducted units, exactly once.
      const inventory = await restoreReservedInventory(updated, { session, reason: "Order cancelled" });
      stockUpdates = inventory.stockUpdates;
      await OrderCancellation.updateOne(
        { _id: record._id },
        {
          $set: {
            "inventory.status": inventory.restored ? INVENTORY_STATUS.RESTORED : INVENTORY_STATUS.NOT_REQUIRED,
            "inventory.items": inventory.items,
            "inventory.restoredAt": inventory.restored ? now : null,
          },
          $push: {
            auditLog: appendAudit({
              action: inventory.restored ? "INVENTORY_RESTORED" : "INVENTORY_ALREADY_RELEASED",
              financial: inventory.restored
                ? { units: inventory.items.reduce((s, i) => s + i.restoredQty, 0) }
                : undefined,
            }),
          },
        },
        { session },
      );
      await Order.updateOne({ _id: order._id }, { $set: { "cancellation.recordId": record._id } }, { session });
    });
  } catch (error) {
    if (error.code !== LOST_RACE) throw error;
    // Someone else committed first. Report the truth from the database.
    const fresh = await Order.findById(order._id);
    const existing = await OrderCancellation.findOne({ order: order._id });
    if (legacyStatus(fresh) === "cancelled" && existing && ORDER_CANCELLED_STATUSES.includes(existing.status)) {
      return { record: existing, duplicate: true };
    }
    const eligibility = evaluateCancellationEligibility(fresh, policy, existing);
    throw serviceError(
      eligibility.action === CANCELLATION_ACTION.REQUEST
        ? "Your order has just been picked up, so it can no longer be cancelled directly. You can request a cancellation instead."
        : "The order status changed while you were cancelling. Please review the latest status.",
      409,
      eligibility.action === CANCELLATION_ACTION.REQUEST ? "REQUEST_REQUIRED" : "STATUS_CHANGED",
      { eligibility },
    );
  }

  broadcastStockUpdates(stockUpdates);
  await invalidateCustomerOrders(order.customer);
  await safeProcess(recordId);
  return { record: await OrderCancellation.findById(recordId), duplicate: false };
}

/* ------------------------------------------------------------------ */
/* post-pickup request + approval                                      */
/* ------------------------------------------------------------------ */

const PICKED_UP_ORDER_FILTER = {
  deliveredAt: null,
  status: { $nin: ["cancelled", "delivered"] },
  $or: [
    { pickupConfirmedAt: { $ne: null } },
    { workflowStatus: WORKFLOW_STATUS.OUT_FOR_DELIVERY },
    { status: "out_for_delivery" },
  ],
};

async function createCancellationRequest({ order, actor, reasonCode, reasonText, idempotencyKey }) {
  const now = new Date();
  let recordId;
  try {
    await runTransaction(async (session) => {
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, customer: actor.id, ...PICKED_UP_ORDER_FILTER },
        {
          $set: {
            "cancellation.type": CANCELLATION_TYPE.CUSTOMER_REQUEST,
            "cancellation.status": CANCELLATION_STATUS.REQUESTED,
            "cancellation.reasonCode": reasonCode,
            "cancellation.refundStatus": null,
            "cancellation.requestedAt": now,
          },
        },
        { new: true, session },
      );
      if (!updated) throw serviceError("lost race", 409, LOST_RACE);

      const fields = baseRecordFields(updated, {
        type: CANCELLATION_TYPE.CUSTOMER_REQUEST,
        status: CANCELLATION_STATUS.REQUESTED,
        actor,
        reasonCode,
        reasonText,
        stage: CANCELLATION_STAGE.PICKED_UP,
        idempotencyKey,
        now,
      });
      const record = await OrderCancellation.findOneAndUpdate(
        {
          order: order._id,
          // Never reopen a record that already cancelled or decided the order.
          status: { $nin: [...ORDER_CANCELLED_STATUSES, ...OPEN_REQUEST_STATUSES, CANCELLATION_STATUS.REJECTED] },
        },
        {
          $set: fields,
          $push: {
            auditLog: appendAudit({
              action: "CANCELLATION_REQUESTED",
              actorRole: actor.role,
              actorId: actor.id,
              newStatus: CANCELLATION_STATUS.REQUESTED,
              orderStatusBefore: order.workflowStatus || legacyStatus(order),
              orderStatusAfter: order.workflowStatus || legacyStatus(order),
              note: describeReason(reasonCode, reasonText),
            }),
            notifications: outboxEntry({
              key: `requested-${now.getTime()}`,
              event: "CANCELLATION_REQUESTED",
              payload: {
                orderId: order.orderId,
                sellerId: order.seller,
                reasonLabel: cancellationReasonLabel(reasonCode),
              },
            }),
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true, session },
      );
      recordId = record._id;
      await Order.updateOne({ _id: order._id }, { $set: { "cancellation.recordId": record._id } }, { session });
    });
  } catch (error) {
    if (error.code === 11000) {
      // A concurrent submit created the request first.
      const existing = await OrderCancellation.findOne({ order: order._id });
      if (existing) return { record: existing, duplicate: true };
    }
    if (error.code !== LOST_RACE) throw error;
    const fresh = await Order.findById(order._id);
    const policy = await getCancellationPolicy();
    const existing = await OrderCancellation.findOne({ order: order._id });
    throw serviceError(
      "The order status changed. Please review the latest status.",
      409,
      "STATUS_CHANGED",
      { eligibility: evaluateCancellationEligibility(fresh, policy, existing) },
    );
  }
  await invalidateCustomerOrders(order.customer);
  await safeProcess(recordId);
  return { record: await OrderCancellation.findById(recordId), duplicate: false };
}

/**
 * Cancel an order whose parcel is already with the rider: the order stops
 * (delivery OTP can no longer complete it), the rider is told to bring the
 * parcel back, and stock / refund / settlement wait for the return.
 */
async function approvePostPickupCancellation({ order, record, actor, note, reasonCode, reasonText }) {
  const now = new Date();
  const isRequest = record && OPEN_REQUEST_STATUSES.includes(record.status);
  const type = isRequest ? record.type : CANCELLATION_TYPE.ADMIN;
  const effectiveReasonCode = isRequest ? record.reasonCode : reasonCode;
  const effectiveReasonText = isRequest ? record.reasonText : reasonText;
  const reason = describeReason(effectiveReasonCode, effectiveReasonText);
  let recordId;

  const store = order.seller
    ? await Seller.findById(order.seller).select("shopName").lean()
    : null;

  try {
    await runTransaction(async (session) => {
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, ...PICKED_UP_ORDER_FILTER },
        {
          $set: {
            ...cancelledOrderSet(order, {
              cancelledBy: isRequest ? "customer" : "admin",
              reason,
              now,
            }),
            "cancellation.type": type,
            "cancellation.status": CANCELLATION_STATUS.APPROVED,
            "cancellation.reasonCode": effectiveReasonCode,
            "cancellation.refundStatus": REFUND_STATUS.PENDING,
          },
          $unset: { expiresAt: 1 },
        },
        { new: true, session },
      );
      if (!updated) throw serviceError("lost race", 409, LOST_RACE);

      // With no rider on record the parcel is treated as already back.
      const returnLeg = updated.deliveryBoy
        ? { status: RETURN_LEG_STATUS.RETURN_TO_STORE, instructedAt: now }
        : { status: RETURN_LEG_STATUS.RETURNED_TO_STORE, instructedAt: now, returnedAt: now };
      const inventory = {
        status: updated.deliveryBoy ? INVENTORY_STATUS.AWAITING_RETURN : INVENTORY_STATUS.AWAITING_INSPECTION,
        items: (updated.items || []).map((item, index) => ({
          itemIndex: index,
          product: item.product,
          name: item.name,
          variantSku: item.variantSlot || null,
          quantity: item.quantity,
        })),
      };
      const decision = {
        status: CANCELLATION_STATUS.APPROVED,
        decidedAt: now,
        decidedBy: actor.role === "admin" ? actor.id : null,
        decisionNote: note || null,
        cancelledAt: now,
        deliveryBoy: updated.deliveryBoy || null,
        "processing.state": "PENDING",
        "processing.nextRetryAt": now,
      };
      const notifications = [
        outboxEntry(isRequest
          ? {
            key: "approved",
            event: "CANCELLATION_APPROVED",
            payload: { orderId: updated.orderId, customerId: updated.customer, userId: updated.customer },
          }
          : {
            key: "order-cancelled",
            event: "ORDER_CANCELLED",
            payload: {
              orderId: updated.orderId,
              customerId: updated.customer,
              userId: updated.customer,
              customerMessage: `Your order #${updated.orderId} was cancelled by support. Your refund follows once the parcel is back at the store.`,
            },
          }),
        outboxEntry({
          key: "seller-parcel-returning",
          event: "ORDER_CANCELLED",
          payload: {
            orderId: updated.orderId,
            sellerId: updated.seller,
            sellerMessage: `Order #${updated.orderId} was cancelled after pickup. The rider is bringing the parcel back — verify the items when it arrives.`,
          },
        }),
      ];
      if (updated.deliveryBoy) {
        notifications.push(outboxEntry({
          key: "rider-return-parcel",
          event: "RIDER_RETURN_PARCEL",
          payload: { orderId: updated.orderId, deliveryId: updated.deliveryBoy, storeName: store?.shopName },
        }));
      }
      const audit = appendAudit({
        action: isRequest ? "CANCELLATION_APPROVED" : "ADMIN_CANCELLED_AFTER_PICKUP",
        actorRole: actor.role,
        actorId: actor.id,
        previousStatus: record?.status || null,
        newStatus: CANCELLATION_STATUS.APPROVED,
        orderStatusBefore: order.workflowStatus || legacyStatus(order),
        orderStatusAfter: updated.workflowStatus || "cancelled",
        note: note || reason,
      });

      let saved;
      if (isRequest) {
        saved = await OrderCancellation.findOneAndUpdate(
          { _id: record._id, status: { $in: OPEN_REQUEST_STATUSES } },
          {
            $set: {
              ...decision,
              returnLeg,
              "inventory.status": inventory.status,
              "inventory.items": inventory.items,
              "refund.status": REFUND_STATUS.PENDING,
            },
            $push: { auditLog: audit, notifications: { $each: notifications } },
          },
          { new: true, session },
        );
        if (!saved) throw serviceError("This request was already decided or withdrawn", 409, "REQUEST_CLOSED");
      } else {
        const fields = baseRecordFields(updated, {
          type,
          status: CANCELLATION_STATUS.APPROVED,
          actor,
          reasonCode: effectiveReasonCode,
          reasonText: effectiveReasonText,
          stage: CANCELLATION_STAGE.PICKED_UP,
          now,
        });
        saved = await OrderCancellation.findOneAndUpdate(
          { order: order._id },
          {
            $set: { ...fields, ...decision, returnLeg, inventory },
            $push: { auditLog: audit, notifications: { $each: notifications } },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true, session },
        );
      }
      recordId = saved._id;
      await Order.updateOne(
        { _id: order._id },
        { $set: { "cancellation.recordId": saved._id, "cancellation.requestedAt": saved.requestedAt } },
        { session },
      );
    });
  } catch (error) {
    if (error.code !== LOST_RACE) throw error;
    const fresh = await Order.findById(order._id);
    if (resolveCancellationStage(fresh) === CANCELLATION_STAGE.DELIVERED && record) {
      const transferred = await transferToDispute(record._id, "Order was delivered before the request was approved");
      throw serviceError(
        "The order was delivered before the request could be approved. It has been moved to the returns & disputes workflow.",
        409,
        "TRANSFERRED",
        { cancellation: cancellationView(transferred, { role: "admin" }) },
      );
    }
    throw serviceError("The order status changed. Please refresh and try again.", 409, "STATUS_CHANGED");
  }

  await invalidateCustomerOrders(order.customer);
  await safeProcess(recordId);
  return { record: await OrderCancellation.findById(recordId) };
}

/* ------------------------------------------------------------------ */
/* customer actions                                                    */
/* ------------------------------------------------------------------ */

export async function submitCustomerCancellation({
  customerId,
  orderParam,
  mode,
  reasonCode,
  reasonText,
  idempotencyKey = null,
}) {
  const reason = normalizeReason({ reasonCode, reasonText });
  const order = await findOrderOr404(orderParam, { customer: customerId });
  const [policy, existing] = await Promise.all([
    getCancellationPolicy(),
    OrderCancellation.findOne({ order: order._id }),
  ]);

  // Repeated clicks, a second device, a retry after a timeout: hand back the
  // existing result instead of doing anything again.
  if (existing && [...ORDER_CANCELLED_STATUSES, ...OPEN_REQUEST_STATUSES].includes(existing.status)) {
    return { record: existing, duplicate: true };
  }

  const eligibility = evaluateCancellationEligibility(order, policy, existing);
  const wanted = String(mode || "").toUpperCase() ||
    (eligibility.action === CANCELLATION_ACTION.REQUEST ? "REQUEST" : "CANCEL");
  const actor = { role: "customer", id: customerId };

  if (wanted === "CANCEL") {
    if (!eligibility.canSelfCancel) {
      throw serviceError(
        eligibility.message || "This order cannot be cancelled",
        409,
        eligibility.action === CANCELLATION_ACTION.REQUEST ? "REQUEST_REQUIRED" : "NOT_CANCELLABLE",
        { eligibility },
      );
    }
    return executeDirectCancellation({
      order,
      type: CANCELLATION_TYPE.CUSTOMER_DIRECT,
      actor,
      ...reason,
      policy,
      idempotencyKey,
      cancelledBy: "customer",
    });
  }
  if (wanted === "REQUEST") {
    if (!eligibility.canRequest) {
      throw serviceError(
        eligibility.message || "A cancellation request is not available for this order",
        409,
        eligibility.canSelfCancel ? "SELF_CANCEL_AVAILABLE" : "NOT_CANCELLABLE",
        { eligibility },
      );
    }
    return createCancellationRequest({ order, actor, ...reason, idempotencyKey });
  }
  throw serviceError("Unknown cancellation mode", 400, "INVALID_MODE");
}

export async function withdrawCancellationRequest({ customerId, orderParam }) {
  const policy = await getCancellationPolicy();
  if (!policy.allowWithdrawal) {
    throw serviceError("Cancellation requests cannot be withdrawn", 409, "WITHDRAWAL_DISABLED");
  }
  const order = await findOrderOr404(orderParam, { customer: customerId });
  const now = new Date();
  const record = await OrderCancellation.findOneAndUpdate(
    { order: order._id, customer: customerId, status: { $in: OPEN_REQUEST_STATUSES } },
    {
      $set: { status: CANCELLATION_STATUS.WITHDRAWN, withdrawnAt: now },
      $push: {
        auditLog: appendAudit({
          action: "CANCELLATION_WITHDRAWN",
          actorRole: "customer",
          actorId: customerId,
          newStatus: CANCELLATION_STATUS.WITHDRAWN,
        }),
        notifications: outboxEntry({
          key: `withdrawn-${now.getTime()}`,
          event: "CANCELLATION_WITHDRAWN",
          payload: { orderId: order.orderId, sellerId: order.seller },
        }),
      },
    },
    { new: true },
  );
  if (!record) {
    const existing = await OrderCancellation.findOne({ order: order._id });
    if (existing && ORDER_CANCELLED_STATUSES.includes(existing.status)) {
      throw serviceError("The cancellation has already been approved and can no longer be withdrawn", 409, "ALREADY_APPROVED");
    }
    throw serviceError("There is no open cancellation request to withdraw", 404, "NO_OPEN_REQUEST");
  }
  await Order.updateOne(
    { _id: order._id },
    { $set: { "cancellation.status": CANCELLATION_STATUS.WITHDRAWN } },
  );
  await invalidateCustomerOrders(customerId);
  await safeProcess(record._id);
  return { record };
}

/* ------------------------------------------------------------------ */
/* admin actions                                                       */
/* ------------------------------------------------------------------ */

async function loadRecordOr404(recordId) {
  if (!mongoose.Types.ObjectId.isValid(String(recordId))) {
    throw serviceError("Cancellation not found", 404);
  }
  const record = await OrderCancellation.findById(recordId);
  if (!record) throw serviceError("Cancellation not found", 404);
  return record;
}

export async function markUnderReview({ adminId, recordId }) {
  const record = await OrderCancellation.findOneAndUpdate(
    { _id: recordId, status: CANCELLATION_STATUS.REQUESTED },
    {
      $set: { status: CANCELLATION_STATUS.UNDER_REVIEW, reviewStartedAt: new Date() },
      $push: {
        auditLog: appendAudit({
          action: "REVIEW_STARTED",
          actorRole: "admin",
          actorId: adminId,
          previousStatus: CANCELLATION_STATUS.REQUESTED,
          newStatus: CANCELLATION_STATUS.UNDER_REVIEW,
        }),
      },
    },
    { new: true },
  );
  if (!record) {
    const existing = await loadRecordOr404(recordId);
    if (existing.status === CANCELLATION_STATUS.UNDER_REVIEW) return { record: existing };
    throw serviceError("Only new requests can be moved to review", 409);
  }
  await Order.updateOne({ _id: record.order }, { $set: { "cancellation.status": record.status } });
  return { record };
}

export async function rejectCancellationRequest({ adminId, recordId, reason }) {
  const note = String(reason || "").trim();
  if (note.length < 3) throw serviceError("A rejection reason is required", 400, "REASON_REQUIRED");
  const existing = await loadRecordOr404(recordId);
  const record = await OrderCancellation.findOneAndUpdate(
    { _id: recordId, status: { $in: OPEN_REQUEST_STATUSES } },
    {
      $set: {
        status: CANCELLATION_STATUS.REJECTED,
        decidedAt: new Date(),
        decidedBy: adminId,
        decisionNote: note.slice(0, MAX_REASON_TEXT_LENGTH),
        "refund.status": REFUND_STATUS.NOT_REQUIRED,
        "inventory.status": INVENTORY_STATUS.NOT_REQUIRED,
        "settlement.seller.status": SETTLEMENT_ADJUSTMENT_STATUS.NOT_REQUIRED,
        "settlement.rider.status": SETTLEMENT_ADJUSTMENT_STATUS.NOT_REQUIRED,
        "settlement.cod.status": SETTLEMENT_ADJUSTMENT_STATUS.NOT_REQUIRED,
      },
      $push: {
        auditLog: appendAudit({
          action: "CANCELLATION_REJECTED",
          actorRole: "admin",
          actorId: adminId,
          previousStatus: existing.status,
          newStatus: CANCELLATION_STATUS.REJECTED,
          note,
        }),
        notifications: outboxEntry({
          key: "rejected",
          event: "CANCELLATION_REJECTED",
          payload: { orderId: existing.orderId, customerId: existing.customer, userId: existing.customer, reason: note },
        }),
      },
    },
    { new: true },
  );
  if (!record) throw serviceError("This request was already decided or withdrawn", 409, "REQUEST_CLOSED");
  await Order.updateOne({ _id: record.order }, { $set: { "cancellation.status": CANCELLATION_STATUS.REJECTED } });
  await invalidateCustomerOrders(record.customer);
  await safeProcess(record._id);
  return { record };
}

export async function approveCancellationRequest({ adminId, recordId, note }) {
  const record = await loadRecordOr404(recordId);
  if (!OPEN_REQUEST_STATUSES.includes(record.status)) {
    throw serviceError("This request was already decided or withdrawn", 409, "REQUEST_CLOSED");
  }
  const order = await Order.findById(record.order);
  const stage = resolveCancellationStage(order);
  const actor = { role: "admin", id: adminId };

  if (stage === CANCELLATION_STAGE.DELIVERED) {
    const transferred = await transferToDispute(record._id, "Order was delivered before the request was approved");
    throw serviceError(
      "The order has already been delivered, so it cannot be cancelled normally. It was moved to the returns & disputes workflow.",
      409,
      "TRANSFERRED",
      { cancellation: cancellationView(transferred, { role: "admin" }) },
    );
  }
  if (stage === CANCELLATION_STAGE.CANCELLED) {
    throw serviceError("The order is already cancelled", 409, "ALREADY_CANCELLED");
  }
  return approvePostPickupCancellation({ order, record, actor, note: String(note || "").trim() || null });
}

/** Manual cancellation by an administrator. A reason is mandatory. */
export async function adminCancelOrder({ adminId, orderParam, reason, reasonCode = "OTHER" }) {
  const text = String(reason || "").trim();
  if (text.length < 3) throw serviceError("A reason is required for manual cancellation", 400, "REASON_REQUIRED");
  const code = CANCELLATION_REASON_CODES.includes(String(reasonCode).toUpperCase())
    ? String(reasonCode).toUpperCase()
    : "OTHER";

  const order = await findOrderOr404(orderParam);
  const [policy, record] = await Promise.all([
    getCancellationPolicy(),
    OrderCancellation.findOne({ order: order._id }),
  ]);
  const stage = resolveCancellationStage(order);
  const actor = { role: "admin", id: adminId };

  if (stage === CANCELLATION_STAGE.CANCELLED) {
    throw serviceError("This order is already cancelled", 409, "ALREADY_CANCELLED", {
      cancellation: cancellationView(record, { role: "admin" }),
    });
  }
  if (stage === CANCELLATION_STAGE.DELIVERED) {
    throw serviceError(
      "Delivered orders cannot be cancelled. Use the return, refund or dispute workflow instead.",
      409,
      "DELIVERED",
    );
  }
  if (stage === CANCELLATION_STAGE.NOT_APPLICABLE) {
    throw serviceError("This order cannot be cancelled from here", 409, "NOT_APPLICABLE");
  }
  if (stage === CANCELLATION_STAGE.PICKED_UP) {
    return approvePostPickupCancellation({
      order,
      record: record && OPEN_REQUEST_STATUSES.includes(record.status) ? record : null,
      actor,
      note: text,
      reasonCode: code,
      reasonText: text,
    });
  }
  return executeDirectCancellation({
    order,
    type: CANCELLATION_TYPE.ADMIN,
    actor,
    reasonCode: code,
    reasonText: text,
    policy,
    ignorePolicy: true,
    cancelledBy: "admin",
  });
}

/* ------------------------------------------------------------------ */
/* rider return + store inspection                                     */
/* ------------------------------------------------------------------ */

export async function confirmParcelReturned({ user, recordId, note }) {
  const role = String(user?.role || "").toLowerCase();
  const filter = { _id: recordId, "returnLeg.status": RETURN_LEG_STATUS.RETURN_TO_STORE };
  if (role === "delivery") filter.deliveryBoy = user.id;
  else if (role !== "admin") throw serviceError("Access denied", 403);

  const record = await OrderCancellation.findOneAndUpdate(
    filter,
    {
      $set: {
        "returnLeg.status": RETURN_LEG_STATUS.RETURNED_TO_STORE,
        "returnLeg.returnedAt": new Date(),
        "returnLeg.riderNote": note ? String(note).trim().slice(0, 300) : null,
        "inventory.status": INVENTORY_STATUS.AWAITING_INSPECTION,
        "processing.state": "PENDING",
        "processing.nextRetryAt": new Date(),
      },
      $push: {
        auditLog: appendAudit({
          action: "PARCEL_RETURNED_TO_STORE",
          actorRole: role,
          actorId: user.id,
          note: note || null,
        }),
      },
    },
    { new: true },
  );
  if (!record) {
    const existing = await loadRecordOr404(recordId);
    if (role === "delivery" && idStr(existing.deliveryBoy) !== String(user.id)) {
      throw serviceError("Cancellation not found", 404);
    }
    if ([RETURN_LEG_STATUS.RETURNED_TO_STORE, RETURN_LEG_STATUS.INSPECTED].includes(existing.returnLeg?.status)) {
      return { record: existing, duplicate: true };
    }
    throw serviceError("No parcel return is pending for this order", 409);
  }
  await queueNotification(record._id, {
    key: "parcel-returned",
    event: "CANCELLED_PARCEL_RETURNED",
    payload: { orderId: record.orderId, sellerId: record.seller },
  });
  emitToSeller(idStr(record.seller), {
    event: "cancellation:parcel-returned",
    payload: { orderId: record.orderId, cancellationId: idStr(record._id) },
  });
  await safeProcess(record._id);
  return { record: await OrderCancellation.findById(record._id) };
}

export async function inspectReturnedParcel({ user, recordId, items, note }) {
  const role = String(user?.role || "").toLowerCase();
  const record = await loadRecordOr404(recordId);
  if (role === "seller" && idStr(record.seller) !== String(user.id)) {
    throw serviceError("Cancellation not found", 404);
  }
  if (role !== "seller" && role !== "admin") throw serviceError("Access denied", 403);

  if (record.inventory?.status === INVENTORY_STATUS.INSPECTED) return { record, duplicate: true };
  const allowed = role === "admin"
    ? [INVENTORY_STATUS.AWAITING_INSPECTION, INVENTORY_STATUS.AWAITING_RETURN]
    : [INVENTORY_STATUS.AWAITING_INSPECTION];
  if (!allowed.includes(record.inventory?.status)) {
    throw serviceError(
      record.inventory?.status === INVENTORY_STATUS.AWAITING_RETURN
        ? "The rider has not confirmed the parcel return yet"
        : "There is nothing to inspect for this order",
      409,
    );
  }

  const order = await Order.findById(record.order);
  const inspection = normalizeInspection(order, items);
  const now = new Date();
  let stockUpdates = [];

  await runTransaction(async (session) => {
    const claimed = await OrderCancellation.updateOne(
      { _id: record._id, "inventory.status": { $in: allowed } },
      { $set: { "inventory.status": INVENTORY_STATUS.INSPECTED } },
      { session },
    );
    if (claimed.modifiedCount !== 1) throw serviceError("This parcel was already inspected", 409, "ALREADY_INSPECTED");

    const result = await restoreInspectedInventory(order, inspection, {
      session,
      actorLabel: role === "admin" ? "admin" : "store",
    });
    stockUpdates = result.stockUpdates;
    const totals = result.items.reduce(
      (t, i) => ({
        restored: t.restored + i.restoredQty,
        damaged: t.damaged + i.damagedQty,
        missing: t.missing + i.missingQty,
      }),
      { restored: 0, damaged: 0, missing: 0 },
    );
    await OrderCancellation.updateOne(
      { _id: record._id },
      {
        $set: {
          "inventory.items": result.items,
          "inventory.restoredAt": now,
          "inventory.inspectedAt": now,
          "inventory.inspectedBy": { role, id: user.id },
          "inventory.inspectionNote": note ? String(note).trim().slice(0, 500) : null,
          "returnLeg.status": RETURN_LEG_STATUS.INSPECTED,
          ...(record.returnLeg?.returnedAt ? {} : { "returnLeg.returnedAt": now }),
          "processing.state": "PENDING",
          "processing.nextRetryAt": now,
        },
        $push: {
          auditLog: appendAudit({
            action: "RETURNED_PARCEL_INSPECTED",
            actorRole: role,
            actorId: user.id,
            financial: totals,
            note: note || null,
          }),
        },
      },
      { session },
    );
  });

  broadcastStockUpdates(stockUpdates);
  await safeProcess(record._id);
  return { record: await OrderCancellation.findById(record._id) };
}

/* ------------------------------------------------------------------ */
/* lists for rider / seller                                            */
/* ------------------------------------------------------------------ */

export async function listRiderReturnTasks(deliveryId) {
  const records = await OrderCancellation.find({
    deliveryBoy: deliveryId,
    "returnLeg.status": RETURN_LEG_STATUS.RETURN_TO_STORE,
  })
    .sort({ cancelledAt: -1 })
    .populate("seller", "shopName address")
    .lean();
  return records.map((r) => ({
    id: idStr(r._id),
    orderId: r.orderId,
    cancelledAt: r.cancelledAt,
    store: r.seller ? { name: r.seller.shopName, address: r.seller.address } : null,
    items: (r.inventory?.items || []).map((i) => ({ name: i.name, quantity: i.quantity })),
  }));
}

export async function listSellerCancellations(sellerId, { limit = 30 } = {}) {
  const [awaiting, recent] = await Promise.all([
    OrderCancellation.find({
      seller: sellerId,
      $or: [
        { "inventory.status": INVENTORY_STATUS.AWAITING_INSPECTION },
        { "returnLeg.status": RETURN_LEG_STATUS.RETURN_TO_STORE },
      ],
    })
      .sort({ cancelledAt: -1 })
      .lean(),
    OrderCancellation.find({ seller: sellerId })
      .sort({ updatedAt: -1 })
      .limit(Math.min(Number(limit) || 30, 100))
      .lean(),
  ]);
  return {
    awaitingInspection: awaiting.map((r) => cancellationView(r, { role: "seller" })),
    recent: recent.map((r) => cancellationView(r, { role: "seller" })),
  };
}

/* ------------------------------------------------------------------ */
/* lifecycle hooks used by other services                              */
/* ------------------------------------------------------------------ */

/**
 * A pending request whose order got delivered anyway: move it to the
 * delivery-dispute / return workflow. Never approves it as a cancellation.
 */
export async function transferToDispute(recordId, note) {
  const now = new Date();
  const record = await OrderCancellation.findOneAndUpdate(
    { _id: recordId, status: { $in: OPEN_REQUEST_STATUSES } },
    {
      $set: {
        status: CANCELLATION_STATUS.TRANSFERRED,
        transferredAt: now,
        transferNote: note,
        "refund.status": REFUND_STATUS.NOT_REQUIRED,
        "inventory.status": INVENTORY_STATUS.NOT_REQUIRED,
        "settlement.seller.status": SETTLEMENT_ADJUSTMENT_STATUS.NOT_REQUIRED,
        "settlement.rider.status": SETTLEMENT_ADJUSTMENT_STATUS.NOT_REQUIRED,
        "settlement.cod.status": SETTLEMENT_ADJUSTMENT_STATUS.NOT_REQUIRED,
      },
      $push: {
        auditLog: appendAudit({
          action: "TRANSFERRED_TO_DISPUTE",
          newStatus: CANCELLATION_STATUS.TRANSFERRED,
          orderStatusAfter: "delivered",
          note,
        }),
      },
    },
    { new: true },
  );
  if (!record) return OrderCancellation.findById(recordId);

  try {
    const ticket = await Ticket.create({
      userId: record.customer,
      userType: "User",
      subject: `Order #${record.orderId}: delivered while cancellation was pending`,
      description: `The customer requested cancellation (${describeReason(record.reasonCode, record.reasonText)}) but the order was delivered before review. Handle as a delivery dispute or return/refund request. Check delivery OTP verification, rider details and timestamps.`,
      priority: "high",
    });
    await OrderCancellation.updateOne({ _id: record._id }, { $set: { disputeTicket: ticket._id } });
  } catch (error) {
    logger.warn("dispute ticket creation failed", { orderId: record.orderId, error: error.message });
  }
  await Order.updateOne({ _id: record.order }, { $set: { "cancellation.status": CANCELLATION_STATUS.TRANSFERRED } });
  await queueNotification(record._id, {
    key: "transferred",
    event: "CANCELLATION_TRANSFERRED",
    payload: { orderId: record.orderId, customerId: record.customer, userId: record.customer },
  });
  await safeProcess(record._id);
  return OrderCancellation.findById(record._id);
}

/** Called after delivery OTP completes an order. */
export async function onOrderDelivered(orderObjectId) {
  const record = await OrderCancellation.findOne({
    order: orderObjectId,
    status: { $in: OPEN_REQUEST_STATUSES },
  }).select("_id");
  if (record) await transferToDispute(record._id, "Order was delivered while the cancellation request was pending");
}

/**
 * Seller rejection, timeouts, payment failure: those paths cancel and
 * compensate on their own; this adds the record so admins see every
 * cancellation in one place and later events (e.g. a late payment) have
 * somewhere to attach.
 */
export async function recordExternalCancellation(orderOrId, { type = CANCELLATION_TYPE.SYSTEM, actorRole = "system", reason = "" } = {}) {
  try {
    const order = await Order.findById(orderOrId?._id || orderOrId).lean();
    if (!order || legacyStatus(order) !== "cancelled") return null;
    const now = new Date();
    const walletAmount = roundCurrency(Number(order.paymentBreakdown?.walletAmount || order.pricing?.walletAmount || 0));
    const legacyRefunded = Boolean(order.financeFlags?.cancellationReversalApplied);
    const gatewayRefunded = legacyRefunded && Boolean(order.financeFlags?.onlineRefundApplied);
    const allocations = [];
    if (legacyRefunded && walletAmount > 0) {
      allocations.push({ source: "WALLET", destination: "WALLET", amount: walletAmount, status: REFUND_STATUS.SUCCESSFUL, completedAt: now });
    }
    if (gatewayRefunded) {
      allocations.push({ source: "GATEWAY", destination: "WALLET", amount: orderAmount(order), status: REFUND_STATUS.SUCCESSFUL, completedAt: now });
    }
    const refundAmount = roundCurrency(allocations.reduce((s, a) => s + a.amount, 0));

    const record = await OrderCancellation.findOneAndUpdate(
      { order: order._id },
      {
        $setOnInsert: {
          order: order._id,
          orderId: order.orderId,
          customer: order.customer,
          seller: order.seller || null,
          deliveryBoy: order.deliveryBoy || null,
          type,
          status: CANCELLATION_STATUS.CANCELLED,
          reasonCode: "OTHER",
          reasonText: reason || order.cancelReason || null,
          initiatedBy: { role: actorRole, id: null },
          stageAtRequest: null,
          paymentModeAtRequest: order.paymentMode || null,
          paymentStatusAtRequest: order.paymentStatus || null,
          orderAmount: orderAmount(order),
          fullRefund: true,
          requestedAt: order.cancelledAt || now,
          cancelledAt: order.cancelledAt || now,
          refund: legacyRefunded
            ? {
              status: allocations.length ? REFUND_STATUS.SUCCESSFUL : REFUND_STATUS.NOT_REQUIRED,
              amount: refundAmount,
              paidWallet: walletAmount,
              paidGateway: gatewayRefunded ? orderAmount(order) : 0,
              allocations,
              initiatedAt: now,
              completedAt: now,
            }
            : { status: REFUND_STATUS.PENDING, allocations: [] },
          inventory: {
            status: order.stockReservation?.status === "RELEASED" ? INVENTORY_STATUS.RESTORED : INVENTORY_STATUS.NOT_REQUIRED,
            restoredAt: order.stockReservation?.releasedAt || null,
          },
          processing: { state: "PENDING", attempts: 0, nextRetryAt: now, steps: { workflow: true, compensation: true } },
          auditLog: [appendAudit({ action: "EXTERNAL_CANCELLATION_RECORDED", actorRole, newStatus: CANCELLATION_STATUS.CANCELLED, note: reason || order.cancelReason || null })],
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    await Order.updateOne(
      { _id: order._id, "cancellation.recordId": null },
      { $set: orderSummary(record) },
    );
    await safeProcess(record._id);
    return record;
  } catch (error) {
    if (error.code === 11000) return OrderCancellation.findOne({ order: orderOrId?._id || orderOrId });
    logger.warn("recordExternalCancellation failed", { error: error.message });
    return null;
  }
}

/** Payment captured after the order was cancelled: refund it. */
export async function onLatePaymentCapture(orderObjectId) {
  let record = await OrderCancellation.findOne({ order: orderObjectId });
  if (!record) {
    record = await recordExternalCancellation(orderObjectId, { reason: "Payment captured after cancellation" });
    if (!record) return;
  }
  await addLateCaptureAllocation(record._id);
  await OrderCancellation.updateOne(
    { _id: record._id },
    {
      $set: { "processing.state": "PENDING", "processing.nextRetryAt": new Date() },
      $push: { auditLog: appendAudit({ action: "LATE_PAYMENT_CAPTURED" }) },
    },
  );
  await safeProcess(record._id);
}

/* ------------------------------------------------------------------ */
/* post-commit processing                                              */
/* ------------------------------------------------------------------ */

async function runWorkflowCleanup(record, order) {
  const orderId = order.orderId;
  await removeSellerTimeout(orderId).catch(() => {});
  const attempts = Math.max(1, Number(order.deliverySearchMeta?.attempt) || 1);
  for (let a = 1; a <= attempts; a += 1) {
    await removeDeliveryTimeout(orderId, a).catch(() => {});
  }
  await DeliveryAssignment.updateMany(
    { orderId, status: "broadcasting" },
    { $set: { status: "cancelled" } },
  );
  await retractDeliveryBroadcastForOrder(orderId, null).catch(() => {});

  const payload = {
    orderId,
    workflowStatus: order.workflowStatus || WORKFLOW_STATUS.CANCELLED,
    status: "cancelled",
    cancellationStatus: record.status,
    returnToStore: record.returnLeg?.status === RETURN_LEG_STATUS.RETURN_TO_STORE,
  };
  emitOrderStatusUpdate(orderId, payload, order.customer);
  emitToSeller(idStr(order.seller), { event: "order:cancelled", payload });
  if (order.deliveryBoy) {
    emitToDelivery(idStr(order.deliveryBoy), { event: "order:cancelled", payload });
  }
  await invalidateCustomerOrders(order.customer);
}

/**
 * Drive every outstanding follow-up for one record. Idempotent and safe to
 * run concurrently (guarded by a short lease); the reconcile job calls it
 * until `processing.state` is DONE.
 */
export async function processCancellation(recordId) {
  const now = new Date();
  const leased = await OrderCancellation.findOneAndUpdate(
    {
      _id: recordId,
      $or: [{ "processing.lockedUntil": null }, { "processing.lockedUntil": { $lt: now } }],
    },
    {
      $set: { "processing.lockedUntil": new Date(now.getTime() + PROCESSING_LOCK_MS) },
      $inc: { "processing.attempts": 1 },
    },
    { new: true },
  );
  if (!leased) return { busy: true };

  let pending = false;
  const errors = [];
  try {
    const record = leased;
    const order = await Order.findById(record.order);
    const orderCancelled = ORDER_CANCELLED_STATUSES.includes(record.status) && legacyStatus(order) === "cancelled";
    const steps = { ...(record.processing?.steps || {}) };

    if (orderCancelled && order) {
      if (!steps.workflow) {
        try {
          await runWorkflowCleanup(record, order);
          steps.workflow = true;
        } catch (e) {
          errors.push(`workflow: ${e.message}`);
        }
      }
      if (!steps.compensation) {
        try {
          await compensateOrderCancellation(order, order.orderId, {
            actorId: record.initiatedBy?.id || null,
            reason: record.reasonText || cancellationReasonLabel(record.reasonCode),
            skipStockRelease: true,
            skipFinanceReversal: true,
          });
          steps.compensation = true;
        } catch (e) {
          errors.push(`compensation: ${e.message}`);
        }
      }
      await OrderCancellation.updateOne({ _id: record._id }, { $set: { "processing.steps": steps } });

      try {
        const refund = await processCancellationRefund(record._id);
        if (refund.retry) pending = true;
      } catch (e) {
        pending = true;
        errors.push(`refund: ${e.message}`);
      }

      try {
        const settled = await applyCancellationSettlement(record._id);
        const fresh = await OrderCancellation.findById(record._id).select("returnLeg settlement").lean();
        const waitingOnReturn = fresh?.returnLeg?.status === RETURN_LEG_STATUS.RETURN_TO_STORE;
        if (!settled && !waitingOnReturn) pending = true;
      } catch (e) {
        pending = true;
        errors.push(`settlement: ${e.message}`);
      }
    }

    const delivered = await dispatchCancellationNotifications(record._id);
    if (!delivered) pending = true;
  } catch (error) {
    pending = true;
    errors.push(error.message);
  }

  const latest = await OrderCancellation.findById(recordId).select("processing refund").lean();
  const attempts = latest?.processing?.attempts || 1;
  const exhausted = attempts >= RECONCILE_MAX_ATTEMPTS();
  // A gateway refund in flight, or a payment still being confirmed, keeps
  // being polled — it is waiting on the outside world, not failing.
  const waitingExternally =
    latest?.refund?.status === REFUND_STATUS.PROCESSING ||
    Boolean(latest?.refund?.awaitingPaymentConfirmation);
  const state = !pending ? "DONE" : exhausted && !waitingExternally ? "FAILED" : "PENDING";
  const delay = Math.min(RECONCILE_BASE_DELAY_MS() * 2 ** Math.min(attempts - 1, 7), 60 * 60 * 1000);

  await OrderCancellation.updateOne(
    { _id: recordId },
    {
      $set: {
        "processing.state": state,
        "processing.lastError": errors.length ? errors.join("; ").slice(0, 1000) : null,
        "processing.nextRetryAt": new Date(Date.now() + delay),
        "processing.lockedUntil": null,
      },
    },
  );
  if (errors.length) {
    logger.warn("cancellation processing incomplete; will retry", {
      scope: "processCancellation",
      cancellationId: String(recordId),
      errors,
    });
  }
  return { state, errors };
}

/** Post-commit processing never fails the caller's request. */
async function safeProcess(recordId) {
  if (!recordId) return;
  try {
    await processCancellation(recordId);
  } catch (error) {
    logger.warn("cancellation post-commit processing failed", {
      cancellationId: String(recordId),
      error: error.message,
    });
  }
}

/** Reconcile job body: retry everything that has not settled. */
export async function reconcilePendingCancellations({ limit = 50 } = {}) {
  const now = new Date();
  const due = await OrderCancellation.find({
    "processing.state": "PENDING",
    "processing.nextRetryAt": { $lte: now },
    $or: [{ "processing.lockedUntil": null }, { "processing.lockedUntil": { $lt: now } }],
  })
    .sort({ "processing.nextRetryAt": 1 })
    .limit(limit)
    .select("_id")
    .lean();
  let processed = 0;
  for (const row of due) {
    await safeProcess(row._id);
    processed += 1;
  }
  return { processed };
}
