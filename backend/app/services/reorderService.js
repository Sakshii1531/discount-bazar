import Order from "../models/order.js";
import Product from "../models/product.js";
import Seller from "../models/seller.js";
import Cart from "../models/cart.js";
import { orderMatchQueryFromRouteParam } from "../utils/orderLookup.js";
import {
  getAvailableStock,
  fetchPopulatedCart,
  CUSTOMER_VISIBLE_PRODUCT_MATCH,
} from "../controller/cartController.js";

/**
 * Reorder items from an existing order into the customer's active cart.
 *
 * Non-negotiable business rules:
 * 1. Historical orders are strictly immutable — never mutated.
 * 2. Strict single-seller cart: If the cart has items from another seller and clearExisting is false,
 *    returns HTTP 409 SELLER_CONFLICT.
 * 3. Exact variant matching: If an old item ordered variant 'X', it must match variant 'X' currently.
 *    No silent fallback or variant substitution is ever permitted.
 * 4. Current catalog prices: Current product prices and sale prices apply automatically when loaded into cart.
 * 5. Stock audit: Real-time stock limits quantity to available stock (or reports out-of-stock).
 * 6. Inventory reservation: Stock is NOT reserved here — stock is only reserved during checkout placement.
 */
export async function reorderOrder({
  orderId,
  customerId,
  clearExisting = false,
}) {
  if (!customerId) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }

  const orderKey = orderMatchQueryFromRouteParam(orderId);
  if (!orderKey) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  // Enforce customer ownership: query explicitly scoped to customer
  const order = await Order.findOne({ ...orderKey, customer: customerId }).lean();
  if (!order) {
    const err = new Error("Order not found");
    err.statusCode = 404;
    throw err;
  }

  if (!Array.isArray(order.items) || order.items.length === 0) {
    const err = new Error("Historical order contains no items to reorder");
    err.statusCode = 400;
    throw err;
  }

  // Validate Seller status
  const sellerId = order.seller ? String(order.seller) : null;
  if (!sellerId) {
    const err = new Error("Order has no associated seller");
    err.statusCode = 400;
    throw err;
  }

  const seller = await Seller.findById(sellerId)
    .select("isActive isVerified applicationStatus shopName")
    .lean();

  if (!seller || seller.isActive === false || seller.applicationStatus === "rejected") {
    const err = new Error(
      `The store (${seller?.shopName || "Seller"}) that fulfilled this order is currently unavailable`,
    );
    err.statusCode = 400;
    throw err;
  }

  // Check active Cart & Single-Seller Restriction
  let cart = await Cart.findOne({ customerId });
  if (!cart) {
    cart = new Cart({ customerId, items: [] });
  }

  if (cart.items.length > 0 && !clearExisting) {
    // Derive existing cart seller from its first populated product
    const firstProduct = await Product.findById(cart.items[0].productId)
      .select("sellerId")
      .lean();
    const existingCartSellerId = String(firstProduct?.sellerId || "");

    if (existingCartSellerId && existingCartSellerId !== sellerId) {
      const err = new Error("SELLER_CONFLICT");
      err.statusCode = 409;
      err.details = {
        code: "SELLER_CONFLICT",
        cartSellerId: existingCartSellerId,
        orderSellerId: sellerId,
        orderId: order.orderId || String(order._id),
      };
      throw err;
    }
  }

  // Validate Products & Variants against live catalog
  const productIds = order.items
    .map((item) => item.product)
    .filter(Boolean);

  const activeProducts = await Product.find({
    _id: { $in: productIds },
    sellerId,
    ...CUSTOMER_VISIBLE_PRODUCT_MATCH,
  }).lean();

  const productMap = new Map(
    activeProducts.map((prod) => [String(prod._id), prod]),
  );

  const addedItems = [];
  const adjustedItems = [];
  const unavailableItems = [];
  const eligibleCartLines = [];

  for (const orderItem of order.items) {
    const pIdStr = String(orderItem.product || "");
    const product = productMap.get(pIdStr);
    const itemName = orderItem.name || product?.name || "Item";

    if (!product) {
      unavailableItems.push({
        productId: pIdStr,
        name: itemName,
        reason: "PRODUCT_UNAVAILABLE",
        message: "Product is no longer available from this store",
      });
      continue;
    }

    // Exact variant matching
    const rawVariantSku = String(
      orderItem.variantSlot || orderItem.variantSku || "",
    ).trim();

    let matchedVariant = null;
    if (rawVariantSku) {
      const variants = Array.isArray(product.variants) ? product.variants : [];
      matchedVariant = variants.find(
        (v) =>
          String(v?.sku || "").trim().toLowerCase() === rawVariantSku.toLowerCase() ||
          String(v?.name || "").trim().toLowerCase() === rawVariantSku.toLowerCase(),
      );

      // If the historical item had a variant specified and that variant no longer exists:
      // DO NOT silently substitute another variant. Mark it unavailable.
      if (!matchedVariant) {
        unavailableItems.push({
          productId: pIdStr,
          name: itemName,
          variantSku: rawVariantSku,
          reason: "VARIANT_UNAVAILABLE",
          message: `Selected variant (${rawVariantSku}) is no longer available`,
        });
        continue;
      }
    }

    const effectiveSku = matchedVariant?.sku || rawVariantSku;
    const availableStock = getAvailableStock(product, effectiveSku);

    if (availableStock <= 0) {
      unavailableItems.push({
        productId: pIdStr,
        name: itemName,
        variantSku: effectiveSku,
        reason: "OUT_OF_STOCK",
        message: `${itemName} is currently out of stock`,
      });
      continue;
    }

    const requestedQty = Math.max(1, Number(orderItem.quantity || 1));
    const addedQty = Math.min(requestedQty, availableStock);

    if (addedQty < requestedQty) {
      adjustedItems.push({
        productId: pIdStr,
        name: itemName,
        variantSku: effectiveSku,
        requestedQuantity: requestedQty,
        addedQuantity: addedQty,
        availableStock,
        message: `Only ${addedQty} of ${requestedQty} units available in stock`,
      });
    } else {
      addedItems.push({
        productId: pIdStr,
        name: itemName,
        variantSku: effectiveSku,
        quantity: addedQty,
      });
    }

    eligibleCartLines.push({
      productId: product._id,
      variantSku: effectiveSku,
      quantity: addedQty,
      availableStock,
    });
  }

  // If no items could be reordered, do not touch the cart
  if (eligibleCartLines.length === 0) {
    const populatedCart = await fetchPopulatedCart(cart._id);
    return {
      cart: populatedCart || cart,
      status: "NONE",
      addedCount: 0,
      summary: {
        requestedItemCount: order.items.length,
        addedItemCount: 0,
        addedItems,
        adjustedItems,
        unavailableItems,
      },
      message: "None of the items from this order are currently available to reorder",
    };
  }

  // Mutate Cart
  if (clearExisting) {
    // Overwrite cart completely with reordered eligible items
    cart.items = eligibleCartLines.map((line) => ({
      productId: line.productId,
      variantSku: line.variantSku || "",
      quantity: line.quantity,
    }));
  } else {
    // Merge additively into existing cart (same seller)
    for (const line of eligibleCartLines) {
      const normalizedLineSku = String(line.variantSku || "").trim().toLowerCase();
      const existingIndex = cart.items.findIndex((ci) => {
        const ciProductId = String(ci.productId?._id || ci.productId);
        const ciSku = String(ci.variantSku || "").trim().toLowerCase();
        return ciProductId === String(line.productId) && ciSku === normalizedLineSku;
      });

      if (existingIndex > -1) {
        const currentQty = Number(cart.items[existingIndex].quantity || 0);
        const mergedQty = Math.min(currentQty + line.quantity, line.availableStock);
        cart.items[existingIndex].quantity = mergedQty;
      } else {
        cart.items.push({
          productId: line.productId,
          variantSku: line.variantSku || "",
          quantity: line.quantity,
        });
      }
    }
  }

  cart.markModified("items");
  await cart.save();

  const populatedCart = await fetchPopulatedCart(cart._id);
  const addedCount = addedItems.length + adjustedItems.length;
  const status = (unavailableItems.length > 0 || adjustedItems.length > 0) ? "PARTIAL" : "FULL";

  return {
    cart: populatedCart,
    status,
    addedCount,
    summary: {
      requestedItemCount: order.items.length,
      addedItemCount: addedCount,
      addedItems,
      adjustedItems,
      unavailableItems,
    },
    message: "Items added to cart successfully",
  };
}
