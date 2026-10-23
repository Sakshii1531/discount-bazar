/**
 * Cancellation refunds — a separate, traceable process from the cancellation
 * itself. The order can be CANCELLED while its refund is PENDING (awaiting
 * payment confirmation or returned-parcel inspection), PROCESSING (gateway
 * accepted, confirmation outstanding) or FAILED (visible to admins for retry).
 *
 * Exactly-once guarantees:
 *  - The refund plan is computed once and frozen on the cancellation record.
 *  - Each allocation (wallet / gateway) is claimed with a conditional update
 *    before money moves, and every wallet movement carries a ledger
 *    idempotency key derived from the cancellation id.
 *  - Gateway refunds are looked up on the gateway before being re-initiated,
 *    so a retry after a timeout never creates a second refund.
 *  - Repeated webhooks only advance PROCESSING → SUCCESSFUL once.
 */
import mongoose from "mongoose";
import Order from "../../models/order.js";
import OrderCancellation from "../../models/orderCancellation.js";
import LedgerEntry from "../../models/ledgerEntry.js";
import Transaction from "../../models/transaction.js";
import {
  CANCELLATION_STAGE,
  INVENTORY_STATUS,
  REFUND_DESTINATION,
  REFUND_SOURCE,
  REFUND_STATUS,
} from "../../constants/cancellation.js";
import {
  FINANCE_AUDIT_ACTION,
  LEDGER_DIRECTION,
  LEDGER_STATUS,
  LEDGER_TRANSACTION_TYPE,
  ORDER_PAYMENT_STATUS,
  OWNER_TYPE,
} from "../../constants/finance.js";
import { creditWallet, debitWallet, getOrCreateWallet } from "../finance/walletService.js";
import { createLedgerEntry } from "../finance/ledgerService.js";
import { createFinanceAuditLog } from "../finance/auditLogService.js";
import { getActivePaymentProvider } from "../payment/providerRegistry.js";
import {
  findCapturedPaymentForOrder,
  reconcileOrderPaymentStatus,
} from "../paymentService.js";
import {
  computeRefundPlan,
  isGatewayPaymentCaptured,
  isGatewayPaymentUnconfirmed,
} from "./cancellationEligibility.js";
import { getCancellationPolicy } from "./cancellationPolicyService.js";
import { appendAudit, queueNotification } from "./cancellationRecordHelpers.js";
import { roundCurrency } from "../../utils/money.js";
import logger from "../logger.js";

const MAX_GATEWAY_ATTEMPTS = () => parseInt(process.env.CANCELLATION_REFUND_MAX_ATTEMPTS || "5", 10);

const FINAL_REFUND_STATUSES = new Set([
  REFUND_STATUS.SUCCESSFUL,
  REFUND_STATUS.NOT_REQUIRED,
  REFUND_STATUS.MANUAL_REVIEW,
]);

export function isRefundSettled(status) {
  return FINAL_REFUND_STATUSES.has(status);
}

async function ledgerKeyExists(key, session) {
  return Boolean(await LedgerEntry.exists({ idempotencyKey: key }).session(session || null));
}

/** The refund for a post-pickup cancellation waits for the store inspection. */
function awaitingInspection(record) {
  return record.afterPickup && record.inventory?.status !== INVENTORY_STATUS.INSPECTED;
}

function aggregateStatus(allocations) {
  if (!allocations.length) return REFUND_STATUS.NOT_REQUIRED;
  const statuses = allocations.map((a) => a.status);
  if (statuses.every((s) => s === REFUND_STATUS.SUCCESSFUL)) return REFUND_STATUS.SUCCESSFUL;
  if (statuses.includes(REFUND_STATUS.MANUAL_REVIEW)) return REFUND_STATUS.MANUAL_REVIEW;
  if (statuses.includes(REFUND_STATUS.FAILED)) return REFUND_STATUS.FAILED;
  if (statuses.includes(REFUND_STATUS.PROCESSING)) return REFUND_STATUS.PROCESSING;
  return REFUND_STATUS.PENDING;
}

async function syncOrderRefundSummary(record, status) {
  await Order.updateOne(
    { _id: record.order },
    { $set: { "cancellation.refundStatus": status } },
  );
}

