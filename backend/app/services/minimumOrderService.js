/**
 * Platform minimum order value (admin-configured in Fees & Charges).
 *
 * The eligible subtotal is the single-seller merchandise value after
 * product-level (sale price) discounts and — when `minOrderValueAfterCoupon`
 * is on — after the coupon's merchandise discount. Delivery, handling,
 * platform fees, tax, tip and wallet never count towards it.
 */
import { ceilRupees, roundCurrency } from "../utils/money.js";

export const MIN_ORDER_ERROR_CODE = "MIN_ORDER_VALUE_NOT_MET";

// Whole rupees, rounded up (₹78.50 short → "Add ₹79"), matching the storefront.
export function minimumOrderMessage(remainingAmount) {
  return `Add ₹${ceilRupees(remainingAmount).toLocaleString("en-IN")} more to place your order.`;
}

export function evaluateMinimumOrder({ minOrderValue = 0, merchandiseSubtotal = 0, couponDiscount = 0, includeCouponDiscount = true }) {
  const threshold = Math.max(0, roundCurrency(minOrderValue));
  const discount = includeCouponDiscount ? Math.max(0, Number(couponDiscount || 0)) : 0;
  const eligibleSubtotal = Math.max(0, roundCurrency(Number(merchandiseSubtotal || 0) - discount));
  const remainingAmount = Math.max(0, roundCurrency(threshold - eligibleSubtotal));
  return {
    minOrderValue: threshold,
    eligibleSubtotal,
    remainingAmount,
    isMet: remainingAmount <= 0,
  };
}

/** Picks the seller cart furthest from the minimum (stores are never combined). */
export function worstMinimumOrderStatus(statuses = []) {
  const list = statuses.filter(Boolean);
  if (!list.length) return null;
  return list.reduce((worst, status) => (status.remainingAmount > worst.remainingAmount ? status : worst));
}

export function buildMinimumOrderError(status) {
  const error = new Error(minimumOrderMessage(status.remainingAmount));
  error.statusCode = 400;
  error.code = MIN_ORDER_ERROR_CODE;
  error.details = {
    code: MIN_ORDER_ERROR_CODE,
    minOrderValue: status.minOrderValue,
    eligibleSubtotal: status.eligibleSubtotal,
    remainingAmount: status.remainingAmount,
  };
  return error;
}

export function assertMinimumOrderMet(status) {
  if (status && !status.isMet) {
    throw buildMinimumOrderError(status);
  }
}
