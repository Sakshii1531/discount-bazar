/**
 * Stock restoration for cancelled orders.
 *
 * Stock is deducted (or reserved) at placement from the single inventory
 * shared by online orders and POS billing. A cancellation gives back exactly
 * the quantities this order took, exactly once:
 *
 *  - The order's `stockReservation.status` is flipped to RELEASED with a
 *    conditional update *before* any product is touched, inside the caller's
 *    transaction. A concurrent release (another cancel path, a retry, a
 *    payment-failure handler) loses that update and restores nothing.
 *  - Products are only ever incremented by the order's own quantities, so
 *    units sold at the POS or reserved by other orders in the meantime are
 *    never touched and stock cannot go negative.
 *  - After pickup, nothing goes back until the store has inspected the
 *    returned parcel, and then only the units marked sellable.
 */
import Order from "../../models/order.js";
import Product from "../../models/product.js";
import StockHistory from "../../models/stockHistory.js";
import { escapeRegex } from "../../utils/regex.js";
import { emitProductStockUpdate } from "../orderSocketEmitter.js";

function itemVariantSku(item) {
  return String(item?.variantSku || item?.variantSlot || "").trim();
}

/** Increment one product (and its variant, when tracked) by `quantity`. */
async function incrementProductStock({ productId, variantSku, quantity, session }) {
  const opts = session ? { session, new: true } : { new: true };
  let updated = null;
  if (variantSku) {
    const skuMatch = new RegExp(`^${escapeRegex(variantSku)}$`, "i");
    updated = await Product.findOneAndUpdate(
      {
        _id: productId,
        variants: { $elemMatch: { sku: skuMatch, stock: { $type: "number" } } },
      },
      { $inc: { stock: quantity, "variants.$.stock": quantity } },
      opts,
    );
  }
  if (!updated) {
    // No variant, or a variant without its own stock counter: the master
    // stock is what placement deducted.
    updated = await Product.findOneAndUpdate(
      { _id: productId },
      { $inc: { stock: quantity } },
      opts,
    );
  }
  if (!updated) return null;

  // Keep master stock equal to the sum of variant stocks (same self-heal
  // that placement applies after a deduction).
  if (Array.isArray(updated.variants) && updated.variants.some((v) => typeof v.stock === "number")) {
    const sum = updated.variants.reduce((s, v) => s + Math.max(0, Number(v.stock) || 0), 0);
    if (sum !== updated.stock) {
      await Product.updateOne({ _id: updated._id }, { $set: { stock: sum } }, session ? { session } : {});
      updated.stock = sum;
    }
  }
  return updated;
}

/**
 * Claim the order's reservation for release. Returns false when it was
 * already released (by this or any other path).
 */
async function claimReservationRelease(orderId, session) {
  const res = await Order.updateOne(
    { _id: orderId, "stockReservation.status": { $ne: "RELEASED" } },
    { $set: { "stockReservation.status": "RELEASED", "stockReservation.releasedAt": new Date() } },
    session ? { session } : {},
  );
  return res.modifiedCount === 1;
}

/**
 * Pre-pickup cancellation: return every unit the order took.
 * Must run inside the transaction that commits the cancellation.
 */
export async function restoreReservedInventory(order, { session, reason = "Order cancelled" } = {}) {
  const claimed = await claimReservationRelease(order._id, session);
  if (!claimed) return { restored: false, items: [], stockUpdates: [] };

  const items = [];
  const stockUpdates = [];
  for (const [index, item] of (order.items || []).entries()) {
    const quantity = Number(item.quantity) || 0;
    const variantSku = itemVariantSku(item);
    if (quantity <= 0) continue;
    const updated = await incrementProductStock({
      productId: item.product?._id || item.product,
      variantSku,
      quantity,
      session,
    });
    if (updated) {
      await StockHistory.create(
        [
          {
            product: updated._id,
            seller: order.seller,
            type: "Release",
            quantity,
            note: `Order #${order.orderId} ${reason}${variantSku ? ` [variant: ${variantSku}]` : ""}`,
            order: order._id,
          },
        ],
        session ? { session } : {},
      );
      stockUpdates.push({ productId: updated._id, sellerId: order.seller, stock: updated.stock, variantSku: variantSku || null });
    }
    items.push({
      itemIndex: index,
      product: item.product?._id || item.product,
      name: item.name,
      variantSku: variantSku || null,
      quantity,
      restoredQty: updated ? quantity : 0,
      // A product deleted since placement cannot take stock back.
      missingQty: updated ? 0 : quantity,
    });
  }
  return { restored: true, items, stockUpdates };
}

