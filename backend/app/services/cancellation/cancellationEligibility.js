/**
 * Pure cancellation rules: which stage an order is in, what the customer may
 * do about it, and how much of what they paid comes back.
 *
 * Nothing here touches the database. The same functions drive the customer
 * preview, the server-side check before a cancel is committed, and the atomic
 * update filter, so the UI can never offer an action the backend would refuse
 * for a different reason.
 */
import {
  WORKFLOW_STATUS,
  workflowFromLegacyStatus,
} from "../../constants/orderWorkflow.js";
import {
  CANCELLATION_ACTION,
  CANCELLATION_STAGE,
  CANCELLATION_STATUS,
  OPEN_REQUEST_STATUSES,
  REFUND_ALLOCATION,
  REFUND_SOURCE,
} from "../../constants/cancellation.js";
import { roundCurrency } from "../../utils/money.js";

const PRE_PICKUP_STAGES = new Set([
  CANCELLATION_STAGE.AWAITING_PAYMENT,
  CANCELLATION_STAGE.PENDING_ACCEPTANCE,
  CANCELLATION_STAGE.ACCEPTED,
  CANCELLATION_STAGE.PACKED,
  CANCELLATION_STAGE.RIDER_ASSIGNED,
  CANCELLATION_STAGE.RIDER_AT_STORE,
]);

/** Stages where the seller has not yet committed any work. */
const BEFORE_ACCEPTANCE_STAGES = new Set([
  CANCELLATION_STAGE.AWAITING_PAYMENT,
  CANCELLATION_STAGE.PENDING_ACCEPTANCE,
]);

export function isPrePickupStage(stage) {
  return PRE_PICKUP_STAGES.has(stage);
}

function orderWorkflowStatus(order) {
  if (Number(order?.workflowVersion) >= 2 && order?.workflowStatus) {
    return order.workflowStatus;
  }
  return workflowFromLegacyStatus(order?.status);
}

export function resolveCancellationStage(order) {
  if (!order) return CANCELLATION_STAGE.NOT_APPLICABLE;
  if (order.orderSource === "POS") return CANCELLATION_STAGE.NOT_APPLICABLE;

  const legacy = String(order.status || "").toLowerCase();
  const ws = orderWorkflowStatus(order);

  if (legacy === "cancelled" || ws === WORKFLOW_STATUS.CANCELLED) {
    return CANCELLATION_STAGE.CANCELLED;
  }
  if (legacy === "delivered" || ws === WORKFLOW_STATUS.DELIVERED || order.deliveredAt) {
    return CANCELLATION_STAGE.DELIVERED;
  }
  // Pickup confirmation is the hard line — the parcel is physically with
  // the rider from here on, whatever the status label says.
  if (order.pickupConfirmedAt || ws === WORKFLOW_STATUS.OUT_FOR_DELIVERY || legacy === "out_for_delivery") {
    return CANCELLATION_STAGE.PICKED_UP;
  }
  switch (ws) {
    case WORKFLOW_STATUS.CREATED:
      return CANCELLATION_STAGE.AWAITING_PAYMENT;
    case WORKFLOW_STATUS.SELLER_PENDING:
      return CANCELLATION_STAGE.PENDING_ACCEPTANCE;
    case WORKFLOW_STATUS.SELLER_ACCEPTED:
    case WORKFLOW_STATUS.DELIVERY_SEARCH:
      return order.sellerReadyAt ? CANCELLATION_STAGE.PACKED : CANCELLATION_STAGE.ACCEPTED;
    case WORKFLOW_STATUS.DELIVERY_ASSIGNED:
      return CANCELLATION_STAGE.RIDER_ASSIGNED;
    case WORKFLOW_STATUS.PICKUP_READY:
      return CANCELLATION_STAGE.RIDER_AT_STORE;
    default:
      return CANCELLATION_STAGE.NOT_APPLICABLE;
  }
}

/**
 * Mongo filter clauses matching every order state from which a direct
 * cancellation is allowed under `policy`. Used inside the atomic
 * findOneAndUpdate, so a seller accept / rider pickup that commits first
 * makes the cancel miss instead of overwriting it.
 */
