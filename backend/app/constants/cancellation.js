/**
 * Order cancellation flow — shared vocabulary.
 *
 * A cancellation is tracked by its own `OrderCancellation` record, separate
 * from the order. The order only carries a small summary (`order.cancellation`)
 * so lists can render without a join. Refund, inventory, settlement and
 * notification progress are independent sub-states on the record, so an order
 * can be CANCELLED while its refund is still PROCESSING.
 */

/** How the cancellation came about. */
export const CANCELLATION_TYPE = Object.freeze({
  // Customer self-cancel before rider pickup — executed immediately.
  CUSTOMER_DIRECT: "CUSTOMER_DIRECT",
  // Customer request after pickup — needs support/admin review.
  CUSTOMER_REQUEST: "CUSTOMER_REQUEST",
  ADMIN: "ADMIN",
  SELLER: "SELLER",
  SYSTEM: "SYSTEM",
});

export const CANCELLATION_STATUS = Object.freeze({
  REQUESTED: "REQUESTED",
  UNDER_REVIEW: "UNDER_REVIEW",
  // Approved after pickup: order is cancelled, parcel is on its way back.
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  WITHDRAWN: "WITHDRAWN",
  // Order cancelled and every follow-up step has been scheduled.
  CANCELLED: "CANCELLED",
  // Order got delivered while the request was pending — handled by the
  // return / dispute workflow instead.
  TRANSFERRED: "TRANSFERRED",
});

/** Request is still open for a decision (or for withdrawal by the customer). */
export const OPEN_REQUEST_STATUSES = Object.freeze([
  CANCELLATION_STATUS.REQUESTED,
  CANCELLATION_STATUS.UNDER_REVIEW,
]);

/** The order has been cancelled through this record. */
export const ORDER_CANCELLED_STATUSES = Object.freeze([
  CANCELLATION_STATUS.APPROVED,
  CANCELLATION_STATUS.CANCELLED,
]);

export const REFUND_STATUS = Object.freeze({
  NOT_REQUIRED: "NOT_REQUIRED",
  // Waiting for something before money can move (payment confirmation,
  // returned-parcel inspection).
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  SUCCESSFUL: "SUCCESSFUL",
  FAILED: "FAILED",
  MANUAL_REVIEW: "MANUAL_REVIEW",
});

export const REFUND_SOURCE = Object.freeze({
  WALLET: "WALLET",
  GATEWAY: "GATEWAY",
});

/** Where a refunded gateway amount goes. */
export const REFUND_DESTINATION = Object.freeze({
  WALLET: "WALLET",
  ORIGINAL_SOURCE: "ORIGINAL_SOURCE",
});

/** Which payment source absorbs policy deductions first. */
export const REFUND_ALLOCATION = Object.freeze({
  // Wallet money is returned in full first; deductions come out of the
  // gateway portion.
  WALLET_FIRST: "WALLET_FIRST",
  GATEWAY_FIRST: "GATEWAY_FIRST",
});

export const INVENTORY_STATUS = Object.freeze({
  PENDING: "PENDING",
  RESTORED: "RESTORED",
  NOT_REQUIRED: "NOT_REQUIRED",
  // Post-pickup: parcel is with the rider, nothing may be restored yet.
  AWAITING_RETURN: "AWAITING_RETURN",
  AWAITING_INSPECTION: "AWAITING_INSPECTION",
  // Inspection done; only sellable units went back into stock.
  INSPECTED: "INSPECTED",
});

export const RETURN_LEG_STATUS = Object.freeze({
  NOT_REQUIRED: "NOT_REQUIRED",
  RETURN_TO_STORE: "RETURN_TO_STORE",
  RETURNED_TO_STORE: "RETURNED_TO_STORE",
  INSPECTED: "INSPECTED",
});

export const SETTLEMENT_ADJUSTMENT_STATUS = Object.freeze({
  PENDING: "PENDING",
  APPLIED: "APPLIED",
  NOT_REQUIRED: "NOT_REQUIRED",
  MANUAL_REVIEW: "MANUAL_REVIEW",
  FAILED: "FAILED",
});

export const NOTIFICATION_DELIVERY_STATUS = Object.freeze({
  PENDING: "PENDING",
  SENT: "SENT",
  FAILED: "FAILED",
});

