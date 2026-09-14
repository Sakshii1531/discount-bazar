import React, { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { customerApi } from "../services/customerApi";
import { useAuth } from "@core/context/AuthContext";
import { getJSON, setJSON, remove as removeStorage, STORAGE_KEYS } from "@core/utils/storage";

const defaultCartContext = {
  cart: [],
  addToCart: () => {},
  cartTotal: 0,
  cartCount: 0,
  updateQuantity: () => {},
  removeFromCart: () => {},
  clearCart: () => {},
  loading: false,
  isItemOutOfStock: () => false,
  // Seller conflict
  showSellerConflict: false,
  isReplacingCart: false,
  cancelSellerSwitch: () => {},
  confirmSellerSwitch: () => {},
  cartSellerId: null,
  pendingReorder: null,
  reorderOrder: async () => {},
};

const CartContext = createContext(defaultCartContext);

const loadGuestCart = () => {
  const parsed = getJSON(STORAGE_KEYS.CART, []);
  if (!Array.isArray(parsed)) {
    removeStorage(STORAGE_KEYS.CART);
    return [];
  }
  return parsed;
};

const extractSellerId = (item) => {
  if (!item) return "";
  const raw = item.sellerId ?? item.seller;
  if (!raw) return "";
  if (typeof raw === "object" && raw._id) return String(raw._id).trim();
  return String(raw).trim();
};

/**
 * Validates a cart array: returns the cart if all items share the same seller,
 * otherwise returns an empty array (and fires the onInvalid callback if given).
 *
 * Used on guest-cart restore and on auth cart fetch to guard against stale
 * multi-seller carts from before this feature was released.
 */
function validateSingleSellerCart(cartItems, onInvalid) {
  if (!Array.isArray(cartItems) || cartItems.length <= 1) return cartItems;
  const sellers = new Set(
    cartItems.map((item) => extractSellerId(item)).filter(Boolean),
  );
  if (sellers.size > 1) {
    if (typeof onInvalid === "function") onInvalid();
    return [];
  }
  return cartItems;
}

export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) {
    return defaultCartContext;
  }
  return context;
};

