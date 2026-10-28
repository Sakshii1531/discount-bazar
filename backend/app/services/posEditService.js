import mongoose from "mongoose";
import Order from "../models/order.js";
import Product from "../models/product.js";
import PosReturn from "../models/posReturn.js";
import PosCustomer from "../models/posCustomer.js";
import PartyLedgerEntry from "../models/partyLedgerEntry.js";
import { applyStock } from "./businessService.js";
import { assertDayOpen } from "./businessTime.js";
import { freezeFinancialSnapshot } from "./finance/orderFinanceService.js";
import { emitProductStockUpdate } from "./orderSocketEmitter.js";
import { roundCurrency, purchaseBaseCost, lineMrp } from "../utils/money.js";
import { resolvePosPayment } from "./posPayment.js";
import { resolveBillCustomerDetails, resolvePosVariant } from "./posSaleService.js";

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const keyOf = (product, variant) => `${product}::${variant || ""}`;

/**
 * Audited edit of a posted POS bill (owner-only route). Never mutates silently:
 *  - only same-business-day (open day) bills, and only bills with no returns
 *  - stock moves by the per-line difference only (guarded against going negative)
 *  - the customer ledger for the bill is rewritten to match the new total/payment
 *  - a full before/after snapshot + reason is appended to `order.posEdits`
 * Cash/UPI/card totals in the day book are computed from the order itself, so
 * they follow automatically.
 */
