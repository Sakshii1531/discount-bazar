import Product from "../models/product.js";
import StockHistory from "../models/stockHistory.js";
import { createLowStockAlertCandidate } from "./lowStockAlertService.js";
import { restoreReservedInventory } from "./cancellation/cancellationInventoryService.js";

const ONLINE_RESERVATION_MS = () =>
  parseInt(process.env.ONLINE_STOCK_RESERVATION_MS || "900000", 10);

export function computeStockReservationWindow(paymentMode) {
  const now = new Date();
  if (String(paymentMode || "").toUpperCase() !== "ONLINE") {
    return {
      status: "COMMITTED",
      reservedAt: now,
      expiresAt: null,
      releasedAt: null,
    };
  }
  return {
    status: "RESERVED",
    reservedAt: now,
    expiresAt: new Date(now.getTime() + ONLINE_RESERVATION_MS()),
    releasedAt: null,
  };
}

export async function reserveStockForItems({
  items,
  sellerId,
  orderId,
  session,
  paymentMode = "COD",
}) {
  const stockType = String(paymentMode || "").toUpperCase() === "ONLINE" ? "Reservation" : "Sale";
  const lowStockAlerts = [];
  const stockUpdates = [];

  for (const item of items) {
    const variantSku = String(item.variantSku || "").trim();
    // Normalize SKU to uppercase for case-insensitive matching
    const normalizedSku = variantSku.toUpperCase();

    let updated;
    if (variantSku) {
      // First: try exact case-insensitive match with variant stock check
      // Variant must have sufficient stock for the quantity requested
      updated = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          variants: {
            $elemMatch: {
              sku: { $regex: new RegExp(`^${variantSku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
              stock: { $gte: item.quantity },
            },
          },
        },
        {
          $inc: {
            stock: -item.quantity,
            "variants.$.stock": -item.quantity,
          },
        },
        { new: true, session },
      );

      // Fallback: variant exists but its stock field is not tracked separately
      // (variant.stock is null/undefined). Only deduct from master stock.
      if (!updated) {
        updated = await Product.findOneAndUpdate(
          {
            _id: item.productId,
            stock: { $gte: item.quantity },
            variants: {
              $elemMatch: {
                sku: { $regex: new RegExp(`^${variantSku.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") },
                $or: [
                  { stock: { $exists: false } },
                  { stock: null },
                ],
              },
            },
          },
          {
            $inc: { stock: -item.quantity },
          },
          { new: true, session },
        );
      }
    } else {
      updated = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          stock: { $gte: item.quantity },
        },
        {
          $inc: { stock: -item.quantity },
        },
        { new: true, session },
      );
    }

    if (!updated) {
      const err = new Error(`${item.productName || "Item"}${variantSku ? ` (${variantSku})` : ""} is out of stock or has insufficient quantity`);
      err.statusCode = 409;
      throw err;
    }

    // Self-heal: ensure master stock is accurately reconciled to sum of variant stocks
    if (Array.isArray(updated.variants) && updated.variants.length > 0) {
      const variantStockSum = updated.variants.reduce(
        (sum, v) => sum + Math.max(0, Number(v.stock) || 0),
        0
      );
      if (updated.stock !== variantStockSum) {
        updated.stock = variantStockSum;
        await Product.updateOne({ _id: updated._id }, { $set: { stock: variantStockSum } }, { session });
      }
    }

    await StockHistory.create(
      [
        {
          product: item.productId,
          seller: sellerId,
          type: stockType,
          quantity: -item.quantity,
          note: `Order #${orderId} ${stockType.toLowerCase()}${variantSku ? ` [variant: ${variantSku}]` : ""}`,
        },
      ],
      { session },
    );

    // Collected, not emitted here: this write is still inside the caller's
    // transaction and could yet be rolled back by a later step. Callers
    // emit these via emitProductStockUpdate() only after their transaction
    // commits (mirrors the lowStockAlerts pattern below).
    stockUpdates.push({
      productId: updated._id,
      sellerId,
      stock: updated.stock,
      variantSku: variantSku || null,
    });

    const previousStock = Number(updated.stock || 0) + Number(item.quantity || 0);
    let previousVariantStock = null;
    let currentVariantStock = null;

    if (variantSku) {
      const matchedVariant = Array.isArray(updated.variants)
        ? updated.variants.find(
          (variant) => String(variant?.sku || "").trim() === variantSku,
        )
        : null;
      if (matchedVariant) {
        currentVariantStock = Number(matchedVariant.stock || 0);
        previousVariantStock = currentVariantStock + Number(item.quantity || 0);
      }
    }

    const alertCandidate = createLowStockAlertCandidate({
      product: updated,
      previousStock,
      currentStock: Number(updated.stock || 0),
      variantSku,
      previousVariantStock,
      currentVariantStock,
    });

    if (alertCandidate) {
      lowStockAlerts.push(alertCandidate);
    }
  }

  return { lowStockAlerts, stockUpdates };
}

/**
 * Give back everything the order took. Exactly once: the release is claimed
 * on the order atomically, so two cancellations racing each other (customer
 * cancel vs seller timeout, a retried job) cannot both restock. Variants
 * without their own stock counter only get master stock back.
 */
export async function releaseReservedStockForOrder(order, { session = null, reason = "Reservation released" } = {}) {
  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return false;
  }
  if ((order.stockReservation || {}).status === "RELEASED") {
    return false;
  }

  const { restored } = await restoreReservedInventory(order, { session, reason });
  if (!restored) {
    return false;
  }

  order.stockReservation = {
    ...(order.stockReservation || {}),
    status: "RELEASED",
    releasedAt: new Date(),
  };

  return true;
}
