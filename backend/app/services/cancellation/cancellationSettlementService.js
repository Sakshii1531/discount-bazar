/**
 * Seller, rider and COD adjustments for a cancelled order.
 *
 * Original financial entries are never edited or deleted. Anything already
 * paid out is countered with a new, linked ledger row (recovery against a
 * future settlement); anything only queued is cancelled through the payout
 * service, which writes its own reversal row. Each part is applied once —
 * guarded by its status on the cancellation record.
 */
import Order from "../../models/order.js";
import OrderCancellation from "../../models/orderCancellation.js";
import Payout from "../../models/payout.js";
import {
  RETURN_LEG_STATUS,
  SETTLEMENT_ADJUSTMENT_STATUS,
} from "../../constants/cancellation.js";
import {
  FINANCE_AUDIT_ACTION,
  LEDGER_DIRECTION,
  LEDGER_STATUS,
  LEDGER_TRANSACTION_TYPE,
  ORDER_SETTLEMENT_STATUS,
  OWNER_TYPE,
  PAYOUT_STATUS,
  PAYOUT_TYPE,
} from "../../constants/finance.js";
import { cancelPendingPayoutForOrder, createPendingPayoutForOrder } from "../finance/payoutService.js";
import { createLedgerEntry } from "../finance/ledgerService.js";
import { getOrCreateWallet } from "../finance/walletService.js";
import { createFinanceAuditLog } from "../finance/auditLogService.js";
import { getCancellationPolicy } from "./cancellationPolicyService.js";
import { appendAudit } from "./cancellationRecordHelpers.js";
import { roundCurrency } from "../../utils/money.js";

const { APPLIED, NOT_REQUIRED, MANUAL_REVIEW, PENDING } = SETTLEMENT_ADJUSTMENT_STATUS;

const IN_PROGRESS = "in progress";
// A claim this old was interrupted (crash / restart). Every adjustment below
// is idempotent (payout + ledger idempotency), so re-running it is safe.
const STALE_CLAIM_MS = 5 * 60 * 1000;

const isStaleClaim = (adj) =>
  adj?.status === APPLIED &&
  adj?.detail === IN_PROGRESS &&
  (!adj.appliedAt || Date.now() - new Date(adj.appliedAt).getTime() > STALE_CLAIM_MS);

/** Claim one part (seller / rider / cod) so concurrent runs apply it once. */
async function claimPart(recordId, part) {
  const res = await OrderCancellation.updateOne(
    {
      _id: recordId,
      $or: [
        { [`settlement.${part}.status`]: { $in: [PENDING, null, SETTLEMENT_ADJUSTMENT_STATUS.FAILED] } },
        {
          [`settlement.${part}.status`]: APPLIED,
          [`settlement.${part}.detail`]: IN_PROGRESS,
          [`settlement.${part}.appliedAt`]: { $lt: new Date(Date.now() - STALE_CLAIM_MS) },
        },
      ],
    },
    {
      $set: {
        [`settlement.${part}.status`]: APPLIED,
        [`settlement.${part}.detail`]: IN_PROGRESS,
        [`settlement.${part}.appliedAt`]: new Date(),
      },
    },
  );
  return res.modifiedCount === 1;
}

async function finishPart(record, part, { status, amount = 0, detail, ledgerEntryIds = [] }) {
  await OrderCancellation.updateOne(
    { _id: record._id },
    {
      $set: {
        [`settlement.${part}`]: {
          status,
          amount: roundCurrency(amount),
          detail,
          ledgerEntryIds,
          appliedAt: new Date(),
        },
      },
      $push: {
        auditLog: appendAudit({
          action: `SETTLEMENT_${part.toUpperCase()}_${status}`,
          financial: { amount: roundCurrency(amount) },
          note: detail,
        }),
      },
    },
  );
  if (status === APPLIED && amount > 0) {
    await createFinanceAuditLog({
      action: FINANCE_AUDIT_ACTION.CANCELLATION_SETTLEMENT_ADJUSTED,
      actorType: OWNER_TYPE.ADMIN,
      actorId: null,
      orderId: record.order,
      metadata: { cancellationId: String(record._id), part, amount: roundCurrency(amount), detail },
    });
  }
}

