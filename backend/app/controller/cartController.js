import Cart from "../models/cart.js";
import Product from "../models/product.js";
import handleResponse from "../utils/helper.js";
import { getApprovedOrLegacyFilter } from "../services/productModerationService.js";

const CART_POPULATE_FIELDS =
  "name slug price salePrice mainImage stock status headerId categoryId subcategoryId sellerId variants";

export const CUSTOMER_VISIBLE_PRODUCT_MATCH = {
  status: "active",
  ...getApprovedOrLegacyFilter(),
};

function sanitizeCartItems(cart) {
  if (!cart || !Array.isArray(cart.items)) return cart;
  cart.items = cart.items.filter((item) => Boolean(item?.productId));
  return cart;
}

async function getCustomerVisibleProductById(productId) {
  if (!productId) return null;
  return Product.findOne({
    _id: productId,
    ...CUSTOMER_VISIBLE_PRODUCT_MATCH,
  })
    .select("_id sellerId name stock status inStock variants")
    .lean();
}

export function getAvailableStock(product, variantSku = "") {
  if (!product) return 0;
  if (
    product.status === "out_of_stock" ||
    product.status === "OUT_OF_STOCK" ||
    product.inStock === false
  ) {
    return 0;
  }

  const masterStock =
    product.stock !== undefined && product.stock !== null
      ? Math.max(0, Number(product.stock))
      : 999;

  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length > 0 && variantSku) {
    const v = variants.find(
      (item) =>
        String(item?.sku || item?.name || "").trim().toLowerCase() ===
        String(variantSku).trim().toLowerCase()
    );
    if (v) {
      if (
        v.status === "out_of_stock" ||
        v.status === "OUT_OF_STOCK" ||
        v.inStock === false
      ) {
        return 0;
      }
      if (v.stock !== undefined && v.stock !== null) {
        return Math.max(0, Number(v.stock));
      }
      return masterStock;
    }
  }

  return masterStock;
}


export async function fetchPopulatedCart(cartId) {
  const cart = await Cart.findById(cartId)
    .populate({
      path: "items.productId",
      select: CART_POPULATE_FIELDS,
      match: CUSTOMER_VISIBLE_PRODUCT_MATCH,
    })
    .lean();

  return sanitizeCartItems(cart);
}

