export const ALLOWED_RETURN_REASONS = [
  "Damaged Product",
  "Wrong Product",
  "Quality Issue",
  "Expired Product",
  "Missing Item",
  "Received Different Variant",
  "Packaging Issue",
  "Other",
];

export const VALID_RETURN_WINDOWS = [1, 2, 3, 5, 7, 10, 15, 30];

/**
 * Calculates whether an order item is eligible for return.
 *
 * @param {Object} orderItem - Item snapshot inside an order
 * @param {Date|string|null} deliveredAt - Date when order was delivered
 * @param {string} orderStatus - Order status e.g. "delivered"
 * @param {Date|string|number} [now] - Reference date for calculation
 * @returns {{ returnEligible: boolean, remainingReturnDays: number, reason: string }}
 */
export function isReturnEligible(orderItem, deliveredAt, orderStatus, now = new Date()) {
  const currentDate = new Date(now);

  if (!orderItem) {
    return { returnEligible: false, remainingReturnDays: 0, reason: "Item not found" };
  }

  const policy = orderItem.returnPolicy || { isReturnable: false, returnWindowDays: 0, returnReasons: [] };

  if (!policy.isReturnable) {
    return { returnEligible: false, remainingReturnDays: 0, reason: "Non Returnable" };
  }

  const normalizedStatus = String(orderStatus || "").toLowerCase();
  if (normalizedStatus !== "delivered") {
    return { returnEligible: false, remainingReturnDays: 0, reason: "Order not delivered" };
  }

  if (!deliveredAt) {
    return { returnEligible: false, remainingReturnDays: 0, reason: "Delivery date missing" };
  }

  const deliveryDate = new Date(deliveredAt);
  if (isNaN(deliveryDate.getTime())) {
    return { returnEligible: false, remainingReturnDays: 0, reason: "Invalid delivery date" };
  }

  if (orderItem.returnStatus && orderItem.returnStatus !== "none") {
    return { returnEligible: false, remainingReturnDays: 0, reason: `Return already ${orderItem.returnStatus}` };
  }

  const windowDays = Number(policy.returnWindowDays) || 0;
  if (windowDays <= 0) {
    return { returnEligible: false, remainingReturnDays: 0, reason: "Non Returnable" };
  }

  const windowMs = windowDays * 24 * 60 * 60 * 1000;
  const expiryTimestamp = deliveryDate.getTime() + windowMs;
  const currentTimestamp = currentDate.getTime();

  if (currentTimestamp > expiryTimestamp) {
    return { returnEligible: false, remainingReturnDays: 0, reason: "Return Window Closed" };
  }

  const diffMs = expiryTimestamp - currentTimestamp;
  const remainingReturnDays = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));

  return {
    returnEligible: true,
    remainingReturnDays,
    reason: "Eligible for Return",
  };
}

/**
 * Decorates an order object's items with return policy metadata, returnEligible boolean,
 * and remainingReturnDays count.
 *
 * @param {Object} order - Order object or document
 * @param {Date|string|number} [now] - Reference time
 * @returns {Object} Decorated order object
 */
export function decorateOrderWithReturnEligibility(order, now = new Date()) {
  if (!order) return order;
  const orderObj = typeof order.toObject === "function" ? order.toObject() : { ...order };
  
  const deliveredAt = orderObj.deliveredAt || orderObj.updatedAt || orderObj.createdAt;
  const status = orderObj.orderStatus || orderObj.status || "";

  if (Array.isArray(orderObj.items)) {
    orderObj.items = orderObj.items.map((item) => {
      const policy = item.returnPolicy || { isReturnable: false, returnWindowDays: 0, returnReasons: [] };
      const eligibility = isReturnEligible(item, deliveredAt, status, now);
      return {
        ...item,
        returnPolicy: policy,
        returnEligible: eligibility.returnEligible,
        remainingReturnDays: eligibility.remainingReturnDays,
        returnEligibilityReason: eligibility.reason,
      };
    });
  }

  const walletAmt = Number(
    orderObj.walletAmount ||
    orderObj.pricing?.walletAmount ||
    orderObj.paymentBreakdown?.walletDebitedAmount ||
    0
  );
  const grandTotal = Number(
    orderObj.pricing?.total ||
    orderObj.payableAmount ||
    orderObj.paymentBreakdown?.grandTotal ||
    0
  );

  if (
    walletAmt > 0 &&
    (walletAmt >= grandTotal ||
      grandTotal === 0 ||
      (orderObj.payment?.method || "").toLowerCase() === "wallet")
  ) {
    orderObj.payment = orderObj.payment || {};
    orderObj.payment.method = "wallet";
    orderObj.paymentMode = "WALLET";
  }

  return orderObj;
}
