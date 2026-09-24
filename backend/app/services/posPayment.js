import { ORDER_PAYMENT_STATUS } from "../constants/finance.js";
import { roundCurrency } from "../utils/money.js";

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });

/**
 * Resolves how a POS bill was paid into the Order payment fields, shared by
 * posSaleService (new bill) and posEditService (edited bill).
 *
 *  - CASH           → CASH_COLLECTED; optional `cashTendered` (must cover the total) for change due
 *  - CARD/QR/OTHER  → PAID (non-cash, no gateway involved)
 *  - CREDIT (udhaar)→ CASH_COLLECTED only if fully paid up front, else PENDING_CASH_COLLECTION
 *  - SPLIT          → tender lines must add up to the total; CASH_COLLECTED if any cash, else PAID
 *
 * `codCollectedAmount` is the cash actually received at the counter.
 */
export function resolvePosPayment({ method, grandTotal, amountPaid, payments, cashTendered }) {
  const total = roundCurrency(grandTotal || 0);
  const out = {
    posAmountPaid: total,
    posPayments: undefined,
    posCashTendered: undefined,
    paymentStatus: ORDER_PAYMENT_STATUS.CASH_COLLECTED,
    payment: { method: "cash", status: "completed" },
    codCollectedAmount: 0,
  };

  if (method === "CASH") {
    if (cashTendered != null && cashTendered !== "") {
      const tendered = roundCurrency(Number(cashTendered));
      if (tendered < total) throw err(400, `Cash received (₹${tendered}) is less than the bill total (₹${total})`);
      out.posCashTendered = tendered;
    }
    out.codCollectedAmount = total;
    return out;
  }

  if (method === "CREDIT") {
    const upFront = Math.min(roundCurrency(Number(amountPaid || 0)), total);
    out.posAmountPaid = upFront;
    out.codCollectedAmount = upFront;
    if (upFront < total) {
      out.paymentStatus = ORDER_PAYMENT_STATUS.PENDING_CASH_COLLECTION;
      out.payment = { method: "cash", status: "pending" };
    }
    return out;
  }

  if (method === "SPLIT") {
    const lines = (payments || [])
      .map((p) => ({ method: p.method, amount: roundCurrency(Number(p.amount || 0)) }))
      .filter((p) => p.amount > 0);
    if (lines.length === 0) throw err(400, "Enter the split payment amounts");
    const paid = roundCurrency(lines.reduce((s, p) => s + p.amount, 0));
    if (Math.abs(paid - total) > 0.01) {
      throw err(400, `Split payments (₹${paid}) must add up to the bill total (₹${total})`);
    }
    const cash = roundCurrency(lines.filter((p) => p.method === "CASH").reduce((s, p) => s + p.amount, 0));
    out.posPayments = lines;
    out.codCollectedAmount = cash;
    if (cash <= 0) {
      out.paymentStatus = ORDER_PAYMENT_STATUS.PAID;
      out.payment = { method: "online", status: "completed" };
    }
    return out;
  }

  // CARD / QR / OTHER — settled at the counter, not in cash.
  out.paymentStatus = ORDER_PAYMENT_STATUS.PAID;
  out.payment = { method: "online", status: "completed" };
  return out;
}

export default { resolvePosPayment };