/**
 * Freeze the refund plan on the record. Verifies an unconfirmed online
 * payment with the gateway first — the client's "failed" screen is never
 * taken as proof that no money moved.
 */
async function planRefund(record) {
  const policy = await getCancellationPolicy();
  let order = await Order.findById(record.order).lean();
  if (!order) throw Object.assign(new Error("Order not found for refund"), { statusCode: 404 });

  if (isGatewayPaymentUnconfirmed(order)) {
    const outcome = await reconcileOrderPaymentStatus(order._id);
    order = await Order.findById(record.order).lean();
    // No attempt ever reached the gateway, or every attempt failed: no money
    // moved. A late success would still arrive through onLatePaymentCapture.
    const definitelyUnpaid = ["NONE", "FAILED"].includes(outcome.status);
    if (isGatewayPaymentUnconfirmed(order) && !definitelyUnpaid) {
      const windowMs = policy.paymentVerificationWindowHours * 3600 * 1000;
      const expired = Date.now() - new Date(record.cancelledAt || record.createdAt).getTime() > windowMs;
      if (!expired || outcome.status === "UNKNOWN") {
        // Keep checking; a late webhook will also wake this record up.
        await OrderCancellation.updateOne(
          { _id: record._id },
          {
            $set: {
              "refund.status": REFUND_STATUS.PENDING,
              "refund.awaitingPaymentConfirmation": true,
              "refund.lastError": outcome.status === "UNKNOWN" ? "Payment gateway unreachable" : null,
            },
          },
        );
        return { planned: false, waiting: true };
      }
    }
  }

  const plan = computeRefundPlan(order, policy, {
    stage: record.stageAtRequest || (record.afterPickup ? CANCELLATION_STAGE.PICKED_UP : null),
    waiveDeductions: Boolean(record.fullRefund),
  });
  const allocations = plan.allocations.map((a) => ({
    source: a.source,
    destination: a.source === REFUND_SOURCE.WALLET ? REFUND_DESTINATION.WALLET : a.destination,
    amount: a.amount,
    status: REFUND_STATUS.PENDING,
  }));
  const status = allocations.length ? REFUND_STATUS.PENDING : REFUND_STATUS.NOT_REQUIRED;

  // Only freeze once: a concurrent planner loses this conditional update.
  const updated = await OrderCancellation.findOneAndUpdate(
    { _id: record._id, "refund.allocations.0": { $exists: false }, "refund.initiatedAt": null },
    {
      $set: {
        "refund.status": status,
        "refund.paidWallet": plan.paidWallet,
        "refund.paidGateway": plan.paidGateway,
        "refund.amount": plan.refundable,
        "refund.deductions": plan.deductions,
        "refund.allocations": allocations,
        "refund.awaitingPaymentConfirmation": false,
        "refund.initiatedAt": new Date(),
        "refund.completedAt": status === REFUND_STATUS.NOT_REQUIRED ? new Date() : null,
      },
      $push: {
        auditLog: appendAudit({
          action: "REFUND_PLANNED",
          newStatus: status,
          financial: {
            paidWallet: plan.paidWallet,
            paidGateway: plan.paidGateway,
            refundable: plan.refundable,
            deductions: plan.deductions,
          },
        }),
      },
    },
    { new: true },
  );
  // Legacy cancellation paths must never refund this order a second time.
  await Order.updateOne(
    { _id: record.order },
    { $set: { "financeFlags.cancellationReversalApplied": true } },
  );
  if (updated) {
    await syncOrderRefundSummary(updated, status);
    if (status !== REFUND_STATUS.NOT_REQUIRED) {
      await queueNotification(updated._id, {
        key: "refund-initiated",
        event: "REFUND_INITIATED",
        payload: {
          orderId: updated.orderId,
          customerId: updated.customer,
          userId: updated.customer,
          amount: plan.refundable,
        },
      });
    }
  }
  return { planned: true };
}

/** Claim an allocation for processing; returns false if someone else holds it. */
async function claimAllocation(recordId, allocationId, fromStatuses, session) {
  const res = await OrderCancellation.updateOne(
    {
      _id: recordId,
      refund: { $exists: true },
      "refund.allocations": { $elemMatch: { _id: allocationId, status: { $in: fromStatuses } } },
    },
    {
      $set: {
        "refund.allocations.$[a].status": REFUND_STATUS.PROCESSING,
        "refund.allocations.$[a].initiatedAt": new Date(),
      },
      $inc: { "refund.allocations.$[a].attempts": 1 },
    },
    { arrayFilters: [{ "a._id": allocationId }], ...(session ? { session } : {}) },
  );
  return res.modifiedCount === 1;
}

