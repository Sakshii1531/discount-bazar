/**
 * Finance helpers.
 * Internally compute in paise to avoid floating-point drift.
 */

export function toPaise(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100);
}

export function fromPaise(paise) {
  const num = Number(paise || 0);
  if (!Number.isFinite(num)) return 0;
  return Number((num / 100).toFixed(2));
}

export function roundCurrency(value) {
  return fromPaise(toPaise(value));
}

/** Display round-off: whole rupees, rounded up (sign-aware), like checkout totals. */
export function ceilRupees(value) {
  const paise = toPaise(value);
  const rupees = Math.ceil(Math.abs(paise) / 100);
  return paise < 0 ? -rupees : rupees;
}

export function addMoney(...values) {
  const totalPaise = values.reduce((sum, value) => sum + toPaise(value), 0);
  return fromPaise(totalPaise);
}

export function subtractMoney(minuend, ...subtrahends) {
  const totalPaise = subtrahends.reduce(
    (sum, value) => sum - toPaise(value),
    toPaise(minuend),
  );
  return fromPaise(totalPaise);
}

export function multiplyMoney(value, multiplier) {
  return fromPaise(toPaise(value) * Number(multiplier || 0));
}

export function percentOf(value, ratePercent) {
  const basePaise = toPaise(value);
  const pct = Number(ratePercent || 0);
  if (!Number.isFinite(pct)) return 0;
  return fromPaise(Math.round((basePaise * pct) / 100));
}

export function clampMoney(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  return roundCurrency(Math.min(Math.max(Number(value || 0), min), max));
}

/**
 * Purchase-price GST breakdown (2-decimal rounding).
 *  INCLUSIVE: base = price / (1 + rate/100), gst = price - base, final = price
 *  EXCLUSIVE: base = price,                 gst = price * rate/100, final = price + gst
 * Throws a 400 error for negative / non-numeric price or rate.
 */
export function computePurchaseGst(purchasePrice, gstRate, gstType = "EXCLUSIVE") {
  const bad = (msg) => Object.assign(new Error(msg), { statusCode: 400 });
  const price = purchasePrice === "" || purchasePrice == null ? 0 : Number(purchasePrice);
  const rate = gstRate === "" || gstRate == null ? 0 : Number(gstRate);
  if (!Number.isFinite(price)) throw bad("Purchase price must be a valid number");
  if (price < 0) throw bad("Purchase price cannot be negative");
  if (!Number.isFinite(rate)) throw bad("GST rate must be a valid number");
  if (rate < 0) throw bad("GST rate cannot be negative");
  if (rate > 100) throw bad("GST rate cannot be more than 100%");

  if (String(gstType).toUpperCase() === "INCLUSIVE") {
    const basePrice = roundCurrency(price / (1 + rate / 100));
    return { basePrice, gstAmount: fromPaise(toPaise(price) - toPaise(basePrice)), finalPrice: roundCurrency(price) };
  }
  const gstAmount = percentOf(price, rate);
  return { basePrice: roundCurrency(price), gstAmount, finalPrice: addMoney(price, gstAmount) };
}

export function ceilKm(valueKm) {
  const num = Number(valueKm || 0);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.ceil(num);
}