/** What the customer can do with an order right now. */
export const CANCELLATION_ACTION = Object.freeze({
  SELF_CANCEL: "SELF_CANCEL",
  REQUEST: "REQUEST",
  CONTACT_SUPPORT: "CONTACT_SUPPORT",
  // Delivered: use return / missing item / damaged / refund / dispute flows.
  POST_DELIVERY: "POST_DELIVERY",
  NONE: "NONE",
});

/** Lifecycle stage the eligibility decision was made at. */
export const CANCELLATION_STAGE = Object.freeze({
  AWAITING_PAYMENT: "AWAITING_PAYMENT",
  PENDING_ACCEPTANCE: "PENDING_ACCEPTANCE",
  ACCEPTED: "ACCEPTED",
  PACKED: "PACKED",
  RIDER_ASSIGNED: "RIDER_ASSIGNED",
  RIDER_AT_STORE: "RIDER_AT_STORE",
  PICKED_UP: "PICKED_UP",
  DELIVERED: "DELIVERED",
  CANCELLED: "CANCELLED",
  NOT_APPLICABLE: "NOT_APPLICABLE",
});

export const CANCELLATION_REASONS = Object.freeze([
  { code: "PLACED_BY_MISTAKE", label: "Order Placed by Mistake" },
  { code: "INCORRECT_ADDRESS", label: "Incorrect Address" },
  { code: "INCORRECT_PRODUCTS", label: "Incorrect Products Ordered" },
  { code: "MODIFY_ORDER", label: "Want to Modify Order" },
  { code: "DELIVERY_TOO_LONG", label: "Delivery Taking Too Long" },
  { code: "PAYMENT_ISSUE", label: "Payment Issue" },
  { code: "BETTER_PRICE", label: "Found a Better Price" },
  { code: "OTHER", label: "Other" },
]);

export const CANCELLATION_REASON_CODES = Object.freeze(
  CANCELLATION_REASONS.map((r) => r.code),
);

export function cancellationReasonLabel(code) {
  return CANCELLATION_REASONS.find((r) => r.code === code)?.label || code || "";
}

export const MAX_REASON_TEXT_LENGTH = 500;

/**
 * Business defaults. Every key is editable from the Super Admin panel;
 * stored values are merged over these (see cancellationPolicyService).
 */
export const DEFAULT_CANCELLATION_POLICY = Object.freeze({
  // Master switch for customer self-cancellation.
  selfCancelEnabled: true,
  // Stages at which a customer may cancel directly (all before pickup).
  selfCancelStages: Object.freeze({
    AWAITING_PAYMENT: true,
    PENDING_ACCEPTANCE: true,
    ACCEPTED: true,
    PACKED: true,
    RIDER_ASSIGNED: true,
    RIDER_AT_STORE: true,
  }),
  // After pickup the customer may only raise a request for review.
  allowRequestAfterPickup: true,
  allowWithdrawal: true,
  // Charges refunded on a pre-pickup cancellation.
  refundDeliveryFeeBeforePickup: true,
  refundHandlingFeeBeforePickup: true,
  refundTipBeforePickup: true,
  // Charges refunded on an approved post-pickup cancellation.
  refundDeliveryFeeAfterPickup: false,
  refundHandlingFeeAfterPickup: true,
  refundTipAfterPickup: true,
  // Flat fee withheld once the seller has accepted (0 = none).
  cancellationFeeAfterAcceptance: 0,
  // Flat fee withheld on an approved post-pickup cancellation (0 = none).
  cancellationFeeAfterPickup: 0,
  onlineRefundDestination: REFUND_DESTINATION.WALLET,
  refundAllocation: REFUND_ALLOCATION.WALLET_FIRST,
  // Paid to the rider for bringing a cancelled parcel back to the store.
  riderReturnCompensation: 0,
  // How long an unconfirmed online payment is re-checked before the refund
  // is closed as not required.
  paymentVerificationWindowHours: 48,
  // Shown to the customer in the confirmation popup.
  prepaidRefundTimelineText: "Refunds to your wallet are instant. Refunds to the original payment method can take 5-7 business days.",
});

export const RECONCILE_MAX_ATTEMPTS = () =>
  parseInt(process.env.CANCELLATION_RECONCILE_MAX_ATTEMPTS || "8", 10);
export const RECONCILE_BASE_DELAY_MS = () =>
  parseInt(process.env.CANCELLATION_RECONCILE_BASE_DELAY_MS || "30000", 10);