export const CartProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [cart, setCart] = useState(() => loadGuestCart());

  const [loading, setLoading] = useState(false);
  const pendingRequestsRef = useRef(0);
  const lsDebounceRef = useRef(null);

  // ── Seller conflict state ─────────────────────────────────────────────────
  const [showSellerConflict, setShowSellerConflict] = useState(false);
  const [pendingProduct, setPendingProduct] = useState(null);
  const [pendingReorder, setPendingReorder] = useState(null);
  const [isReplacingCart, setIsReplacingCart] = useState(false);
  // Ref guard so rapid clicks can't trigger multiple confirmations
  const isProcessingReplaceRef = useRef(false);
  // ─────────────────────────────────────────────────────────────────────────

  // Derive the current cart's sellerId from the first item
  const cartSellerId = useMemo(() => {
    if (!cart.length) return null;
    return extractSellerId(cart[0]) || null;
  }, [cart]);

  // Clear cart locally when user logs out is handled by the useEffect dependency on isAuthenticated
  const normalizeBackendCart = (items) => {
    if (!items) return [];
    return items.map((item) => {
      const product = item.productId;
      const variantKey = String(item.variantSku || "").trim();
      const { price, salePrice, variantName } = resolveVariantPricing(product, variantKey);
      return {
        ...product,
        id: product?._id, // Normalize ID
        quantity: item.quantity,
        variantSku: variantKey,
        variantName,
        price,
        salePrice,
        image: product?.mainImage, // Handle mapping for frontend
      };
    });
  };

  const resolveVariantPricing = (product, variantSku = "") => {
    const normalizedKey = String(variantSku || "").trim();
    if (!normalizedKey) {
      return {
        price: Number(product?.price || 0),
        salePrice: Number(product?.salePrice || 0),
        variantName: "",
      };
    }

    const variants = Array.isArray(product?.variants) ? product.variants : [];
    const hit = variants.find((v) => {
      const sku = String(v?.sku || "").trim();
      const name = String(v?.name || "").trim();
      return (sku && sku === normalizedKey) || (!sku && name === normalizedKey) || name === normalizedKey;
    });
    return {
      price: Number(hit?.price || product?.price || 0),
      salePrice: Number(hit?.salePrice || 0),
      variantName: String(hit?.name || "").trim(),
    };
  };

  const syncCart = (backendItems) => {
    // Only update state from backend if no more pending optimistic updates
    if (pendingRequestsRef.current === 0) {
      setCart(normalizeBackendCart(backendItems));
    }
  };

  const fetchCart = async () => {
    if (isAuthenticated) {
      setLoading(true);
      try {
        const response = await customerApi.getCart();
        const normalized = normalizeBackendCart(response.data.result.items);
        // Guard: if the restored cart somehow has multiple sellers, clear it
        const validated = validateSingleSellerCart(normalized, () => {
          customerApi.clearCart().catch(() => {});
          // Toast is shown via a queued state update — import dynamically to
          // avoid a hard dep cycle (CartContext → Toast → CartContext)
          import("@shared/components/ui/Toast").then(({ toast }) => {
            toast?.("Your previous cart has been cleared due to a store change.", "info");
          }).catch(() => {});
        });
        setCart(validated);
      } catch (error) {
        console.error("Failed to fetch cart from backend", error);
      } finally {
        setLoading(false);
      }
    }
  };

  // Fetch cart from backend on mount or authentication change
  useEffect(() => {
    if (isAuthenticated) {
      // Cancel any pending guest-mode write that could otherwise overwrite
      // the authenticated state with stale guest data after login.
      clearTimeout(lsDebounceRef.current);
      // The legacy guest cart is no longer authoritative for this user; drop
      // it so a future logout doesn't resurface another account's items.
      removeStorage(STORAGE_KEYS.CART);
      fetchCart();
    } else {
      // Guard: validate guest cart for multi-seller contamination on restore
      const guestCart = loadGuestCart();
      const validated = validateSingleSellerCart(guestCart, () => {
        removeStorage(STORAGE_KEYS.CART);
      });
      setCart(validated);
    }
  }, [isAuthenticated]);

  // Save local cart to localStorage (fallback/guest mode) — debounced to 300 ms
  useEffect(() => {
    if (isAuthenticated) return;           // backend is source of truth

    clearTimeout(lsDebounceRef.current);
    lsDebounceRef.current = setTimeout(() => {
      setJSON(STORAGE_KEYS.CART, cart);
    }, 300);

    return () => {
      if (isAuthenticated) return;
      // Flush on unmount — no data loss
      clearTimeout(lsDebounceRef.current);
      setJSON(STORAGE_KEYS.CART, cart);
    };
  }, [cart, isAuthenticated]);

  const getItemStock = (prod, varSku = "") => {
    if (!prod) return 0;
    if (
      prod.status === "out_of_stock" ||
      prod.status === "OUT_OF_STOCK" ||
      prod.inStock === false ||
      prod.isOutOfStock === true
    ) {
      return 0;
    }

    const masterStock =
      prod.stock !== undefined && prod.stock !== null
        ? Math.max(0, Number(prod.stock))
        : 999;

    const variants = Array.isArray(prod?.variants) ? prod.variants : [];
    if (variants.length > 0 && varSku) {
      const hit = variants.find(
        (v) =>
          String(v?.sku || v?.name || "").trim().toLowerCase() ===
          String(varSku).trim().toLowerCase(),
      );
      if (hit) {
        if (
          hit.status === "out_of_stock" ||
          hit.status === "OUT_OF_STOCK" ||
          hit.inStock === false
        ) {
          return 0;
        }
        if (hit.stock !== undefined && hit.stock !== null) {
          return Math.max(0, Number(hit.stock));
        }
        return masterStock;
      }
    }

    return masterStock;
  };

  const isItemOutOfStock = (prod, varSku = "") => {
    if (!prod) return false;
    return getItemStock(prod, varSku) <= 0;
  };

  /**
   * Core add-to-cart function.
   *
   * Single-seller enforcement:
   *   • Empty cart → add normally
   *   • Same seller as cart → add normally
   *   • Different seller → show conflict dialog, do NOT add
   */
  const addToCart = useCallback(async (product) => {
    const variantSku = String(product?.variantSku || product?.variantName || "").trim();
    if (isItemOutOfStock(product, variantSku)) {
      return false;
    }

    const availableStock = getItemStock(product, variantSku);
    const id = product.id || product._id;
    const key = `${id}::${variantSku || ""}`;

    const currentCartItem = cart.find(
      (item) => `${item.id || item._id}::${String(item.variantSku || "").trim()}` === key,
    );
    if (currentCartItem && availableStock > 0 && currentCartItem.quantity >= availableStock) {
      return false;
    }

    const { price, salePrice, variantName } = resolveVariantPricing(product, variantSku);

    // ── Single-seller restriction ─────────────────────────────────────────────
    const incomingSellerIdStr = extractSellerId(product);

    // Derive current cart's seller from the live cart state at call time
    const currentCart = cart; // captured via closure — consistent within this call
    const existingSellerIdStr = currentCart.length
      ? extractSellerId(currentCart[0])
      : "";

    if (
      currentCart.length > 0 &&
      incomingSellerIdStr &&
      existingSellerIdStr &&
      incomingSellerIdStr !== existingSellerIdStr
    ) {
      // Seller conflict — surface dialog, do NOT add
      setPendingProduct({
        ...product,
        variantSku,
        variantName,
        price,
        salePrice,
        id,
        image: product.image || product.mainImage,
      });
      setShowSellerConflict(true);
      return false;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // No conflict — proceed with optimistic UI update for instant feedback
    setCart((prev) => {
      const existingItem = prev.find(
        (item) => `${item.id || item._id}::${String(item.variantSku || "").trim()}` === key,
      );
      if (existingItem) {
        return prev.map((item) =>
          `${item.id || item._id}::${String(item.variantSku || "").trim()}` === key
            ? { ...item, quantity: item.quantity + 1 }
            : item,
        );
      }

      return [
        ...prev,
        {
          ...product,
          id,
          variantSku,
          variantName,
          price,
          salePrice,
          quantity: 1,
          image: product.image || product.mainImage,
        },
      ];
    });

    if (isAuthenticated) {
      pendingRequestsRef.current += 1;
      try {
        const response = await customerApi.addToCart({
          productId: id,
          variantSku,
          quantity: 1,
        });
        pendingRequestsRef.current -= 1;
        await syncCart(response.data.result.items);
      } catch (error) {
        pendingRequestsRef.current -= 1;
        console.error("Error adding to cart on backend", error);
        // Re-fetch entire cart to ensure consistency on error
        if (pendingRequestsRef.current === 0) {
          await fetchCart();
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, isAuthenticated]);

  /**
   * Called when user clicks "Cancel" on the conflict dialog.
   * Resets conflict state without touching the cart.
   */
  const cancelSellerSwitch = useCallback(() => {
    if (isProcessingReplaceRef.current) return;
    setPendingProduct(null);
    setPendingReorder(null);
    setShowSellerConflict(false);
  }, []);

  /**
   * Called when user clicks "Clear Cart & Add" or "Clear Cart & Reorder" on the conflict dialog.
   * Atomically clears the cart and adds the pending product or reorders the items.
   */
  const confirmSellerSwitch = useCallback(async () => {
    if (isProcessingReplaceRef.current || (!pendingProduct && !pendingReorder)) return;
    isProcessingReplaceRef.current = true;
    setIsReplacingCart(true);

    try {
      if (pendingReorder) {
        const orderId = pendingReorder.orderId;
        pendingRequestsRef.current += 1;
        const response = await customerApi.reorderOrder(orderId, { clearExisting: true });
        pendingRequestsRef.current -= 1;
        const payload = response?.data;
        const result = payload?.result || payload;
        if (result?.cart?.items) {
          const normalized = normalizeBackendCart(result.cart.items);
          setCart(normalized);
        } else {
          await fetchCart();
        }

        if (typeof pendingReorder.onConfirmSuccess === "function") {
          pendingReorder.onConfirmSuccess(result);
        }
        setPendingReorder(null);
        setShowSellerConflict(false);
        return;
      }

      const product = pendingProduct;
      const id = product.id || product._id;
      const variantSku = String(product?.variantSku || "").trim();

      if (isAuthenticated) {
        // Atomic replace on the backend — single DB write, no race condition
        pendingRequestsRef.current += 1;
        const response = await customerApi.replaceCart({
          productId: id,
          variantSku,
          quantity: 1,
        });
        pendingRequestsRef.current -= 1;
        // Sync the canonical backend response into local state
        const normalized = normalizeBackendCart(response.data.result.items);
        setCart(normalized);
      } else {
        // Guest mode — clear and re-add locally
        const { price, salePrice, variantName } = resolveVariantPricing(product, variantSku);
        setCart([
          {
            ...product,
            id,
            variantSku,
            variantName,
            price,
            salePrice,
            quantity: 1,
            image: product.image || product.mainImage,
          },
        ]);
      }

      // Dismiss dialog
      setPendingProduct(null);
      setShowSellerConflict(false);
    } catch (error) {
      console.error("Error replacing cart", error);
      pendingRequestsRef.current = Math.max(0, pendingRequestsRef.current - 1);
      // Re-fetch to restore consistency; do NOT dismiss the dialog so the user
      // can see the error (toast shown by the API interceptor)
      if (isAuthenticated && pendingRequestsRef.current === 0) {
        await fetchCart();
      }
      // Still close the dialog to avoid a stuck state
      setPendingProduct(null);
      setPendingReorder(null);
      setShowSellerConflict(false);
    } finally {
      setIsReplacingCart(false);
      isProcessingReplaceRef.current = false;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingProduct, pendingReorder, isAuthenticated]);

  /**
   * Reorder items from a previous order.
   * Funnels items into the cart while enforcing single-seller rules.
   * If a seller conflict is detected, opens SellerConflictDialog and retains pendingReorder.
   */
  const reorderOrder = useCallback(async (orderId, options = {}) => {
    if (!orderId) {
      return { success: false, message: "Order ID is required" };
    }

    try {
      const response = await customerApi.reorderOrder(orderId, {
        clearExisting: Boolean(options.clearExisting),
      });
      const payload = response?.data;
      const result = payload?.result || payload;
      if (result?.cart?.items) {
        const normalized = normalizeBackendCart(result.cart.items);
        setCart(normalized);
      } else {
        await fetchCart();
      }
      return { success: true, result };
    } catch (error) {
      const errorData = error?.response?.data;
      const isConflict =
        error?.response?.status === 409 &&
        (errorData?.code === "SELLER_CONFLICT" ||
          errorData?.result?.code === "SELLER_CONFLICT");

      if (isConflict) {
        setPendingProduct(null);
        setPendingReorder({
          orderId,
          onConfirmSuccess: options.onConfirmSuccess,
        });
        setShowSellerConflict(true);
        return { conflict: true, errorData };
      }

      throw error;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchCart]);

  const removeFromCart = async (productId, variantSku = "") => {
    const pIdStr = String(productId || "").trim();
    const normalizedVariantSku = String(variantSku || "").trim().toLowerCase();

    const matchesItem = (item) => {
      const itemId = String(item.id || item._id || "").trim();
      const itemSku = String(item.variantSku || "").trim().toLowerCase();
      if (itemId === pIdStr && itemSku === normalizedVariantSku) return true;
      if (
        itemId === pIdStr &&
        (!normalizedVariantSku ||
          itemSku === "" ||
          String(item.variantName || "").trim().toLowerCase() === normalizedVariantSku)
      ) {
        return true;
      }
      return false;
    };

    // Optimistic update
    setCart((prev) => prev.filter((item) => !matchesItem(item)));

    if (isAuthenticated) {
      pendingRequestsRef.current += 1;
      try {
        const response = await customerApi.removeFromCart(
          productId,
          variantSku,
        );
        pendingRequestsRef.current -= 1;
        await syncCart(response.data.result.items);
      } catch (error) {
        pendingRequestsRef.current -= 1;
        console.error("Error removing from cart on backend", error);
        if (pendingRequestsRef.current === 0) {
          await fetchCart();
        }
      }
    }
  };

  const updateQuantity = async (productId, delta, variantSku = "") => {
    const pIdStr = String(productId || "").trim();
    const normalizedVariantSku = String(variantSku || "").trim().toLowerCase();

    const matchesItem = (item) => {
      const itemId = String(item.id || item._id || "").trim();
      const itemSku = String(item.variantSku || "").trim().toLowerCase();
      if (itemId === pIdStr && itemSku === normalizedVariantSku) return true;
      if (
        itemId === pIdStr &&
        (!normalizedVariantSku ||
          itemSku === "" ||
          String(item.variantName || "").trim().toLowerCase() === normalizedVariantSku)
      ) {
        return true;
      }
      return false;
    };

    const currentItem = cart.find(matchesItem);
    if (!currentItem) return;

    const effectiveVariantSku = currentItem.variantSku || variantSku || "";

    if (delta > 0) {
      if (isItemOutOfStock(currentItem, effectiveVariantSku)) {
        return false;
      }
      const stock = getItemStock(currentItem, effectiveVariantSku);
      if (stock > 0 && currentItem.quantity >= stock) {
        return false;
      }
    }

    const newQty = Math.max(0, currentItem.quantity + delta);

    if (newQty === 0) {
      removeFromCart(productId, effectiveVariantSku);
      return;
    }

    // Optimistic update
    setCart((prev) =>
      prev.map((item) => {
        if (matchesItem(item)) {
          return { ...item, quantity: newQty };
        }
        return item;
      }),
    );

    if (isAuthenticated) {
      pendingRequestsRef.current += 1;
      try {
        const response = await customerApi.updateCartQuantity({
          productId,
          quantity: newQty,
          variantSku: effectiveVariantSku,
        });
        pendingRequestsRef.current -= 1;
        await syncCart(response.data.result.items);
      } catch (error) {
        pendingRequestsRef.current -= 1;
        console.error("Error updating quantity on backend", error);
        if (pendingRequestsRef.current === 0) {
          await fetchCart();
        }
      }
    }
  };

  const clearCart = async () => {
    if (isAuthenticated) {
      try {
        await customerApi.clearCart();
        setCart([]);
      } catch (error) {
        console.error("Error clearing cart on backend", error);
      }
    } else {
      setCart([]);
    }
  };

  const cartTotal = cart.reduce((total, item) => {
    const unit =
      Number(item.salePrice || 0) > 0 && Number(item.salePrice) < Number(item.price || 0)
        ? Number(item.salePrice)
        : Number(item.price || 0);
    return total + unit * Number(item.quantity || 0);
  }, 0);
  const cartCount = cart.reduce((total, item) => total + item.quantity, 0);

  const cartValue = useMemo(() => ({
    cart,
    addToCart,
    removeFromCart,
    updateQuantity,
    clearCart,
    cartTotal,
    cartCount,
    loading,
    // Seller conflict
    showSellerConflict,
    isReplacingCart,
    cancelSellerSwitch,
    confirmSellerSwitch,
    cartSellerId,
    pendingReorder,
    reorderOrder,
    isItemOutOfStock,
    getItemStock,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [cart, cartTotal, cartCount, loading, showSellerConflict, isReplacingCart, cartSellerId, pendingReorder, addToCart, cancelSellerSwitch, confirmSellerSwitch, reorderOrder]);

  return (
    <CartContext.Provider value={cartValue}>
      {children}
    </CartContext.Provider>
  );
};

export default CartContext;