export function selfCancelStateClauses(order, policy, { ignorePolicy = false } = {}) {
  const allowed = (stage) =>
    ignorePolicy || (policy.selfCancelEnabled && policy.selfCancelStages?.[stage]);
  const v2 = Number(order?.workflowVersion) >= 2;
  const clauses = [];

  if (!v2) {
    // Legacy orders only carry the coarse `status`.
    if (allowed(CANCELLATION_STAGE.PENDING_ACCEPTANCE)) clauses.push({ status: "pending" });
    if (allowed(CANCELLATION_STAGE.ACCEPTED)) clauses.push({ status: "confirmed" });
    if (allowed(CANCELLATION_STAGE.RIDER_ASSIGNED)) clauses.push({ status: "packed" });
    return clauses;
  }

  if (allowed(CANCELLATION_STAGE.AWAITING_PAYMENT)) {
    clauses.push({ workflowStatus: WORKFLOW_STATUS.CREATED });
  }
  if (allowed(CANCELLATION_STAGE.PENDING_ACCEPTANCE)) {
    clauses.push({ workflowStatus: WORKFLOW_STATUS.SELLER_PENDING });
  }
  const acceptedStates = [WORKFLOW_STATUS.SELLER_ACCEPTED, WORKFLOW_STATUS.DELIVERY_SEARCH];
  const accepted = allowed(CANCELLATION_STAGE.ACCEPTED);
  const packed = allowed(CANCELLATION_STAGE.PACKED);
  if (accepted && packed) {
    clauses.push({ workflowStatus: { $in: acceptedStates } });
  } else if (accepted) {
    clauses.push({ workflowStatus: { $in: acceptedStates }, sellerReadyAt: null });
  } else if (packed) {
    clauses.push({ workflowStatus: { $in: acceptedStates }, sellerReadyAt: { $ne: null } });
  }
  if (allowed(CANCELLATION_STAGE.RIDER_ASSIGNED)) {
    clauses.push({ workflowStatus: WORKFLOW_STATUS.DELIVERY_ASSIGNED });
  }
  if (allowed(CANCELLATION_STAGE.RIDER_AT_STORE)) {
    clauses.push({ workflowStatus: WORKFLOW_STATUS.PICKUP_READY });
  }
  return clauses;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Captured gateway money for an order, as the finance ledger recorded it. */
export function isGatewayPaymentCaptured(order) {
  return (
    order?.paymentMode === "ONLINE" &&
    Boolean(order?.financeFlags?.onlinePaymentCaptured || order?.paymentStatus === "PAID")
  );
}

export function isGatewayPaymentUnconfirmed(order) {
  return (
    order?.paymentMode === "ONLINE" &&
    !isGatewayPaymentCaptured(order) &&
    !["FAILED", "REFUNDED"].includes(order?.paymentStatus)
  );
}

function orderCharges(order) {
  const pb = order?.paymentBreakdown || {};
  const pricing = order?.pricing || {};
  return {
    grandTotal: roundCurrency(num(pb.grandTotal ?? pricing.total)),
    walletAmount: roundCurrency(num(pb.walletAmount || pricing.walletAmount)),
    deliveryFee: roundCurrency(num(pb.deliveryFeeCharged || pricing.deliveryFee)),
    handlingFee: roundCurrency(num(pb.handlingFeeCharged || pricing.platformFee)),
    tip: roundCurrency(num(pb.tipTotal || pricing.tip)),
  };
}

/**
 * Refund plan for cancelling `order` at `stage`.
 *
 * The refundable amount starts from what the customer actually paid (so
 * coupon discounts and tax are already accounted for) and subtracts only
 * the charges the policy declares non-refundable at this stage. It can
 * never exceed the paid amount, and COD money that was never collected is
 * never "refunded".
 *
 * `assumeCaptured` previews the plan for an online payment that the gateway
 * has not confirmed yet.
 */
export function computeRefundPlan(order, policy, { stage, assumeCaptured = false, waiveDeductions = false } = {}) {
  const charges = orderCharges(order);
  const afterPickup = stage === CANCELLATION_STAGE.PICKED_UP;
  const captured = isGatewayPaymentCaptured(order) || (assumeCaptured && order?.paymentMode === "ONLINE");

  const paidWallet = order?.paymentMode === "WALLET"
    ? Math.max(charges.walletAmount, charges.grandTotal)
    : charges.walletAmount;
  const paidGateway = captured && order?.paymentMode === "ONLINE" ? charges.grandTotal : 0;
  const totalPaid = roundCurrency(paidWallet + paidGateway);

  const deductions = {
    deliveryFee: 0,
    handlingFee: 0,
    tip: 0,
    cancellationFee: 0,
  };
  if (waiveDeductions) {
    // Cancelled by the seller, the platform or an admin: full refund.
  } else if (afterPickup) {
    if (!policy.refundDeliveryFeeAfterPickup) deductions.deliveryFee = charges.deliveryFee;
    if (!policy.refundHandlingFeeAfterPickup) deductions.handlingFee = charges.handlingFee;
    if (!policy.refundTipAfterPickup) deductions.tip = charges.tip;
    deductions.cancellationFee = num(policy.cancellationFeeAfterPickup);
  } else {
    if (!policy.refundDeliveryFeeBeforePickup) deductions.deliveryFee = charges.deliveryFee;
    if (!policy.refundHandlingFeeBeforePickup) deductions.handlingFee = charges.handlingFee;
    if (!policy.refundTipBeforePickup) deductions.tip = charges.tip;
    if (!BEFORE_ACCEPTANCE_STAGES.has(stage)) {
      deductions.cancellationFee = num(policy.cancellationFeeAfterAcceptance);
    }
  }

  // Deductions can only be withheld from money actually held.
  const requestedDeduction = roundCurrency(
    deductions.deliveryFee + deductions.handlingFee + deductions.tip + deductions.cancellationFee,
  );
  const deductionTotal = roundCurrency(Math.min(requestedDeduction, totalPaid));
  const refundable = roundCurrency(Math.max(0, totalPaid - deductionTotal));

  let walletRefund;
  let gatewayRefund;
  if (policy.refundAllocation === REFUND_ALLOCATION.GATEWAY_FIRST) {
    gatewayRefund = roundCurrency(Math.min(paidGateway, refundable));
    walletRefund = roundCurrency(Math.min(paidWallet, refundable - gatewayRefund));
  } else {
    walletRefund = roundCurrency(Math.min(paidWallet, refundable));
    gatewayRefund = roundCurrency(Math.min(paidGateway, refundable - walletRefund));
  }

  const allocations = [];
  if (walletRefund > 0) allocations.push({ source: REFUND_SOURCE.WALLET, amount: walletRefund });
  if (gatewayRefund > 0) {
    allocations.push({
      source: REFUND_SOURCE.GATEWAY,
      amount: gatewayRefund,
      destination: policy.onlineRefundDestination,
    });
  }

  return {
    paymentMode: order?.paymentMode || "COD",
    paidWallet: roundCurrency(paidWallet),
    paidGateway: roundCurrency(paidGateway),
    totalPaid,
    deductions: {
      ...Object.fromEntries(Object.entries(deductions).map(([k, v]) => [k, roundCurrency(v)])),
      total: deductionTotal,
    },
    refundable,
    allocations,
    refundRequired: refundable > 0,
    afterPickup,
  };
}

function specialConditionsFor(order, stage, plan, policy) {
  const notes = [];
  if (stage === CANCELLATION_STAGE.PACKED) {
    notes.push("The store has already packed your order. It will be unpacked and not dispatched.");
  }
  if (stage === CANCELLATION_STAGE.RIDER_ASSIGNED || stage === CANCELLATION_STAGE.RIDER_AT_STORE) {
    notes.push("A delivery partner is already assigned. They will be told to stop the pickup.");
  }
  if (stage === CANCELLATION_STAGE.PICKED_UP) {
    notes.push("Your parcel is already with the delivery partner, so this is a cancellation request that our support team will review.");
    notes.push("If approved, the parcel is returned to the store and your refund is processed after the store verifies the returned items.");
  }
  if (plan.deductions.deliveryFee > 0) {
    notes.push(`Delivery fee of ₹${plan.deductions.deliveryFee} is not refundable at this stage.`);
  }
  if (plan.deductions.handlingFee > 0) {
    notes.push(`Handling fee of ₹${plan.deductions.handlingFee} is not refundable at this stage.`);
  }
  if (plan.deductions.tip > 0) {
    notes.push(`Rider tip of ₹${plan.deductions.tip} is not refundable at this stage.`);
  }
  if (plan.deductions.cancellationFee > 0) {
    notes.push(`A cancellation fee of ₹${plan.deductions.cancellationFee} applies at this stage.`);
  }
  if (isGatewayPaymentUnconfirmed(order)) {
    notes.push("We have not received final confirmation of your online payment. We will verify it with the payment gateway and refund automatically if any money was deducted.");
  }
  if (plan.allocations.some((a) => a.source === REFUND_SOURCE.GATEWAY)) {
    notes.push(policy.prepaidRefundTimelineText);
  }
  return notes;
}

/**
 * What the customer may do with `order` right now.
 *
 * `record` is the existing OrderCancellation (if any). An open request
 * blocks a second one; a final record makes the response informational.
 */
export function evaluateCancellationEligibility(order, policy, record = null) {
  const stage = resolveCancellationStage(order);
  const base = {
    stage,
    action: CANCELLATION_ACTION.NONE,
    canSelfCancel: false,
    canRequest: false,
    canWithdraw: false,
    message: "",
    specialConditions: [],
    refundPreview: null,
    // Split shipments are not supported: a cancellation covers the whole order.
    partialCancellationSupported: false,
    scope: "ORDER",
  };

  const recordStatus = record?.status || null;

  if (recordStatus && OPEN_REQUEST_STATUSES.includes(recordStatus)) {
    return {
      ...base,
      message: "Your cancellation request is being reviewed by our support team.",
      canWithdraw: Boolean(policy.allowWithdrawal) && stage === CANCELLATION_STAGE.PICKED_UP,
    };
  }

  if (stage === CANCELLATION_STAGE.CANCELLED) {
    return { ...base, message: "This order has been cancelled." };
  }
  if (stage === CANCELLATION_STAGE.DELIVERED || (order?.returnStatus && order.returnStatus !== "none")) {
    return {
      ...base,
      action: CANCELLATION_ACTION.POST_DELIVERY,
      message: "This order has been delivered. For a problem with it, use Return, Exchange, Missing Item, Damaged Product or Refund Request from Help.",
    };
  }
  if (stage === CANCELLATION_STAGE.NOT_APPLICABLE) {
    return { ...base, message: "This order cannot be cancelled online." };
  }
  if (recordStatus === CANCELLATION_STATUS.TRANSFERRED) {
    return { ...base, action: CANCELLATION_ACTION.POST_DELIVERY, message: "Your request was moved to our returns and disputes team." };
  }

  const plan = computeRefundPlan(order, policy, {
    stage,
    assumeCaptured: isGatewayPaymentUnconfirmed(order),
  });
  const withPreview = {
    ...base,
    refundPreview: plan,
    specialConditions: specialConditionsFor(order, stage, plan, policy),
  };

  if (stage === CANCELLATION_STAGE.PICKED_UP) {
    if (recordStatus === CANCELLATION_STATUS.REJECTED) {
      return {
        ...withPreview,
        action: CANCELLATION_ACTION.CONTACT_SUPPORT,
        message: "Your cancellation request was not approved. Please contact support if you still need help.",
      };
    }
    if (!policy.allowRequestAfterPickup) {
      return {
        ...withPreview,
        action: CANCELLATION_ACTION.CONTACT_SUPPORT,
        message: "Your order has been picked up and can no longer be cancelled online. Please contact support.",
      };
    }
    return {
      ...withPreview,
      action: CANCELLATION_ACTION.REQUEST,
      canRequest: true,
      message: "Your order has been picked up. You can request a cancellation for review.",
    };
  }

  if (policy.selfCancelEnabled && policy.selfCancelStages?.[stage]) {
    return {
      ...withPreview,
      action: CANCELLATION_ACTION.SELF_CANCEL,
      canSelfCancel: true,
      message: "You can cancel this order.",
    };
  }
  return {
    ...withPreview,
    action: CANCELLATION_ACTION.CONTACT_SUPPORT,
    message: "This order can no longer be cancelled online at its current stage. Please contact support.",
  };
}