async function setAllocation(recordId, allocationId, fields, session) {
  const $set = {};
  for (const [k, v] of Object.entries(fields)) $set[`refund.allocations.$[a].${k}`] = v;
  await OrderCancellation.updateOne(
    { _id: recordId },
    { $set },
    { arrayFilters: [{ "a._id": allocationId }], ...(session ? { session } : {}) },
  );
}

async function creditCustomerWallet({ record, order, amount, key, description, session }) {
  if (await ledgerKeyExists(key, session)) return;
  await creditWallet({
    ownerType: OWNER_TYPE.CUSTOMER,
    ownerId: order.customer,
    amount,
    bucket: "available",
    session,
    ledgerType: LEDGER_TRANSACTION_TYPE.WALLET_REFUND,
    ledgerReference: order.orderId,
    ledgerDescription: description,
    orderId: order._id,
    paymentMode: "WALLET",
    metadata: { cancellationId: String(record._id) },
    idempotencyKey: key,
  });
  await Transaction.create(
    [
      {
        user: order.customer,
        userModel: "User",
        order: order._id,
        type: "Refund",
        amount,
        status: "Settled",
        description,
        reference: key,
      },
    ],
    { session },
  ).catch(() => {});
}

/** Debit the platform float for gateway money being paid back. */
async function debitPlatformForGatewayRefund({ record, order, amount, key, session }) {
  if (await ledgerKeyExists(key, session)) return;
  try {
    await debitWallet({
      ownerType: OWNER_TYPE.ADMIN,
      ownerId: null,
      amount,
      bucket: "available",
      session,
      ledgerType: LEDGER_TRANSACTION_TYPE.REFUND,
      ledgerReference: order.orderId,
      ledgerDescription: `Cancellation refund for order #${order.orderId}`,
      orderId: order._id,
      paymentMode: "ONLINE",
      metadata: { cancellationId: String(record._id) },
      idempotencyKey: key,
    });
  } catch (error) {
    if (!/Insufficient/i.test(error.message)) throw error;
    // The refund itself must not be blocked by the platform float; record the
    // liability as a pending ledger row for finance to reconcile.
    const adminWallet = await getOrCreateWallet(OWNER_TYPE.ADMIN, null, { session });
    await createLedgerEntry(
      {
        orderId: order._id,
        walletId: adminWallet._id,
        actorType: OWNER_TYPE.ADMIN,
        type: LEDGER_TRANSACTION_TYPE.REFUND,
        direction: LEDGER_DIRECTION.DEBIT,
        amount,
        status: LEDGER_STATUS.PENDING,
        paymentMode: "ONLINE",
        description: `Cancellation refund for order #${order.orderId} (platform float short)`,
        reference: order.orderId,
        metadata: { cancellationId: String(record._id), shortfall: true },
        idempotencyKey: key,
      },
      { session },
    );
  }
}

async function markOrderGatewayRefunded(orderId, session) {
  await Order.updateOne(
    { _id: orderId },
    {
      $set: {
        "financeFlags.onlineRefundApplied": true,
        "financeFlags.cancellationReversalApplied": true,
        paymentStatus: ORDER_PAYMENT_STATUS.REFUNDED,
      },
    },
    session ? { session } : {},
  );
}