/**
 * Post-pickup cancellation after the store inspected the returned parcel.
 * `inspection` maps itemIndex → { sellableQty, damagedQty, missingQty, note }.
 * Only sellable units go back on sale; damaged / missing units stay written
 * off (they were already deducted at placement).
 */
export async function restoreInspectedInventory(order, inspection, { session, actorLabel = "store" } = {}) {
  const claimed = await claimReservationRelease(order._id, session);
  if (!claimed) {
    const err = new Error("Stock for this order has already been released");
    err.statusCode = 409;
    throw err;
  }

  const items = [];
  const stockUpdates = [];
  for (const [index, item] of (order.items || []).entries()) {
    const quantity = Number(item.quantity) || 0;
    const entry = inspection[index] || {};
    const sellableQty = Number(entry.sellableQty) || 0;
    const damagedQty = Number(entry.damagedQty) || 0;
    const missingQty = Number(entry.missingQty) || 0;
    const variantSku = itemVariantSku(item);

    let restoredQty = 0;
    if (sellableQty > 0) {
      const updated = await incrementProductStock({
        productId: item.product?._id || item.product,
        variantSku,
        quantity: sellableQty,
        session,
      });
      if (updated) {
        restoredQty = sellableQty;
        await StockHistory.create(
          [
            {
              product: updated._id,
              seller: order.seller,
              type: "SaleReturn",
              quantity: sellableQty,
              note: `Order #${order.orderId} cancelled parcel returned, inspected by ${actorLabel}${variantSku ? ` [variant: ${variantSku}]` : ""}${damagedQty || missingQty ? ` (damaged ${damagedQty}, missing ${missingQty})` : ""}`,
              order: order._id,
            },
          ],
          session ? { session } : {},
        );
        stockUpdates.push({ productId: updated._id, sellerId: order.seller, stock: updated.stock, variantSku: variantSku || null });
      }
    }
    items.push({
      itemIndex: index,
      product: item.product?._id || item.product,
      name: item.name,
      variantSku: variantSku || null,
      quantity,
      restoredQty,
      damagedQty,
      missingQty: missingQty + (sellableQty - restoredQty),
      note: entry.note ? String(entry.note).slice(0, 300) : null,
    });
  }
  return { items, stockUpdates };
}

/**
 * Validate a store inspection against the order lines: every unit must be
 * accounted for as sellable, damaged or missing.
 */
export function normalizeInspection(order, rawItems = []) {
  const byIndex = {};
  for (const raw of Array.isArray(rawItems) ? rawItems : []) {
    const index = Number(raw?.itemIndex);
    if (!Number.isInteger(index) || index < 0 || index >= (order.items || []).length) {
      const err = new Error("Inspection refers to an item that is not in this order");
      err.statusCode = 400;
      throw err;
    }
    const clean = (v) => {
      const n = Number(v ?? 0);
      if (!Number.isInteger(n) || n < 0) {
        const err = new Error("Inspection quantities must be whole numbers of 0 or more");
        err.statusCode = 400;
        throw err;
      }
      return n;
    };
    byIndex[index] = {
      sellableQty: clean(raw.sellableQty),
      damagedQty: clean(raw.damagedQty),
      missingQty: clean(raw.missingQty),
      note: raw.note ? String(raw.note).trim() : null,
    };
  }
  (order.items || []).forEach((item, index) => {
    const entry = byIndex[index];
    const quantity = Number(item.quantity) || 0;
    if (!entry) {
      const err = new Error(`Inspection is missing item "${item.name || index + 1}"`);
      err.statusCode = 400;
      throw err;
    }
    if (entry.sellableQty + entry.damagedQty + entry.missingQty !== quantity) {
      const err = new Error(
        `Sellable, damaged and missing units for "${item.name || index + 1}" must add up to ${quantity}`,
      );
      err.statusCode = 400;
      throw err;
    }
  });
  return byIndex;
}

/** Push live stock deltas to catalogue / seller portal / POS after commit. */
export function broadcastStockUpdates(stockUpdates = []) {
  for (const update of stockUpdates) {
    try {
      emitProductStockUpdate(update);
    } catch {
      /* realtime is best-effort; views refetch on load */
    }
  }
}