async function failPart(record, part, error) {
  await OrderCancellation.updateOne(
    { _id: record._id },
    {
      $set: {
        [`settlement.${part}.status`]: SETTLEMENT_ADJUSTMENT_STATUS.FAILED,
        [`settlement.${part}.detail`]: error.message,
      },
    },
  );
}

async function adjustSeller(record, order) {
  const pending = await cancelPendingPayoutForOrder(order._id, PAYOUT_TYPE.SELLER, {
    remarks: `Seller payout cancelled: order #${order.orderId} was cancelled.`,
  });
  if (pending) {
    return { status: APPLIED, amount: pending.amount, detail: "Queued seller payout cancelled" };
  }
  const paid = await Payout.findOne({
    relatedOrderIds: order._id,
    payoutType: PAYOUT_TYPE.SELLER,
    status: PAYOUT_STATUS.COMPLETED,
  }).lean();
  if (paid) {
    // Already paid out: recover from a future settlement through a new,
    // linked ledger row. The original payout entry stays untouched.
    const wallet = await getOrCreateWallet(OWNER_TYPE.SELLER, order.seller);
    const entry = await createLedgerEntry({
      orderId: order._id,
      payoutId: paid._id,
      walletId: wallet._id,
      actorType: OWNER_TYPE.SELLER,
      actorId: order.seller,
      type: LEDGER_TRANSACTION_TYPE.CANCELLATION_REVERSAL,
      direction: LEDGER_DIRECTION.DEBIT,
      amount: paid.amount,
      status: LEDGER_STATUS.PENDING,
      description: `Recovery for cancelled order #${order.orderId} — to be deducted from a future settlement`,
      reference: order.orderId,
      metadata: { cancellationId: String(record._id), recovery: true },
      idempotencyKey: `CXL-${record._id}-SELLER-RECOVERY`,
    });
    return {
      status: MANUAL_REVIEW,
      amount: paid.amount,
      detail: "Seller was already paid; recovery recorded against a future settlement",
      ledgerEntryIds: [entry._id],
    };
  }
  return {
    status: NOT_REQUIRED,
    amount: 0,
    detail: "No seller payout existed; the order is excluded from the seller's payable amount",
  };
}

async function adjustRider(record, order, policy) {
  // A cancelled order never earns the successful-delivery payout.
  const cancelled = await cancelPendingPayoutForOrder(order._id, PAYOUT_TYPE.DELIVERY_PARTNER, {
    remarks: `Rider payout cancelled: order #${order.orderId} was cancelled.`,
  });

  const returned = [RETURN_LEG_STATUS.RETURNED_TO_STORE, RETURN_LEG_STATUS.INSPECTED].includes(
    record.returnLeg?.status,
  );
  const compensation = roundCurrency(policy.riderReturnCompensation || 0);
  if (record.afterPickup && returned && compensation > 0 && order.deliveryBoy) {
    const payout = await createPendingPayoutForOrder({
      order,
      payoutType: PAYOUT_TYPE.DELIVERY_PARTNER,
      beneficiaryId: order.deliveryBoy,
      amount: compensation,
      remarks: `Return-trip compensation for cancelled order #${order.orderId}`,
      metadata: { cancellationId: String(record._id), kind: "CANCELLATION_RETURN_COMPENSATION" },
    });
    return {
      status: APPLIED,
      amount: compensation,
      detail: "Return-trip compensation queued for the rider",
      ledgerEntryIds: [],
      payoutId: payout?._id,
    };
  }
  return {
    status: cancelled ? APPLIED : NOT_REQUIRED,
    amount: cancelled?.amount || 0,
    detail: cancelled
      ? "Queued delivery payout cancelled"
      : "No delivery earning for a cancelled order",
  };
}