/** Wallet allocation, or gateway money credited to the customer wallet. */
async function processWalletDestination(record, order, allocation) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const claimed = await claimAllocation(
        record._id,
        allocation._id,
        [REFUND_STATUS.PENDING, REFUND_STATUS.FAILED],
        session,
      );
      if (!claimed) return;
      const tag = `CXL-${record._id}-${allocation._id}`;
      if (allocation.source === REFUND_SOURCE.GATEWAY) {
        await debitPlatformForGatewayRefund({
          record,
          order,
          amount: allocation.amount,
          key: `${tag}-PLATFORM`,
          session,
        });
        await markOrderGatewayRefunded(order._id, session);
      }
      await creditCustomerWallet({
        record,
        order,
        amount: allocation.amount,
        key: `${tag}-CUSTOMER`,
        description:
          allocation.source === REFUND_SOURCE.GATEWAY
            ? `Online payment refunded to wallet for cancelled order #${order.orderId}`
            : `Wallet amount refunded for cancelled order #${order.orderId}`,
        session,
      });
      await setAllocation(record._id, allocation._id, {
        status: REFUND_STATUS.SUCCESSFUL,
        completedAt: new Date(),
        lastError: null,
      }, session);
      await createFinanceAuditLog(
        {
          action: FINANCE_AUDIT_ACTION.CANCELLATION_REFUND_ISSUED,
          actorType: OWNER_TYPE.ADMIN,
          actorId: null,
          orderId: order._id,
          metadata: {
            cancellationId: String(record._id),
            source: allocation.source,
            destination: REFUND_DESTINATION.WALLET,
            amount: allocation.amount,
          },
        },
        { session },
      );
    });
  } catch (error) {
    await setAllocation(record._id, allocation._id, {
      status: REFUND_STATUS.FAILED,
      lastError: error.message,
    });
    throw error;
  } finally {
    session.endSession();
  }
}

async function completeGatewayAllocation(record, order, allocation) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const res = await OrderCancellation.updateOne(
        {
          _id: record._id,
          "refund.allocations": {
            $elemMatch: { _id: allocation._id, status: { $ne: REFUND_STATUS.SUCCESSFUL } },
          },
        },
        {
          $set: {
            "refund.allocations.$[a].status": REFUND_STATUS.SUCCESSFUL,
            "refund.allocations.$[a].completedAt": new Date(),
            "refund.allocations.$[a].lastError": null,
          },
        },
        { arrayFilters: [{ "a._id": allocation._id }], session },
      );
      if (res.modifiedCount !== 1) return;
      await debitPlatformForGatewayRefund({
        record,
        order,
        amount: allocation.amount,
        key: `CXL-${record._id}-${allocation._id}-PLATFORM`,
        session,
      });
      await markOrderGatewayRefunded(order._id, session);
      await createFinanceAuditLog(
        {
          action: FINANCE_AUDIT_ACTION.CANCELLATION_REFUND_ISSUED,
          actorType: OWNER_TYPE.ADMIN,
          actorId: null,
          orderId: order._id,
          metadata: {
            cancellationId: String(record._id),
            source: REFUND_SOURCE.GATEWAY,
            destination: REFUND_DESTINATION.ORIGINAL_SOURCE,
            gatewayRefundId: allocation.gatewayRefundId,
            amount: allocation.amount,
          },
        },
        { session },
      );
    });
  } finally {
    session.endSession();
  }
}

