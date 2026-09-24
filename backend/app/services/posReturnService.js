import mongoose from "mongoose";
import Order from "../models/order.js";
import Product from "../models/product.js";
import StockHistory from "../models/stockHistory.js";
import PosReturn from "../models/posReturn.js";
import { emitProductStockUpdate } from "./orderSocketEmitter.js";
import { roundCurrency } from "../utils/money.js";
import { assertDayOpen } from "./businessTime.js";
import PartyLedgerEntry from "../models/partyLedgerEntry.js";

function makeError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function lineKey(productId, variantSlot) {
  return `${String(productId)}::${String(variantSlot || "")}`;
}

async function loadPosOrder({ sellerId, orderId, session = null }) {
  // Public order IDs are always uppercase Crockford base32 (see
  // orderIdService.buildPublicOrderId) — normalize so a cashier typing the
  // receipt ID in lowercase still matches.
  const query = Order.findOne({
    orderId: String(orderId).trim().toUpperCase(),
    seller: sellerId,
    orderSource: "POS",
  });
  if (session) query.session(session);
  const order = await query.lean();
  if (!order) {
    throw makeError(404, "POS order not found");
  }
  return order;
}

async function getAlreadyReturnedMap({ sellerId, orderObjectId, session = null }) {
  const query = PosReturn.find({ seller: sellerId, order: orderObjectId }).select("items");
  if (session) query.session(session);
  const priorReturns = await query.lean();

  const map = new Map();
  for (const ret of priorReturns) {
    for (const item of ret.items || []) {
      const key = lineKey(item.product, item.variantSlot);
      map.set(key, (map.get(key) || 0) + Number(item.quantity || 0));
    }
  }
  return map;
}

/**
 * Share of each rupee of list price the customer actually paid, so a
 * bill-level discount (manual or coupon) is spread across the lines and a
 * return refunds the discounted amount, not the full line price.
 */
function paidRatio(order) {
  const pb = order.paymentBreakdown || {};
  const subtotal = Number(
    pb.productSubtotal ??
      (order.items || []).reduce((s, i) => s + Number(i.price || 0) * Number(i.quantity || 0), 0),
  );
  const grand = Number(pb.grandTotal ?? subtotal);
  return subtotal > 0 ? Math.min(Math.max(grand / subtotal, 0), 1) : 1;
}

/**
 * Fetches a seller's own POS order enriched with per-line returnable
 * quantities, for the return-lookup screen. Read-only, no session needed.
 */
export async function getPosOrderForReturn({ sellerId, orderId }) {
  const order = await loadPosOrder({ sellerId, orderId });
  const alreadyReturned = await getAlreadyReturnedMap({
    sellerId,
    orderObjectId: order._id,
  });

  const ratio = paidRatio(order);
  const items = (order.items || []).map((item) => {
    const key = lineKey(item.product, item.variantSlot);
    const returnedQuantity = alreadyReturned.get(key) || 0;
    return {
      product: item.product,
      name: item.name,
      variantSlot: item.variantSlot || "",
      price: item.price,
      // Per-unit refund after the bill discount is shared across lines (rounded to nearest rupee).
      refundUnitPrice: Math.round(Number(item.price || 0) * ratio),
      quantity: item.quantity,
      returnedQuantity,
      returnableQuantity: Math.max(0, Number(item.quantity || 0) - returnedQuantity),
    };
  });

  return { order: { ...order, items: undefined }, items };
}

export async function listPosReturns({ sellerId, page = 1, limit = 25 }) {
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    PosReturn.find({ seller: sellerId }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    PosReturn.countDocuments({ seller: sellerId }),
  ]);
  return { items, page, limit, total, totalPages: Math.ceil(total / limit) || 1 };
}

/**
 * Processes a walk-in return against a previously placed POS order.
 * `items`: [{ productId, variantSlot, quantity, condition: "good"|"damaged" }]
 *
 * Only "good" condition lines increment Product.stock (mirrors the
 * $inc + StockHistory pattern in stockService.releaseReservedStockForOrder);
 * "damaged" lines are recorded for audit but never restocked, so the item
 * can't reappear on the live storefront. `refundMethod` records how the
 * cashier actually handed the money back — independent of the original
 * `posPaymentMethod` since a card sale can still be refunded in cash, etc.
 */