async function adjustCod(record, order) {
  if (order.paymentMode !== "COD") {
    return { status: NOT_REQUIRED, amount: 0, detail: "Not a cash-on-delivery order" };
  }
  const collected = roundCurrency(order.paymentBreakdown?.codCollectedAmount || 0);
  const remitted = roundCurrency(order.paymentBreakdown?.codRemittedAmount || 0);
  if (collected <= 0) {
    return {
      status: NOT_REQUIRED,
      amount: 0,
      detail: "No cash was collected; no COD liability was created",
    };
  }
  // Cash changed hands before the cancellation was approved. Record the
  // reconciliation; returning cash to the customer is a manual step.
  const ledgerEntryIds = [];
  if (remitted > 0) {
    const adminWallet = await getOrCreateWallet(OWNER_TYPE.ADMIN, null);
    const entry = await createLedgerEntry({
      orderId: order._id,
      walletId: adminWallet._id,
      actorType: OWNER_TYPE.ADMIN,
      type: LEDGER_TRANSACTION_TYPE.CANCELLATION_REVERSAL,
      direction: LEDGER_DIRECTION.DEBIT,
      amount: remitted,
      status: LEDGER_STATUS.PENDING,
      paymentMode: "COD",
      description: `COD deposit reversal for cancelled order #${order.orderId}`,
      reference: order.orderId,
      metadata: { cancellationId: String(record._id), codRemitted: remitted },
      idempotencyKey: `CXL-${record._id}-COD-REVERSAL`,
    });
    ledgerEntryIds.push(entry._id);
  }
  return {
    status: MANUAL_REVIEW,
    amount: collected,
    detail: remitted > 0
      ? `₹${collected} cash collected and ₹${remitted} already deposited; reversal recorded, refund to customer pending`
      : `₹${collected} cash collected by the rider; must be returned to the customer`,
    ledgerEntryIds,
  };
}

/**
 * Apply whichever adjustments are ready. Seller and COD run as soon as the
 * order is cancelled; the rider part waits for the parcel to be back at the
 * store when the cancellation happened after pickup.
 * Returns true when no part is left PENDING.
 */
export async function applyCancellationSettlement(recordId) {
  const record = await OrderCancellation.findById(recordId).lean();
  if (!record) return true;
  const order = await Order.findById(record.order).lean();
  if (!order) return true;
  const policy = await getCancellationPolicy();

  const ready = {
    seller: true,
    cod: true,
    rider:
      !record.afterPickup ||
      [RETURN_LEG_STATUS.RETURNED_TO_STORE, RETURN_LEG_STATUS.INSPECTED].includes(record.returnLeg?.status),
  };
  const handlers = {
    seller: () => adjustSeller(record, order),
    rider: () => adjustRider(record, order, policy),
    cod: () => adjustCod(record, order),
  };

  let allDone = true;
  for (const part of ["seller", "rider", "cod"]) {
    const current = record.settlement?.[part]?.status;
    const stale = isStaleClaim(record.settlement?.[part]);
    if (current && ![PENDING, SETTLEMENT_ADJUSTMENT_STATUS.FAILED].includes(current) && !stale) continue;
    if (!ready[part]) {
      allDone = false;
      continue;
    }
    if (!(await claimPart(record._id, part))) continue;
    try {
      const result = await handlers[part]();
      await finishPart(record, part, result);
    } catch (error) {
      allDone = false;
      await failPart(record, part, error);
    }
  }

  const riderCompensated = (await OrderCancellation.findById(recordId).select("settlement.rider").lean())
    ?.settlement?.rider;
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        "settlementStatus.overall": ORDER_SETTLEMENT_STATUS.CANCELLED,
        "settlementStatus.sellerPayout": "NOT_APPLICABLE",
        "settlementStatus.riderPayout":
          riderCompensated?.status === APPLIED && riderCompensated.amount > 0 && /compensation/i.test(riderCompensated.detail || "")
            ? "PENDING"
            : "NOT_APPLICABLE",
      },
    },
  );
  return allDone;
}