/** Gateway money back to the original card / UPI / net-banking source. */
async function processOriginalSource(record, order, allocation) {
  const provider = getActivePaymentProvider();

  // Already accepted by the gateway: poll until it settles.
  if (allocation.gatewayRefundId) {
    const status = await provider.getRefundStatus({
      gatewayPaymentId: allocation.gatewayPaymentId,
      gatewayRefundId: allocation.gatewayRefundId,
    });
    if (status.status === "SUCCESSFUL") {
      await completeGatewayAllocation(record, order, allocation);
    } else if (status.status === "FAILED") {
      await setAllocation(record._id, allocation._id, {
        status: REFUND_STATUS.FAILED,
        gatewayRefundId: null,
        lastError: "Gateway reported the refund as failed",
      });
    }
    return;
  }

  if ((allocation.attempts || 0) >= MAX_GATEWAY_ATTEMPTS()) {
    await setAllocation(record._id, allocation._id, {
      status: REFUND_STATUS.MANUAL_REVIEW,
      lastError: allocation.lastError || "Refund retries exhausted",
    });
    return;
  }

  const payment = await findCapturedPaymentForOrder(order._id);
  if (!payment?.gatewayPaymentId) {
    await setAllocation(record._id, allocation._id, {
      status: REFUND_STATUS.MANUAL_REVIEW,
      lastError: "No captured gateway payment found for this order",
    });
    return;
  }

  const claimed = await claimAllocation(record._id, allocation._id, [REFUND_STATUS.PENDING, REFUND_STATUS.FAILED]);
  if (!claimed) return;

  try {
    // A previous attempt may have reached the gateway before timing out.
    let existing = null;
    try {
      const refunds = await provider.findRefunds({ gatewayPaymentId: payment.gatewayPaymentId });
      existing = refunds.find(
        (r) => r.notes?.cancellationId === String(record._id) && r.notes?.allocationId === String(allocation._id) && r.status !== "FAILED",
      );
    } catch (lookupError) {
      if (lookupError.code === "REFUND_NOT_SUPPORTED") throw lookupError;
      // Cannot prove there is no earlier refund — do not risk a duplicate.
      throw Object.assign(new Error(`Could not check existing refunds: ${lookupError.message}`), { retryable: true });
    }

    const result = existing || await provider.refundPayment({
      gatewayPaymentId: payment.gatewayPaymentId,
      amountPaise: Math.round(allocation.amount * 100),
      receipt: `CXL-${String(record._id).slice(-12)}`,
      notes: {
        cancellationId: String(record._id),
        allocationId: String(allocation._id),
        orderId: order.orderId,
      },
    });

    await setAllocation(record._id, allocation._id, {
      gatewayPaymentId: payment.gatewayPaymentId,
      gatewayRefundId: result.refundId,
      status: REFUND_STATUS.PROCESSING,
      lastError: null,
    });
    if (result.status === "SUCCESSFUL") {
      await completeGatewayAllocation(record, order, {
        ...allocation.toObject?.() || allocation,
        gatewayRefundId: result.refundId,
      });
    }
  } catch (error) {
    await setAllocation(record._id, allocation._id, {
      status: error.code === "REFUND_NOT_SUPPORTED" ? REFUND_STATUS.MANUAL_REVIEW : REFUND_STATUS.FAILED,
      lastError: error.message,
    });
    if (error.code !== "REFUND_NOT_SUPPORTED") throw error;
  }
}

async function finalizeRefundStatus(recordId) {
  const record = await OrderCancellation.findById(recordId);
  if (!record) return null;
  const allocations = record.refund?.allocations || [];
  const next = aggregateStatus(allocations);
  const prev = record.refund?.status;
  if (prev === next) return record;

  const set = { "refund.status": next };
  if (next === REFUND_STATUS.SUCCESSFUL) set["refund.completedAt"] = new Date();
  const lastError = allocations.map((a) => a.lastError).filter(Boolean).pop() || null;
  set["refund.lastError"] = next === REFUND_STATUS.SUCCESSFUL ? null : lastError;

  const updated = await OrderCancellation.findOneAndUpdate(
    { _id: recordId, "refund.status": prev },
    {
      $set: set,
      $push: {
        auditLog: appendAudit({
          action: "REFUND_STATUS_CHANGED",
          previousStatus: prev,
          newStatus: next,
          financial: { amount: record.refund.amount },
          note: set["refund.lastError"] || null,
        }),
      },
    },
    { new: true },
  );
  if (!updated) return record;
  await syncOrderRefundSummary(updated, next);

  const payload = {
    orderId: updated.orderId,
    customerId: updated.customer,
    userId: updated.customer,
    amount: updated.refund.amount,
  };
  if (next === REFUND_STATUS.SUCCESSFUL) {
    await queueNotification(updated._id, {
      key: "refund-successful",
      event: "REFUND_COMPLETED",
      payload: {
        ...payload,
        message: `₹${Math.ceil(updated.refund.amount)} has been refunded for cancelled order #${updated.orderId}.`,
      },
    });
  } else if (next === REFUND_STATUS.FAILED || next === REFUND_STATUS.MANUAL_REVIEW) {
    await queueNotification(updated._id, {
      key: `refund-${next.toLowerCase()}`,
      event: "REFUND_FAILED",
      payload: { ...payload, adminAlert: true },
    });
  }
  return updated;
}

/**
 * Advance the refund for one cancellation record. Safe to call any number of
 * times from the request path, the reconcile job, webhooks or admin retry.
 * Returns { status, retry } — `retry` means call again later.
 */