/* ===============================
   GET CUSTOMER CART
================================ */
export const getCart = async (req, res) => {
  try {
    const customerId = req.user.id;
    let cart = await Cart.findOne({ customerId })
      .populate({
        path: "items.productId",
        select: CART_POPULATE_FIELDS,
        match: CUSTOMER_VISIBLE_PRODUCT_MATCH,
      })
      .lean();

    if (!cart) {
      const newCart = await Cart.create({ customerId, items: [] });
      return handleResponse(res, 200, "Cart fetched successfully", newCart);
    }

    return handleResponse(res, 200, "Cart fetched successfully", sanitizeCartItems(cart));
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   ADD TO CART
================================ */
export const addToCart = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { productId, quantity = 1, variantSku = "" } = req.body;
    const normalizedVariantSku = String(variantSku || "").trim();

    // Validate product is available and get its sellerId
    const customerVisibleProduct = await getCustomerVisibleProductById(productId);
    if (!customerVisibleProduct) {
      return handleResponse(res, 404, "Product is not available for purchase");
    }

    const incomingSellerIdStr = String(customerVisibleProduct.sellerId || "");

    let cart = await Cart.findOne({ customerId });

    if (!cart) {
      cart = new Cart({ customerId, items: [] });
    }

    // ── Single-seller restriction (server-side safety net) ────────────────────
    // Derive the existing cart's seller from the first item's populated product.
    // This guard fires only for direct API calls or race conditions because the
    // frontend already shows the confirmation dialog before reaching this point.
    if (cart.items.length > 0 && incomingSellerIdStr) {
      // Populate just the first item to get its sellerId
      const firstItemProductId = cart.items[0].productId;
      const firstProduct = await Product.findById(firstItemProductId)
        .select("sellerId")
        .lean();
      const existingSellerIdStr = String(firstProduct?.sellerId || "");

      if (existingSellerIdStr && existingSellerIdStr !== incomingSellerIdStr) {
        return handleResponse(
          res,
          409,
          "SELLER_CONFLICT",
          { code: "SELLER_CONFLICT" },
        );
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    const availableStock = getAvailableStock(customerVisibleProduct, normalizedVariantSku);
    if (availableStock <= 0) {
      return handleResponse(res, 400, `${customerVisibleProduct.name || "Item"} is currently out of stock`);
    }

    const itemIndex = cart.items.findIndex(
      (item) =>
        item.productId.toString() === productId &&
        String(item.variantSku || "").trim() === normalizedVariantSku,
    );

    const currentQty = itemIndex > -1 ? cart.items[itemIndex].quantity : 0;
    if (currentQty + quantity > availableStock) {
      return handleResponse(res, 400, `Only ${availableStock} units available in stock`);
    }

    if (itemIndex > -1) {
      cart.items[itemIndex].quantity += quantity;
    } else {
      cart.items.push({ productId, variantSku: normalizedVariantSku, quantity });
    }

    await cart.save();
    const updatedCart = await fetchPopulatedCart(cart._id);

    return handleResponse(res, 200, "Item added to cart", updatedCart);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   REPLACE CART (atomic clear + add — used for seller switch)
================================ */
export const replaceCart = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { productId, quantity = 1, variantSku = "" } = req.body;
    const normalizedVariantSku = String(variantSku || "").trim();

    // Validate the new product exists
    const customerVisibleProduct = await getCustomerVisibleProductById(productId);
    if (!customerVisibleProduct) {
      return handleResponse(res, 404, "Product is not available for purchase");
    }

    const availableStock = getAvailableStock(customerVisibleProduct, normalizedVariantSku);
    if (availableStock <= 0) {
      return handleResponse(res, 400, `${customerVisibleProduct.name || "Item"} is currently out of stock`);
    }
    if (quantity > availableStock) {
      return handleResponse(res, 400, `Only ${availableStock} units available in stock`);
    }

    let cart = await Cart.findOne({ customerId });

    if (!cart) {
      cart = new Cart({ customerId, items: [] });
    }

    // Atomically: clear existing items and add the new product
    cart.items = [{ productId, variantSku: normalizedVariantSku, quantity }];
    cart.markModified("items");
    await cart.save();

    const updatedCart = await fetchPopulatedCart(cart._id);
    return handleResponse(res, 200, "Cart replaced successfully", updatedCart);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};



/* ===============================
   UPDATE QUANTITY
================================ */
export const updateQuantity = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { productId, quantity, variantSku = "" } = req.body;
    const pIdStr = String(productId || "").trim();
    const normalizedVariantSku = String(variantSku || "").trim().toLowerCase();

    let cart = await Cart.findOne({ customerId });

    if (!cart) {
      return handleResponse(res, 404, "Cart not found");
    }

    let itemIndex = cart.items.findIndex((item) => {
      if (!item || !item.productId) return false;
      const itemProductId = String(item.productId._id ? item.productId._id : item.productId).trim();
      const itemSku = String(item.variantSku || "").trim().toLowerCase();
      return itemProductId === pIdStr && itemSku === normalizedVariantSku;
    });

    if (itemIndex === -1) {
      // Fallback: match by productId alone if no variantSku specified or if only one cart line exists for this product
      itemIndex = cart.items.findIndex((item) => {
        if (!item || !item.productId) return false;
        const itemProductId = String(item.productId._id ? item.productId._id : item.productId).trim();
        return itemProductId === pIdStr && (!normalizedVariantSku || String(item.variantSku || "").trim() === "");
      });
    }

    if (itemIndex > -1) {
      if (quantity > 0) {
        const customerVisibleProduct = await getCustomerVisibleProductById(productId);
        if (customerVisibleProduct) {
          const effectiveSku = cart.items[itemIndex].variantSku || variantSku || "";
          const availableStock = getAvailableStock(customerVisibleProduct, effectiveSku);
          if (availableStock <= 0) {
            return handleResponse(res, 400, `${customerVisibleProduct.name || "Item"} is currently out of stock`);
          }
          if (quantity > availableStock) {
            return handleResponse(res, 400, `Only ${availableStock} units available in stock`);
          }
        }
      }

      cart.items[itemIndex].quantity = quantity;
      if (cart.items[itemIndex].quantity <= 0) {
        cart.items.splice(itemIndex, 1);
      }
    } else {
      return handleResponse(res, 404, "Product not in cart");
    }

    cart.markModified("items");
    await cart.save();
    const updatedCart = await fetchPopulatedCart(cart._id);

    return handleResponse(res, 200, "Cart updated successfully", updatedCart);
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   REMOVE FROM CART
================================ */
export const removeFromCart = async (req, res) => {
  try {
    const customerId = req.user.id;
    const { productId } = req.params;
    const pIdStr = String(productId || "").trim();
    const normalizedVariantSku = String(req.query?.variantSku || "").trim().toLowerCase();

    let cart = await Cart.findOne({ customerId });

    if (!cart) {
      return handleResponse(res, 404, "Cart not found");
    }

    console.log("Removing item from cart:", { productId, normalizedVariantSku });
    let removedCount = 0;
    
    // Iterate backwards so splice doesn't affect remaining indices
    for (let i = cart.items.length - 1; i >= 0; i--) {
      const item = cart.items[i];
      let shouldRemove = false;
      
      if (!item || !item.productId) continue;
      const itemProductId = String(item.productId._id ? item.productId._id : item.productId).trim();
      
      if (itemProductId === pIdStr) {
        if (normalizedVariantSku) {
          const itemSku = String(item.variantSku || "").trim().toLowerCase();
          if (itemSku === normalizedVariantSku || itemSku === "") {
            shouldRemove = true;
          }
        } else {
          // If no variantSku is provided, remove all lines for that product
          shouldRemove = true;
        }
      }
      
      if (shouldRemove) {
        cart.items.splice(i, 1);
        removedCount++;
      }
    }
    
    console.log("Items removed:", removedCount);

    cart.markModified("items");
    await cart.save();
    const updatedCart = await fetchPopulatedCart(cart._id);

    return handleResponse(res, 200, "Item removed from cart", updatedCart);
  } catch (error) {
    import('fs').then(fs => fs.writeFileSync('backend_error.log', error.stack || error.message || String(error)));
    console.error("removeFromCart ERROR:", error);
    return handleResponse(res, 500, error.message);
  }
};

/* ===============================
   CLEAR CART
================================ */
export const clearCart = async (req, res) => {
  try {
    const customerId = req.user.id;
    let cart = await Cart.findOne({ customerId });

    if (cart) {
      cart.items = [];
      await cart.save();
    }

    return handleResponse(res, 200, "Cart cleared successfully");
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
