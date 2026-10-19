// Live minimum-order check for the cart and checkout. Mirrors the backend's
// minimumOrderService: the eligible subtotal is the selling-price merchandise
// value of in-stock items, less the coupon's merchandise discount when the
// admin counts it, and never includes delivery, fees, tax or tip. The server
// re-checks on every preview and order, so this only drives the UI.
import { getDisplayPricing } from './productPricing';
import { formatAmount } from '@shared/utils/currency';

export const MIN_ORDER_ERROR_CODE = 'MIN_ORDER_VALUE_NOT_MET';

const round2 = (value) => Math.round(Number(value || 0) * 100) / 100;

export function getMinimumOrderStatus({
  cart = [],
  minOrderValue,
  couponDiscount = 0,
  includeCouponDiscount = true,
  isItemOutOfStock,
}) {
  const threshold = Number(minOrderValue);
  // Not loaded yet (or switched off): nothing to block on the client.
  if (!Number.isFinite(threshold) || threshold <= 0) return null;

  const merchandise = cart.reduce((sum, item) => {
    if (typeof isItemOutOfStock === 'function' && isItemOutOfStock(item, item.variantSku)) return sum;
    return sum + getDisplayPricing(item).sellingPrice * Number(item.quantity || 0);
  }, 0);
  const discount = includeCouponDiscount ? Math.max(0, Number(couponDiscount || 0)) : 0;
  const eligibleSubtotal = Math.max(0, round2(merchandise - discount));
  const remainingAmount = Math.max(0, round2(threshold - eligibleSubtotal));
  return { minOrderValue: round2(threshold), eligibleSubtotal, remainingAmount, isMet: remainingAmount <= 0 };
}

export function minimumOrderMessage(remainingAmount) {
  return `Add ₹${formatAmount(remainingAmount)} more to place your order.`;
}