export async function createPosReturn({ sellerId, orderId, items, refundMethod, reason, notes }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw makeError(400, "At least one return line is required");
  }

  const session = await mongoose.startSession();
  try {
    let created;
    let pendingStockUpdates = [];
    await assertDayOpen(sellerId);
    await session.withTransaction(
      async () => {
        const order = await loadPosOrder({ sellerId, orderId, session });
        const alreadyReturned = await getAlreadyReturnedMap({
          sellerId,
          orderObjectId: order._id,
          session,
        });

        const orderLineByKey = new Map(
          (order.items || []).map((item) => [lineKey(item.product, item.variantSlot), item]),
        );

        const stockUpdates = [];
        let refundTotal = 0;
        const ratio = paidRatio(order);
        const billTotal = roundCurrency(Number(order.paymentBreakdown?.grandTotal ?? 0));
        const priorRefunds = await PosReturn.find({ seller: sellerId, order: order._id })
          .select("refundTotal")
          .session(session)
          .lean();
        const alreadyRefunded = roundCurrency(priorRefunds.reduce((s, r) => s + Number(r.refundTotal || 0), 0));

        const returnItems = [];
        for (const requested of items) {
          const quantity = Math.floor(Number(requested.quantity || 0));
          const condition = String(requested.condition || "").toLowerCase();
          if (quantity <= 0) {
            throw makeError(400, "Return quantity must be at least 1");
          }
          if (condition !== "good" && condition !== "damaged") {
            throw makeError(400, "Condition must be 'good' or 'damaged'");
          }

          const variantSlot = String(requested.variantSlot || "").trim();
          const key = lineKey(requested.productId, variantSlot);
          const orderLine = orderLineByKey.get(key);
          if (!orderLine) {
            throw makeError(400, "One or more return items were not part of this order");
          }

          const returnedSoFar = alreadyReturned.get(key) || 0;
          const returnable = Number(orderLine.quantity || 0) - returnedSoFar;
          if (quantity > returnable) {
            throw makeError(
              400,
              `Cannot return ${quantity} x ${orderLine.name || "item"} — only ${Math.max(returnable, 0)} left to return`,
            );
          }
          // Prevent double-counting within the same request payload.
          alreadyReturned.set(key, returnedSoFar + quantity);

          const unitRefund = Math.round(Number(orderLine.price || 0) * ratio);
          const refundAmount = unitRefund * quantity;
          refundTotal = refundTotal + refundAmount;

          let restocked = false;
          if (condition === "good") {
            let updated;
            if (variantSlot) {
              updated = await Product.findOneAndUpdate(
                { _id: orderLine.product, "variants.sku": variantSlot },
                { $inc: { stock: quantity, "variants.$.stock": quantity } },
                { new: true, session },
              );
            }
            if (!updated) {
              updated = await Product.findOneAndUpdate(
                { _id: orderLine.product },
                { $inc: { stock: quantity } },
                { new: true, session },
              );
            }
            if (updated) {
              restocked = true;
              await StockHistory.create(
                [
                  {
                    product: orderLine.product,
                    seller: sellerId,
                    type: "Restock",
                    quantity,
                    note: `POS return for order #${order.orderId}${variantSlot ? ` [variant: ${variantSlot}]` : ""}`,
                    order: order._id,
                  },
                ],
                { session },
              );
              stockUpdates.push({
                productId: updated._id,
                sellerId,
                stock: updated.stock,
                variantSku: variantSlot || null,
              });
            }
          }

          returnItems.push({
            product: orderLine.product,
            productName: orderLine.name,
            variantSlot,
            quantity,
            unitPrice: Number(orderLine.price || 0),
            refundAmount,
            condition,
            restocked,
          });
        }

        // Rounding across partial returns must never refund more than the bill collected.
        const maxRefundable = Math.max(Math.round(billTotal - alreadyRefunded), 0);
        if (refundTotal > maxRefundable && returnItems.length > 0) {
          const excess = refundTotal - maxRefundable;
          const last = returnItems[returnItems.length - 1];
          last.refundAmount = Math.max(last.refundAmount - excess, 0);
          refundTotal = maxRefundable;
        }

        const docs = await PosReturn.create(
          [
            {
              order: order._id,
              orderId: order.orderId,
              seller: sellerId,
              items: returnItems,
              refundMethod,
              refundTotal,
              reason: reason || "",
              notes: notes || "",
            },
          ],
          { session },
        );
        created = docs[0];

        // Credit-adjusted return: reduce what the customer owes (udhaar ledger).
        if (refundMethod === "CREDIT") {
          if (!order.posCustomer) {
            throw makeError(400, "This bill has no ledger customer to adjust credit against");
          }
          await PartyLedgerEntry.create(
            [
              {
                seller: sellerId,
                partyType: "CUSTOMER",
                party: order.posCustomer,
                kind: "SALE_RETURN",
                effect: -1,
                amount: refundTotal,
                refModel: "PosReturn",
                refId: created._id,
                refNo: order.orderId,
                note: "Sale return adjusted to credit",
              },
            ],
            { session },
          );
        }
        pendingStockUpdates = stockUpdates;
      },
      {
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
      },
    );

    // Post-commit, fire-and-forget — same pattern as posSaleService.
    pendingStockUpdates.forEach((update) => emitProductStockUpdate(update));

    return created;
  } finally {
    session.endSession();
  }
}

export default { getPosOrderForReturn, listPosReturns, createPosReturn };
