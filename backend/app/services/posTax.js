import { roundCurrency } from "../utils/money.js";

/**
 * Discount, GST and amount due for a POS bill, shared by the sale, its preview
 * and bill edits so all three agree.
 *
 * A discount on the bill lowers the taxable value, so GST is worked out on the
 * discounted amount (each line carries its share of the discount). Taxing the
 * pre-discount subtotal overcharged exclusive-GST bills (₹100 at 18% less ₹10
 * came to ₹108 instead of ₹106.20) and overstated GST on inclusive ones.
 *
 * Tax source, first match wins:
 *  - `taxTotal`: the rupee amount the cashier settled on (already after discount);
 *    null/undefined means "not given", 0 means no tax;
 *  - `taxPercent` > 0: one rate for the whole bill;
 *  - otherwise each line's own `gstPercent`.
 *
 * Inclusive prices already contain GST, so the amount due is the discounted
 * subtotal and tax is the part of it that is GST; exclusive adds tax on top.
 */
export function computePosTotals({ items = [], subtotal, discount = 0, isTaxInclusive = true, taxPercent, taxTotal }) {
  const gross = roundCurrency(subtotal ?? items.reduce((s, i) => s + i.price * i.quantity, 0));
  const discountTotal = Math.min(roundCurrency(Math.max(0, Number(discount) || 0)), gross);
  const taxable = roundCurrency(gross - discountTotal);
  const share = gross > 0 ? taxable / gross : 0;

  const taxOn = (amount, rate) => {
    if (!(rate > 0)) return 0;
    return isTaxInclusive ? amount - (amount * 100) / (100 + rate) : (amount * rate) / 100;
  };

  let tax;
  if (taxTotal != null && taxTotal !== "") {
    tax = roundCurrency(Math.max(0, Number(taxTotal) || 0));
    if (isTaxInclusive) tax = Math.min(tax, taxable);
  } else if (Number(taxPercent) > 0) {
    tax = roundCurrency(taxOn(taxable, Number(taxPercent)));
  } else {
    tax = roundCurrency(
      items.reduce((sum, i) => sum + taxOn(i.price * i.quantity * share, Number(i.gstPercent || 0)), 0),
    );
  }

  return {
    subtotal: gross,
    discountTotal,
    taxTotal: tax,
    grandTotal: isTaxInclusive ? taxable : roundCurrency(taxable + tax),
  };
}

export default { computePosTotals };