export async function editPosSale({ sellerId, orderId, payload, actorId }) {
  const session = await mongoose.startSession();
  const emits = [];
  try {
    let result;
    await session.withTransaction(async () => {
      const order = await Order.findOne({
        orderId: String(orderId).trim().toUpperCase(),
        seller: sellerId,
        orderSource: "POS",
      }).session(session);
      if (!order) throw err(404, "POS bill not found");
      await assertDayOpen(sellerId, order.createdAt);
      if (await PosReturn.exists({ seller: sellerId, order: order._id }).session(session)) {
        throw err(409, "This bill already has returns; it can no longer be edited");
      }

      const oldItems = order.items.map((i) => i.toObject());
      const before = {
        items: oldItems.map((i) => ({ product: i.product, variantSlot: i.variantSlot, quantity: i.quantity, price: i.price })),
        total: order.paymentBreakdown?.grandTotal,
        discount: order.paymentBreakdown?.discountTotal,
        method: order.posPaymentMethod,
        paid: order.posAmountPaid,
        payments: order.posPayments,
      };

      // --- new lines (keep cost/GST snapshots for unchanged lines) ---
      const oldByKey = new Map(oldItems.map((i) => [keyOf(i.product, i.variantSlot), i]));
      const productIds = payload.items.map((i) => i.productId);
      const products = await Product.find({ _id: { $in: productIds }, sellerId })
        .select("name mainImage price mrp purchaseCost gstPercent purchaseGstType variants.sku variants.price variants.purchaseCost")
        .session(session).lean();
      const pMap = new Map(products.map((p) => [String(p._id), p]));

      const merged = new Map();
      const newItems = payload.items.map((line) => {
        const p = pMap.get(String(line.productId));
        if (!p) throw err(404, "One or more items do not belong to your catalog");
        // A line already on the bill keeps its saved variant key so its stock
        // delta nets out; a new line must name a real variant.
        const rawKey = keyOf(line.productId, line.variantSku);
        const variantSku = oldByKey.has(rawKey)
          ? line.variantSku || ""
          : resolvePosVariant(p, line.variantSku)?.sku || "";
        const k = keyOf(line.productId, variantSku);
        const prev = oldByKey.get(k);
        merged.set(k, (merged.get(k) || 0) + line.quantity);
        const variant = variantSku ? (p.variants || []).find((v) => v.sku === variantSku) : null;
        return {
          product: line.productId,
          name: prev?.name || p.name,
          quantity: line.quantity,
          price: line.price,
          mrp: lineMrp(p, variantSku, line.price),
          variantSlot: variantSku || undefined,
          image: prev?.image ?? (p.mainImage || ""),
          costPrice: prev?.costPrice ?? purchaseBaseCost(variant?.purchaseCost || p.purchaseCost, p.gstPercent, p.purchaseGstType),
          gstPercent: prev?.gstPercent ?? Number(p.gstPercent || 0),
          returnPolicy: prev?.returnPolicy || { isReturnable: false, returnWindowDays: 0, returnReasons: [] },
          returnStatus: "none",
        };
      });

      // --- stock delta: release first, then take (so guards fail before any release is wasted) ---
      const oldQ = new Map();
      oldItems.forEach((i) => oldQ.set(keyOf(i.product, i.variantSlot), (oldQ.get(keyOf(i.product, i.variantSlot)) || 0) + i.quantity));
      const args = { sellerId, type: "Correction", note: `POS bill ${order.orderId} edited`, session, emits };
      const deltas = [...new Set([...oldQ.keys(), ...merged.keys()])]
        .map((k) => [k, (oldQ.get(k) || 0) - (merged.get(k) || 0)]) // +ve = give back to stock
        .filter(([, d]) => d !== 0);
      for (const [k, d] of deltas.filter(([, d]) => d < 0)) {
        const [productId, variantSku] = k.split("::");
        await applyStock({ ...args, productId, variantSku, delta: d });
      }
      for (const [k, d] of deltas.filter(([, d]) => d > 0)) {
        const [productId, variantSku] = k.split("::");
        await applyStock({ ...args, productId, variantSku, delta: d });
      }

      // --- totals ---
      const pb = order.paymentBreakdown?.toObject ? order.paymentBreakdown.toObject() : { ...order.paymentBreakdown };
      const isTaxInclusive = payload.isTaxInclusive !== undefined ? payload.isTaxInclusive : (order.isTaxInclusive !== false);
      const subtotal = roundCurrency(newItems.reduce((s, i) => s + i.price * i.quantity, 0));
      const discount = Math.min(roundCurrency(payload.discount ?? pb.discountTotal ?? 0), subtotal);
      
      let computedTax = 0;
      if (isTaxInclusive) {
        if (payload.taxTotal != null) {
          computedTax = roundCurrency(payload.taxTotal);
        } else if (payload.taxPercent != null) {
          const base = (subtotal * 100) / (100 + payload.taxPercent);
          computedTax = roundCurrency(subtotal - base);
        } else {
          computedTax = roundCurrency(
            newItems.reduce((sum, item) => {
              const rate = Number(item.gstPercent || 0);
              if (rate <= 0) return sum;
              const lineTotal = item.price * item.quantity;
              const base = (lineTotal * 100) / (100 + rate);
              return sum + (lineTotal - base);
            }, 0),
          );
        }
      } else {
        // No tax sent: keep the bill's effective tax rate on the new subtotal
        // (re-using the old rupee amount would leave tax stale after a qty change).
        const oldSubtotal = Number(pb.productSubtotal || 0);
        computedTax = payload.taxTotal != null
          ? roundCurrency(payload.taxTotal)
          : payload.taxPercent != null
            ? roundCurrency((subtotal * payload.taxPercent) / 100)
            : oldSubtotal > 0
              ? roundCurrency(((pb.taxTotal || 0) * subtotal) / oldSubtotal)
              : roundCurrency(pb.taxTotal || 0);
      }

      const grand = isTaxInclusive
        ? roundCurrency(Math.max(0, subtotal - discount))
        : roundCurrency(Math.max(0, subtotal + computedTax - discount));
      const oldGrand = pb.grandTotal || 0;
      const payoutRatio = oldGrand > 0 ? (pb.sellerPayoutTotal || 0) / oldGrand : 1;

      const method = payload.posPaymentMethod || order.posPaymentMethod;
      const isCredit = method === "CREDIT";
      // posCustomerId: omitted → keep the linked customer; "" → back to walk-in.
      const customerId = payload.posCustomerId !== undefined ? payload.posCustomerId || undefined : order.posCustomer;
      if (isCredit && !customerId) throw err(400, "Select a customer for credit (udhaar) sales");
      // Any linked customer (credit or not) must be one of this seller's own.
      if (customerId && !(await PosCustomer.exists({ _id: customerId, seller: sellerId }).session(session))) {
        throw err(404, "Customer not found");
      }
      const sameMethod = method === order.posPaymentMethod;
      const oldTendered = order.posCashTendered;
      const pay = resolvePosPayment({
        method,
        grandTotal: grand,
        amountPaid: payload.amountPaid ?? order.posAmountPaid ?? 0,
        payments: payload.posPayments ?? (sameMethod ? order.posPayments : undefined),
        // Cash handed over: as re-entered at checkout, else the recorded amount while it still covers the new total.
        cashTendered:
          payload.cashTendered != null
            ? payload.cashTendered
            : sameMethod && oldTendered != null && oldTendered >= grand
              ? oldTendered
              : undefined,
      });
      const paid = pay.posAmountPaid;

      order.items = newItems;
      order.posPaymentMethod = method;
      order.posAmountPaid = paid;
      order.posPayments = pay.posPayments;
      order.posCashTendered = pay.posCashTendered;
      order.paymentStatus = pay.paymentStatus;
      order.payment = { ...(order.payment?.toObject ? order.payment.toObject() : order.payment || {}), ...pay.payment };
      if (payload.walkInCustomer !== undefined) {
        // Name/phone re-entered at checkout; blanks fall back to the linked customer.
        const linked = customerId
          ? await PosCustomer.findOne({ _id: customerId, seller: sellerId }).select("name phone").session(session).lean()
          : null;
        order.walkInCustomer = resolveBillCustomerDetails(payload.walkInCustomer, linked);
      } else if (String(customerId || "") !== String(order.posCustomer || "")) {
        // Re-linking the bill: refresh the printed name/phone unless the
        // cashier typed their own (i.e. it wasn't blank or the old customer's).
        const [prevCustomer, nextCustomer] = await Promise.all(
          [order.posCustomer, customerId].map((id) =>
            id ? PosCustomer.findOne({ _id: id, seller: sellerId }).select("name phone").session(session).lean() : null,
          ),
        );
        const current = order.walkInCustomer || {};
        if (!current.name || (prevCustomer && current.name === prevCustomer.name)) {
          order.walkInCustomer = resolveBillCustomerDetails(null, nextCustomer);
        }
      }
      order.posCustomer = customerId || undefined;
      order.isTaxInclusive = isTaxInclusive;
      freezeFinancialSnapshot(order, {
        ...pb,
        productSubtotal: subtotal,
        discountTotal: discount,
        taxTotal: computedTax,
        isTaxInclusive,
        grandTotal: grand,
        sellerPayoutTotal: roundCurrency(grand * payoutRatio),
        codCollectedAmount: pay.codCollectedAmount,
        lineItems: newItems.map((i) => ({ product: i.product, quantity: i.quantity, price: i.price, subtotal: roundCurrency(i.price * i.quantity) })),
      });

      // --- ledger: rewrite this bill's customer entries ---
      await PartyLedgerEntry.deleteMany({ seller: sellerId, refModel: "Order", refId: order._id }, { session });
      if (isCredit) {
        const base = { seller: sellerId, partyType: "CUSTOMER", party: customerId, refModel: "Order", refId: order._id, refNo: order.orderId, date: order.createdAt };
        await PartyLedgerEntry.create(
          [
            { ...base, kind: "SALE", effect: 1, amount: grand, note: "Credit sale (edited)" },
            ...(paid > 0 ? [{ ...base, kind: "PAYMENT", effect: -1, amount: paid, method: "CASH", note: "Paid at billing" }] : []),
          ],
          { session, ordered: true },
        );
      }

      order.posEdits = [
        ...(order.posEdits || []),
        {
          at: new Date(),
          by: actorId || sellerId,
          reason: (payload.reason && payload.reason.trim()) || "Bill correction",
          before,
          after: {
            items: newItems.map((i) => ({ product: i.product, variantSlot: i.variantSlot, quantity: i.quantity, price: i.price })),
            total: grand, discount, method, paid, payments: pay.posPayments,
          },
        },
      ];
      await order.save({ session });
      result = order.toObject();
    });
    setImmediate(() => emits.forEach((e) => emitProductStockUpdate(e)));
    return { order: result };
  } finally {
    session.endSession();
  }
}
