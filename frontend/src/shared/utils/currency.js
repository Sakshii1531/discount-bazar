/**
 * Centralized Integer Currency Formatter
 * 
 * Formats monetary amounts as integer values using Math.ceil() for UI consistency.
 * 
 * Examples:
 *   formatCurrencyInteger(150)    => "₹150"
 *   formatCurrencyInteger(30)     => "₹30"
 *   formatCurrencyInteger(7.5)    => "₹8"
 *   formatCurrencyInteger(187.5)  => "₹188"
 *   formatCurrencyInteger(0)      => "₹0"
 *   formatCurrencyInteger(-7.5)   => "-₹8"
 */

// Snap to whole paise first so float noise from sums (e.g. 72.00000000001)
// doesn't get rounded up to the next rupee.
const ceilRupees = (value) => Math.ceil(Math.round(value * 100) / 100);

export function formatPriceInteger(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return 0;
  if (num < 0) {
    return -ceilRupees(Math.abs(num));
  }
  return ceilRupees(num);
}

export function formatCurrencyInteger(amount, symbol = "₹") {
  const num = Number(amount);
  if (!Number.isFinite(num)) return `${symbol}0`;

  if (num < 0) {
    return `-${symbol}${ceilRupees(Math.abs(num))}`;
  }

  return `${symbol}${ceilRupees(num)}`;
}

/**
 * Rounded-up amount with Indian digit grouping, without the symbol, so it can
 * drop into existing `₹{...}` markup: formatAmount(1234.5) => "1,235".
 */
export function formatAmount(amount) {
  return formatPriceInteger(amount).toLocaleString("en-IN");
}

/**
 * Live purchase-price GST breakdown for the product form (mirrors the backend's
 * computePurchaseGst; the server recalculates before saving).
 *  INCLUSIVE: base = price / (1 + rate/100), gst = price - base, final = price
 *  EXCLUSIVE: base = price,                 gst = price * rate/100, final = price + gst
 * Returns { error } for negative / non-numeric input and { empty: true } when no price is entered.
 */
export function computePurchaseGst(purchasePrice, gstRate, gstType = "EXCLUSIVE") {
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const priceStr = String(purchasePrice ?? "").trim();
  const rateStr = String(gstRate ?? "").trim();
  const price = Number(priceStr);
  const rate = rateStr === "" ? 0 : Number(rateStr);

  if (rateStr !== "" && !Number.isFinite(rate)) return { error: "GST rate must be a valid number" };
  if (rate < 0) return { error: "GST rate cannot be negative" };
  if (rate > 100) return { error: "GST rate cannot be more than 100%" };
  if (priceStr === "") return { empty: true };
  if (!Number.isFinite(price)) return { error: "Purchase price must be a valid number" };
  if (price < 0) return { error: "Purchase price cannot be negative" };

  if (String(gstType).toUpperCase() === "INCLUSIVE") {
    const basePrice = r2(price / (1 + rate / 100));
    return { basePrice, gstAmount: r2(price - basePrice), finalPrice: r2(price) };
  }
  const gstAmount = r2((price * rate) / 100);
  return { basePrice: r2(price), gstAmount, finalPrice: r2(price + gstAmount) };
}

export default formatCurrencyInteger;
