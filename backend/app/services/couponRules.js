/**
 * Admin coupon input rules. Each coupon strategy needs different fields:
 *
 *   generic          – any order, any customer
 *   min_order_value  – cart total must reach minOrderValue (required)
 *   bulk_order       – cart must hold at least minItems units (required, ≥ 2)
 *   category_based   – cart must contain a product from applicableCategories
 *                      (main/header categories, required)
 *   monthly_volume   – customer's orders this month must total
 *                      monthlyVolumeThreshold (required)
 *   free_delivery    – always gives free delivery (discount kind forced)
 *
 * Discount kinds: percentage (1–100, optional max cap), fixed (₹ > 0),
 * free_delivery (no amount). Fields that don't apply are cleared so a coupon
 * never carries a hidden rule the admin can't see.
 */
import mongoose from "mongoose";
import Category from "../models/category.js";

export const COUPON_TYPES = ["generic", "min_order_value", "bulk_order", "category_based", "monthly_volume", "free_delivery"];
export const DISCOUNT_TYPES = ["percentage", "fixed", "free_delivery"];

const ALLOWED_FIELDS = [
  "code", "title", "description", "discountType", "discountValue", "maxDiscount", "couponType",
  "minOrderValue", "minItems", "applicableCategories", "monthlyVolumeThreshold",
  "usageLimit", "perUserLimit", "validFrom", "validTill", "isActive",
];

const blank = (v) => v === undefined || v === null || v === "";
const num = (v) => (blank(v) ? null : Number(v));

/**
 * @param {object} input     request body
 * @param {object} existing  current coupon (for updates) so partial edits are checked as a whole
 * @returns {Promise<{ value?: object, error?: string }>}
 */
export async function normalizeCouponInput(input = {}, existing = null) {
  const picked = {};
  for (const k of ALLOWED_FIELDS) if (input[k] !== undefined) picked[k] = input[k];
  const base = existing ? (typeof existing.toObject === "function" ? existing.toObject() : existing) : {};
  const c = { ...Object.fromEntries(ALLOWED_FIELDS.map((k) => [k, base[k]])), ...picked };

  const code = String(c.code || "").trim().toUpperCase();
  if (!code) return { error: "Promo code is required" };
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return { error: "Promo code must be 3–30 letters, numbers, - or _" };

  const couponType = c.couponType || "generic";
  if (!COUPON_TYPES.includes(couponType)) return { error: "Unknown coupon strategy" };
  let discountType = couponType === "free_delivery" ? "free_delivery" : c.discountType || "percentage";
  if (!DISCOUNT_TYPES.includes(discountType)) return { error: "Unknown discount kind" };

  const out = {
    code,
    title: String(c.title || "").trim(),
    description: String(c.description || "").trim(),
    couponType,
    discountType,
    discountValue: 0,
    maxDiscount: null,
    minOrderValue: 0,
    minItems: 0,
    applicableCategories: [],
    monthlyVolumeThreshold: null,
  };

  // Discount amount
  const value = num(c.discountValue);
  if (discountType === "percentage") {
    if (!(value > 0 && value <= 100)) return { error: "Percentage discount must be between 1 and 100" };
    out.discountValue = value;
    const cap = num(c.maxDiscount);
    if (cap !== null) {
      if (!(cap > 0)) return { error: "Max discount must be more than ₹0 (or left empty)" };
      out.maxDiscount = cap;
    }
  } else if (discountType === "fixed") {
    if (!(value > 0)) return { error: "Discount amount must be more than ₹0" };
    out.discountValue = value;
  }

  // Minimum cart total: required for its own strategy, optional extra rule otherwise
  const minOrder = num(c.minOrderValue);
  if (minOrder !== null && !(minOrder >= 0)) return { error: "Minimum order value cannot be negative" };
  if (couponType === "min_order_value" && !(minOrder > 0)) {
    return { error: "Minimum order value coupons need a minimum cart total" };
  }
  out.minOrderValue = minOrder || 0;
  if (discountType === "fixed" && out.minOrderValue > 0 && out.discountValue > out.minOrderValue) {
    return { error: "Discount amount cannot be more than the minimum order value" };
  }

  if (couponType === "bulk_order") {
    const items = num(c.minItems);
    if (!(Number.isInteger(items) && items >= 2)) return { error: "Bulk order coupons need a minimum of at least 2 items" };
    out.minItems = items;
  }

  if (couponType === "category_based") {
    const ids = (Array.isArray(c.applicableCategories) ? c.applicableCategories : [])
      .map((x) => String(x?._id ?? x))
      .filter(Boolean);
    if (ids.length === 0) return { error: "Select at least one category for a category-based coupon" };
    if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) return { error: "Invalid category" };
    const found = await Category.countDocuments({ _id: { $in: ids }, type: "header" });
    if (found !== new Set(ids).size) return { error: "Some selected categories no longer exist" };
    out.applicableCategories = [...new Set(ids)];
  }

  if (couponType === "monthly_volume") {
    const threshold = num(c.monthlyVolumeThreshold);
    if (!(threshold > 0)) return { error: "VIP coupons need the monthly spend a customer must reach" };
    out.monthlyVolumeThreshold = threshold;
  }

  // Limits
  const usageLimit = num(c.usageLimit);
  if (usageLimit !== null && !(Number.isInteger(usageLimit) && usageLimit >= 1)) {
    return { error: "Total uses must be a whole number of 1 or more (or left empty)" };
  }
  out.usageLimit = usageLimit;
  const perUser = blank(c.perUserLimit) ? null : Number(c.perUserLimit);
  if (perUser !== null && !(Number.isInteger(perUser) && perUser >= 1)) {
    return { error: "Uses per customer must be a whole number of 1 or more (or left empty for unlimited)" };
  }
  out.perUserLimit = perUser;

  // Dates
  const from = blank(c.validFrom) ? null : new Date(c.validFrom);
  const till = blank(c.validTill) ? null : new Date(c.validTill);
  if (!from || Number.isNaN(from.getTime())) return { error: "Start date is required" };
  if (!till || Number.isNaN(till.getTime())) return { error: "End date is required" };
  out.validFrom = from;
  out.validTill = till;
  if (till < from) return { error: "End date must be after the start date" };

  if (c.isActive !== undefined) out.isActive = Boolean(c.isActive);
  return { value: out };
}
