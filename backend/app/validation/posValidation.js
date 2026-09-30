/**
 * Joi schema for the seller POS (walk-in counter sale) endpoint.
 * Follows the same per-domain schema convention as orderValidation.js.
 */
import Joi from "joi";

const trimmedString = Joi.string().trim();

const posItemSchema = Joi.object({
  productId: trimmedString.required(),
  quantity: Joi.number().integer().min(1).required(),
  // Manually entered/edited at the till — trusted here, re-validated
  // against the product's own price is intentionally NOT enforced since
  // POS explicitly allows the cashier to edit the line price.
  price: Joi.number().min(0).required(),
  variantSku: trimmedString.allow("").optional(),
  gstPercent: Joi.number().min(0).max(100).optional(),
});

// SPLIT only: tender lines that must add up to the bill total (checked server-side).
const posPaymentsSchema = Joi.array()
  .items(
    Joi.object({
      method: trimmedString.valid("CASH", "CARD", "QR", "OTHER").required(),
      amount: Joi.number().min(0).required(),
    }),
  )
  .min(2);

export const createPosSaleSchema = Joi.object({
  items: Joi.array().items(posItemSchema).min(1).required(),
  posPaymentMethod: trimmedString.valid("CASH", "CARD", "QR", "CREDIT", "OTHER", "SPLIT").required(),
  posPayments: posPaymentsSchema.when("posPaymentMethod", { is: "SPLIT", then: Joi.required(), otherwise: Joi.forbidden() }),
  // CASH only: cash handed over, so the receipt can show change due.
  cashTendered: Joi.number().min(0).optional(),
  // Required when posPaymentMethod is CREDIT (udhaar); optional link otherwise.
  posCustomerId: trimmedString.allow("").optional(),
  // CREDIT only: amount paid up front (cash); the rest goes to the customer ledger.
  amountPaid: Joi.number().min(0).optional(),
  // Flat manual discount in rupees, on top of any coupon.
  discount: Joi.number().min(0).optional(),
  taxPercent: Joi.number().min(0).max(100).optional(),
  taxTotal: Joi.number().min(0).optional(),
  isTaxInclusive: Joi.boolean().optional(),
  walkInCustomer: Joi.object({
    name: trimmedString.max(100).allow("").optional(),
    phone: trimmedString.max(20).allow("").optional(),
  }).optional(),
  // Only honored when Settings.posCouponsEnabled is on (see posSaleService.js).
  couponCode: trimmedString.max(50).allow("").optional(),
});

// Totals-only preview (coupon + manual discount + tax) so the till shows the real amount due.
export const previewPosSaleSchema = Joi.object({
  items: Joi.array().items(posItemSchema).min(1).required(),
  discount: Joi.number().min(0).optional(),
  taxPercent: Joi.number().min(0).max(100).optional(),
  taxTotal: Joi.number().min(0).optional(),
  isTaxInclusive: Joi.boolean().optional(),
  couponCode: trimmedString.max(50).allow("").optional(),
});

export const editPosSaleSchema = Joi.object({
  items: Joi.array().items(posItemSchema).min(1).required(),
  posPaymentMethod: trimmedString.valid("CASH", "CARD", "QR", "CREDIT", "OTHER", "SPLIT").optional(),
  posPayments: posPaymentsSchema.optional(),
  posCustomerId: trimmedString.allow("").optional(),
  amountPaid: Joi.number().min(0).optional(),
  discount: Joi.number().min(0).optional(),
  taxPercent: Joi.number().min(0).max(100).optional(),
  taxTotal: Joi.number().min(0).optional(),
  isTaxInclusive: Joi.boolean().optional(),
  reason: trimmedString.max(200).allow("").optional(),
});

const posReturnItemSchema = Joi.object({
  productId: trimmedString.required(),
  variantSlot: trimmedString.allow("").optional(),
  quantity: Joi.number().integer().min(1).required(),
  // "good" restocks the item so it can be resold on the live storefront;
  // "damaged" is logged but never touches Product.stock (see posReturnService.js).
  condition: trimmedString.valid("good", "damaged").required(),
});

export const createPosReturnSchema = Joi.object({
  orderId: trimmedString.required(),
  items: Joi.array().items(posReturnItemSchema).min(1).required(),
  // How the cashier actually handed the money back — independent of the
  // original sale's posPaymentMethod (e.g. a card sale can be refunded in cash).
  refundMethod: trimmedString.valid("CASH", "CARD", "QR", "CREDIT").required(),
  reason: trimmedString.max(200).allow("").optional(),
  notes: trimmedString.max(500).allow("").optional(),
});