export async function processCancellationRefund(recordId) {
  let record = await OrderCancellation.findById(recordId);
  if (!record) return { status: null, retry: false };

  if (awaitingInspection(record)) {
    if (record.refund?.status !== REFUND_STATUS.PENDING) {
      await OrderCancellation.updateOne({ _id: record._id }, { $set: { "refund.status": REFUND_STATUS.PENDING } });
    }
    return { status: REFUND_STATUS.PENDING, retry: false, waitingFor: "INSPECTION" };
  }

  if (!record.refund?.initiatedAt) {
    const planned = await planRefund(record);
    if (planned.waiting) return { status: REFUND_STATUS.PENDING, retry: true, waitingFor: "PAYMENT_CONFIRMATION" };
    record = await OrderCancellation.findById(recordId);
  }

  const order = await Order.findById(record.order).lean();
  let retry = false;
  for (const allocation of record.refund.allocations || []) {
    if ([REFUND_STATUS.SUCCESSFUL, REFUND_STATUS.MANUAL_REVIEW].includes(allocation.status)) continue;
    // PROCESSING without a gateway refund id is an in-flight wallet
    // transaction (or a crashed one); leave it to the claim guard.
    try {
      if (allocation.destination === REFUND_DESTINATION.ORIGINAL_SOURCE && allocation.source === REFUND_SOURCE.GATEWAY) {
        await processOriginalSource(record, order, allocation);
      } else if (allocation.status !== REFUND_STATUS.PROCESSING) {
        await processWalletDestination(record, order, allocation);
      }
    } catch (error) {
      retry = true;
      logger.warn("cancellation refund allocation failed", {
        scope: "processCancellationRefund",
        cancellationId: String(record._id),
        orderId: record.orderId,
        source: allocation.source,
        error: error.message,
      });
    }
  }

  const final = await finalizeRefundStatus(record._id);
  const status = final?.refund?.status;
  if (status === REFUND_STATUS.PROCESSING || status === REFUND_STATUS.PENDING) retry = true;
  if (status === REFUND_STATUS.FAILED) retry = true;
  return { status, retry };
}

/**
 * Admin retry of a FAILED / MANUAL_REVIEW refund: reset failed allocations
 * (keeping any gateway refund id so the gateway is checked, not re-charged).
 */
export async function resetFailedRefund(recordId, { adminId, note } = {}) {
  const record = await OrderCancellation.findById(recordId);
  if (!record) throw Object.assign(new Error("Cancellation not found"), { statusCode: 404 });
  if (![REFUND_STATUS.FAILED, REFUND_STATUS.MANUAL_REVIEW].includes(record.refund?.status)) {
    throw Object.assign(new Error("Only failed refunds can be retried"), { statusCode: 409 });
  }
  for (const allocation of record.refund.allocations) {
    if ([REFUND_STATUS.FAILED, REFUND_STATUS.MANUAL_REVIEW].includes(allocation.status)) {
      allocation.status = allocation.gatewayRefundId ? REFUND_STATUS.PROCESSING : REFUND_STATUS.PENDING;
      allocation.attempts = 0;
      allocation.lastError = null;
    }
  }
  const prev = record.refund.status;
  record.refund.status = REFUND_STATUS.PENDING;
  record.refund.lastError = null;
  record.processing.state = "PENDING";
  record.processing.nextRetryAt = new Date();
  record.auditLog.push(appendAudit({
    action: "REFUND_RETRY_REQUESTED",
    actorRole: "admin",
    actorId: adminId,
    previousStatus: prev,
    newStatus: REFUND_STATUS.PENDING,
    note: note || null,
  }));
  await record.save();
  return processCancellationRefund(record._id);
}

