/**
 * Delivery fee and delivery time = global (admin) value + product (seller) value.
 *
 * Global values come from finance settings:
 *   - fee:  the base delivery fee (fixed fee in fixed-price mode; the base fee
 *           within the base radius in distance-based mode — distance surcharge
 *           is added at checkout once the address is known)
 *   - time: globalDeliveryTimeMinutes
 * Product values come from the product: productDeliveryFee, productDeliveryTimeMinutes.
 *
 * Cart rule (per seller, because every seller ships separately):
 *   fee  = global fee + sum of each distinct product's fee
 *   time = highest (global time + product time) among the products
 * A fee of 0 means free delivery. A time of 0 shows the admin's
 * zeroDeliveryTimeMessage (e.g. "Instant Delivery").
 */
import { DELIVERY_PRICING_MODE } from "../constants/finance.js";
import { getOrCreateFinanceSettings } from "./finance/financeSettingsService.js";

export const DEFAULT_ZERO_DELIVERY_TIME_MESSAGE = "Instant Delivery";

const round2 = (value) => Math.round(Number(value) * 100) / 100;

/** Non-negative money value; anything invalid counts as 0. */
export function toDeliveryFee(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? round2(n) : 0;
}

/** Non-negative whole minutes; anything invalid counts as 0. */
export function toDeliveryMinutes(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

export function getGlobalDeliveryFee(settings = {}) {
  const mode = settings.deliveryPricingMode || DELIVERY_PRICING_MODE.DISTANCE_BASED;
  if (mode === DELIVERY_PRICING_MODE.FIXED_PRICE) {
    return toDeliveryFee(settings.fixedDeliveryFee ?? settings.customerBaseDeliveryFee);
  }
  return toDeliveryFee(settings.customerBaseDeliveryFee);
}

export function getGlobalDeliveryTimeMinutes(settings = {}) {
  return toDeliveryMinutes(settings.globalDeliveryTimeMinutes);
}

export function formatDeliveryTime(minutes, settings = {}) {
  const m = toDeliveryMinutes(minutes);
  if (m > 0) return `${m} mins`;
  const message = String(settings.zeroDeliveryTimeMessage || "").trim();
  return message || DEFAULT_ZERO_DELIVERY_TIME_MESSAGE;
}

/** Final values one product shows to the customer. */
export function quoteProductDelivery(product = {}, settings = {}) {
  const fee = round2(getGlobalDeliveryFee(settings) + toDeliveryFee(product.productDeliveryFee));
  const minutes =
    getGlobalDeliveryTimeMinutes(settings) + toDeliveryMinutes(product.productDeliveryTimeMinutes);
  return {
    finalDeliveryFee: fee,
    isFreeDelivery: fee === 0,
    finalDeliveryTimeMinutes: minutes,
    deliveryTime: formatDeliveryTime(minutes, settings),
  };
}

/**
 * Product-level part of one seller's cart: the sum of distinct products'
 * fees (charged once per product, not per unit) and the slowest product time.
 * `items` need productId, productDeliveryFee and productDeliveryTimeMinutes.
 */
export function quoteCartProductDelivery(items = [], settings = {}) {
  const seen = new Set();
  let productDeliveryFeeTotal = 0;
  let maxProductMinutes = 0;
  for (const item of items) {
    const key = String(item?.productId ?? "");
    if (seen.has(key)) continue;
    seen.add(key);
    productDeliveryFeeTotal = round2(productDeliveryFeeTotal + toDeliveryFee(item.productDeliveryFee));
    maxProductMinutes = Math.max(maxProductMinutes, toDeliveryMinutes(item.productDeliveryTimeMinutes));
  }
  const deliveryTimeMinutes = getGlobalDeliveryTimeMinutes(settings) + maxProductMinutes;
  return {
    productDeliveryFeeTotal,
    deliveryTimeMinutes,
    deliveryTimeLabel: formatDeliveryTime(deliveryTimeMinutes, settings),
  };
}

/** Adds final delivery fee/time to products sent to customers (mutates copies). */
export async function decorateProductsWithDelivery(products, settings = null) {
  const list = Array.isArray(products) ? products : products ? [products] : [];
  if (list.length === 0) return products;
  const effective = settings || (await getOrCreateFinanceSettings());
  const decorate = (p) => {
    if (!p || typeof p !== "object") return p;
    const plain = typeof p.toObject === "function" ? p.toObject() : { ...p };
    return { ...plain, ...quoteProductDelivery(plain, effective) };
  };
  return Array.isArray(products) ? list.map(decorate) : decorate(products);
}

/**
 * Cart quote before checkout (no address yet): per seller, global fee +
 * product fees and the slowest product time; across sellers, fees add up
 * and the ETA is the slowest seller. In distance-based mode the distance
 * surcharge is added at checkout, so the result is flagged `estimated`.
 */
export function quoteCartDelivery(products = [], settings = {}) {
  const bySeller = new Map();
  for (const p of products) {
    const sellerId = String(p?.sellerId?._id ?? p?.sellerId ?? "");
    if (!bySeller.has(sellerId)) bySeller.set(sellerId, []);
    bySeller.get(sellerId).push({
      productId: p._id,
      productDeliveryFee: p.productDeliveryFee,
      productDeliveryTimeMinutes: p.productDeliveryTimeMinutes,
    });
  }
  const globalFee = getGlobalDeliveryFee(settings);
  const sellers = [...bySeller.entries()].map(([sellerId, items]) => {
    const part = quoteCartProductDelivery(items, settings);
    const deliveryFee = round2(globalFee + part.productDeliveryFeeTotal);
    return {
      sellerId,
      deliveryFee,
      isFreeDelivery: deliveryFee === 0,
      deliveryTimeMinutes: part.deliveryTimeMinutes,
      deliveryTime: part.deliveryTimeLabel,
    };
  });
  const deliveryFee = round2(sellers.reduce((sum, s) => sum + s.deliveryFee, 0));
  const deliveryTimeMinutes = sellers.length
    ? Math.max(...sellers.map((s) => s.deliveryTimeMinutes))
    : getGlobalDeliveryTimeMinutes(settings);
  return {
    deliveryFee,
    isFreeDelivery: deliveryFee === 0,
    deliveryTimeMinutes,
    deliveryTime: formatDeliveryTime(deliveryTimeMinutes, settings),
    estimated:
      (settings.deliveryPricingMode || DELIVERY_PRICING_MODE.DISTANCE_BASED) !==
      DELIVERY_PRICING_MODE.FIXED_PRICE,
    sellers,
  };
}