/** Admin closes a refund settled outside the system (e.g. bank transfer). */
export async function resolveRefundManually(recordId, { adminId, note }) {
  if (!String(note || "").trim()) {
    throw Object.assign(new Error("A note explaining the manual resolution is required"), { statusCode: 400 });
  }
  const record = await OrderCancellation.findById(recordId);
  if (!record) throw Object.assign(new Error("Cancellation not found"), { statusCode: 404 });
  if (![REFUND_STATUS.FAILED, REFUND_STATUS.MANUAL_REVIEW].includes(record.refund?.status)) {
    throw Object.assign(new Error("Only failed refunds can be resolved manually"), { statusCode: 409 });
  }
  const prev = record.refund.status;
  for (const allocation of record.refund.allocations) {
    if (allocation.status !== REFUND_STATUS.SUCCESSFUL) {
      allocation.status = REFUND_STATUS.SUCCESSFUL;
      allocation.completedAt = new Date();
      allocation.lastError = `Resolved manually: ${note}`;
    }
  }
  record.refund.status = REFUND_STATUS.SUCCESSFUL;
  record.refund.completedAt = new Date();
  record.refund.manualResolution = { by: adminId, at: new Date(), note: String(note).trim() };
  record.auditLog.push(appendAudit({
    action: "REFUND_RESOLVED_MANUALLY",
    actorRole: "admin",
    actorId: adminId,
    previousStatus: prev,
    newStatus: REFUND_STATUS.SUCCESSFUL,
    financial: { amount: record.refund.amount },
    note: String(note).trim(),
  }));
  await record.save();
  await syncOrderRefundSummary(record, REFUND_STATUS.SUCCESSFUL);
  await createFinanceAuditLog({
    action: FINANCE_AUDIT_ACTION.CANCELLATION_REFUND_ISSUED,
    actorType: OWNER_TYPE.ADMIN,
    actorId: adminId,
    orderId: record.order,
    metadata: { cancellationId: String(record._id), manual: true, note: String(note).trim() },
  });
  return record;
}

/** Gateway webhook for a refund. Repeats are no-ops. */
export async function handleGatewayRefundUpdate({ gatewayRefundId, status }) {
  const record = await OrderCancellation.findOne({ "refund.allocations.gatewayRefundId": gatewayRefundId });
  if (!record) return { ignored: true };
  const allocation = record.refund.allocations.find((a) => a.gatewayRefundId === gatewayRefundId);
  if (!allocation || allocation.status === REFUND_STATUS.SUCCESSFUL) return { duplicate: true };

  const order = await Order.findById(record.order).lean();
  if (status === "SUCCESSFUL") {
    await completeGatewayAllocation(record, order, allocation);
  } else if (status === "FAILED") {
    await setAllocation(record._id, allocation._id, {
      status: REFUND_STATUS.FAILED,
      gatewayRefundId: null,
      lastError: "Gateway reported the refund as failed",
    });
  }
  const final = await finalizeRefundStatus(record._id);
  return { status: final?.refund?.status };
}

/**
 * A payment captured after the order was already cancelled. Adds a gateway
 * allocation for money that has not been refunded yet.
 */
export async function addLateCaptureAllocation(recordId) {
  const policy = await getCancellationPolicy();
  const record = await OrderCancellation.findById(recordId);
  const order = await Order.findById(record?.order).lean();
  if (!record || !order) return false;
  if (!isGatewayPaymentCaptured(order) || order.financeFlags?.onlineRefundApplied) return false;
  if ((record.refund?.allocations || []).some((a) => a.source === REFUND_SOURCE.GATEWAY)) return false;
  if (!record.refund?.initiatedAt) return true; // not planned yet — the plan will include it

  // Money taken for an order that was already cancelled comes back in full.
  const plan = computeRefundPlan(order, policy, { stage: record.stageAtRequest, waiveDeductions: true });
  const gateway = plan.allocations.find((a) => a.source === REFUND_SOURCE.GATEWAY);
  if (!gateway) return false;
  const res = await OrderCancellation.updateOne(
    { _id: record._id, "refund.allocations.source": { $ne: REFUND_SOURCE.GATEWAY } },
    {
      $push: {
        "refund.allocations": {
          source: REFUND_SOURCE.GATEWAY,
          destination: gateway.destination,
          amount: gateway.amount,
          status: REFUND_STATUS.PENDING,
        },
        auditLog: appendAudit({
          action: "LATE_PAYMENT_CAPTURE_REFUND_ADDED",
          financial: { amount: gateway.amount },
        }),
      },
      $set: {
        "refund.status": REFUND_STATUS.PENDING,
        "refund.paidGateway": plan.paidGateway,
        "refund.amount": roundCurrency((record.refund.amount || 0) + gateway.amount),
        "refund.completedAt": null,
        "processing.state": "PENDING",
        "processing.nextRetryAt": new Date(),
      },
    },
  );
  return res.modifiedCount === 1;
}
