import React from "react";
import { Link, useLocation } from "react-router-dom";
import { Heart, Plus, Minus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWishlist } from "../../context/WishlistContext";
import { useCart } from "../../context/CartContext";
import { useToast } from "@shared/components/ui/Toast";
import { useCartAnimation } from "../../context/CartAnimationContext";
import { useLocation as useAppLocation } from "../../context/LocationContext";
import { formatCurrencyInteger } from "@shared/utils/currency";
import { applyCloudinaryTransform } from "@/core/utils/imageUtils";

import { motion, AnimatePresence } from "framer-motion";
import { Clock } from "lucide-react";

import { useProductDetail } from "../../context/ProductDetailContext";

const ProductCard = React.memo(
  ({ product, badge, className, compact = false, neutralBg = false }) => {
    const { toggleWishlist: toggleWishlistGlobal, isInWishlist } =
      useWishlist();
    const { cart, addToCart, updateQuantity, removeFromCart } = useCart();
    const { showToast } = useToast();
    const { animateAddToCart, animateRemoveFromCart } = useCartAnimation();
    const { currentLocation } = useAppLocation();

    const { openProduct } = useProductDetail();
    const [showHeartPopup, setShowHeartPopup] = React.useState(false);
    
    const location = useLocation();
    const isWishlistPage = location.pathname === '/wishlist';

    const imageRef = React.useRef(null);

    const defaultVariant = React.useMemo(() => {
      const variants = Array.isArray(product?.variants) ? product.variants : [];
      if (variants.length === 0) return null;

      const displayed = Number(product?.price || 0);
      const displayedOriginal = Number(product?.originalPrice || 0);

      const matchesDisplayedPrice = (variant) => {
        const mrp = Number(variant?.price || 0);
        const sale = Number(variant?.salePrice || 0);
        const effective = sale > 0 && sale < mrp ? sale : mrp;

        if (Number.isFinite(displayedOriginal) && displayedOriginal > displayed) {
          // Try to match both (sale + original) when card shows a discount.
          if (effective === displayed && (mrp === displayedOriginal || displayedOriginal === 0)) {
            return true;
          }
        }

        return effective === displayed || mrp === displayed;
      };

      const picked = variants.find(matchesDisplayedPrice) || variants[0];
      const key = String(picked?.sku || picked?.name || "").trim();
      
      const variantMrp = Number(picked?.price || 0);
      const variantSale = Number(picked?.salePrice || 0);
      const hasDiscount = variantSale > 0 && variantSale < variantMrp;
      
      return {
        key,
        name: String(picked?.name || "").trim(),
        displayPrice: hasDiscount ? variantSale : (variantMrp || displayed),
        displayOriginalPrice: hasDiscount ? variantMrp : (displayedOriginal > displayed ? displayedOriginal : null),
        discountPercent: hasDiscount ? Math.round(((variantMrp - variantSale) / variantMrp) * 100) : (displayedOriginal > displayed ? Math.round(((displayedOriginal - displayed) / displayedOriginal) * 100) : 0)
      };
    }, [product]);

    const productId = product.id || product._id;
    const variantKey = String(defaultVariant?.key || "").trim();
    const cartKey = `${productId}::${variantKey || ""}`;

    const cartItem = React.useMemo(
      () =>
        cart.find(
          (item) =>
            `${item.id || item._id}::${String(item.variantSku || "").trim()}` ===
            cartKey,
        ),
      [cart, cartKey],
    );
    const quantity = cartItem ? cartItem.quantity : 0;
    const isWishlisted = isInWishlist(product.id || product._id);

    const handleProductClick = React.useCallback(
      (e) => {
        if (openProduct) {
          e.preventDefault();
          openProduct(product);
        }
      },
      [openProduct, product],
    );

    const toggleWishlist = React.useCallback(
      (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (!isWishlisted) {
          setShowHeartPopup(true);
          setTimeout(() => setShowHeartPopup(false), 1000);
        }

        toggleWishlistGlobal(product);
        showToast(
          isWishlisted
            ? `${product.name} removed from wishlist`
            : `${product.name} added to wishlist`,
          isWishlisted ? "info" : "success",
        );
      },
      [isWishlisted, toggleWishlistGlobal, product, showToast],
    );

    const availableStock = React.useMemo(() => {
      if (!product) return 0;
      if (
        product.status === "out_of_stock" ||
        product.status === "OUT_OF_STOCK" ||
        product.inStock === false ||
        product.isOutOfStock === true
      ) {
        return 0;
      }

      const masterStock =
        product.stock !== undefined && product.stock !== null
          ? Math.max(0, Number(product.stock))
          : 999;

      const variants = Array.isArray(product?.variants) ? product.variants : [];
      if (variants.length > 0) {
        const rawVariant =
          variants.find(
            (v) =>
              String(v?.sku || v?.name || "").trim() ===
              String(defaultVariant?.key || "").trim(),
          ) || variants[0];
        if (rawVariant) {
          if (
            rawVariant.status === "out_of_stock" ||
            rawVariant.status === "OUT_OF_STOCK" ||
            rawVariant.inStock === false
          ) {
            return 0;
          }

          if (rawVariant.stock !== undefined && rawVariant.stock !== null) {
            return Math.max(0, Number(rawVariant.stock));
          }
          return masterStock;
        }
      }

      return masterStock;
    }, [product, defaultVariant]);

    const isOutOfStock = availableStock <= 0;

    const handleAddToCart = React.useCallback(
      (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (isOutOfStock) {
          showToast(`${product.name} is currently out of stock`, "error");
          return;
        }

        // If the product has multiple variants, open the product detail sheet
        // so the user can select which variant they want to add.
        const variants = Array.isArray(product?.variants) ? product.variants : [];
        if (variants.length > 1 && openProduct) {
          openProduct(product);
          return;
        }

        if (imageRef.current) {
          animateAddToCart(
            imageRef.current.getBoundingClientRect(),
            product.image,
          );
        }
        addToCart({
          ...product,
          variantSku: variantKey,
          variantName: defaultVariant?.name || "",
        });
        
        if (isWishlistPage && isWishlisted) {
          toggleWishlistGlobal(product);
        }
      },
      [isOutOfStock, showToast, animateAddToCart, product, addToCart, variantKey, defaultVariant?.name, openProduct, isWishlistPage, isWishlisted, toggleWishlistGlobal],
    );

    const handleIncrement = React.useCallback(
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (availableStock > 0 && quantity >= availableStock) {
          showToast(`Only ${availableStock} units available in stock`, "info");
          return;
        }
        updateQuantity(productId, 1, variantKey);
      },
      [updateQuantity, productId, variantKey, quantity, availableStock, showToast],
    );

    const handleDecrement = React.useCallback(
      (e) => {
        e.preventDefault();
        e.stopPropagation();

        if (quantity === 1) {
          animateRemoveFromCart(product.image);
          removeFromCart(productId, variantKey);
        } else {
          updateQuantity(productId, -1, variantKey);
        }
      },
      [
        quantity,
        animateRemoveFromCart,
        product.image,
        removeFromCart,
        productId,
        updateQuantity,
        variantKey,
      ],
    );

    return (
      <div
        className={cn(
          "flex-shrink-0 w-full rounded-xl sm:rounded-2xl overflow-hidden flex flex-col h-full shadow-sm cursor-pointer transition-all duration-300 hover:scale-[1.02]",
          compact
            ? "bg-white border-[1.5px] border-brand-50 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.08)]"
            : neutralBg
              ? "bg-white border border-slate-100 shadow-[0_8px_20px_-8px_rgba(0,0,0,0.08)]"
              : "bg-primary/10 border border-primary/20",
          className,
        )}
        onClick={handleProductClick}>
        {/* Top Image Section */}
        <div className="relative">
          {/* Badge (Custom, Out of Stock, or Discount) */}
          {isOutOfStock ? (
            <div
              className={cn(
                "absolute z-10 bg-slate-900/85 text-white font-[900] rounded-md shadow-sm uppercase tracking-wider flex items-center justify-center",
                compact
                  ? "top-2 left-2 px-1.5 py-0.5 text-[7px]"
                  : "top-2 left-2 px-1.5 py-0.5 text-[7px] sm:top-3 sm:left-3 sm:px-2 sm:py-1 sm:text-[9px]",
              )}>
              Out of Stock
            </div>
          ) : (badge ||
            product.discount ||
            defaultVariant?.discountPercent > 0) && (
              <div
                className={cn(
                  "absolute z-10 bg-primary text-primary-foreground font-[900] rounded-md shadow-sm uppercase tracking-wider flex items-center justify-center",
                  compact
                    ? "top-2 left-2 px-1.5 py-0.5 text-[7px]"
                    : "top-2 left-2 px-1 py-0.5 text-[7px] sm:top-3 sm:left-3 sm:px-2 sm:py-1 sm:text-[9px]",
                )}>
                {badge ||
                  product.discount ||
                  `${defaultVariant?.discountPercent}% OFF`}
              </div>
            )}

          <button
            onClick={toggleWishlist}
            className={cn(
              "absolute z-10 bg-white/90 backdrop-blur-sm rounded-full shadow-lg flex items-center justify-center cursor-pointer hover:bg-white transition-all active:scale-90",
              compact
                ? "top-2 right-2 h-7 w-7"
                : "top-2 right-2 h-6.5 w-6.5 sm:top-3 sm:right-3 sm:h-8 sm:w-8",
            )}>
            <motion.div
              whileTap={{ scale: 0.8 }}
              animate={isWishlisted ? { scale: [1, 1.2, 1] } : {}}>
              <Heart
                size={compact ? 12 : 14}
                className={cn(
                  isWishlisted
                    ? "text-red-500 fill-current"
                    : "text-neutral-400",
                )}
              />
            </motion.div>
          </button>

          <AnimatePresence>
            {showHeartPopup && (
              <motion.div
                initial={{ scale: 0.5, opacity: 1, y: 0 }}
                animate={{ scale: 2, opacity: 0, y: -40 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="absolute top-3 right-3 z-50 pointer-events-none text-red-500">
                <Heart size={24} fill="currentColor" />
              </motion.div>
            )}
          </AnimatePresence>

          <div
            className={cn(
              "block w-full overflow-hidden flex items-center justify-center aspect-square",
              compact || neutralBg ? "bg-white/70" : "bg-white/50"
            )}>
            <img
              ref={imageRef}
              src={applyCloudinaryTransform(product?.image || product?.mainImage || (Array.isArray(product?.images) ? product?.images[0] : null))}
              alt={product?.name || "Product"}
              loading="lazy"
              className={cn("w-full h-full object-cover mix-blend-multiply", isOutOfStock && "opacity-60 grayscale")}
            />
          </div>
        </div>

        {/* Info Section */}
        <div
          className={cn(
            "flex flex-col flex-1",
            compact
              ? "p-2 pt-1 gap-0"
              : "bg-white/40 p-1.5 pt-2 sm:p-3 sm:pt-4 gap-0.5",
          )}>
          <div className="flex items-center gap-1 mb-0.5 sm:gap-1.5 sm:mb-1">
            <div
              className={cn(
                "border-2 border-primary rounded-full flex items-center justify-center",
                compact ? "h-2.5 w-2.5" : "h-2.5 w-2.5 sm:h-3.5 sm:w-3.5",
              )}>
              <div
                className={cn(
                  "bg-primary rounded-full",
                  compact ? "h-0.5 w-0.5" : "h-1 w-1",
                )}
              />
            </div>
            <div
              className={cn(
                "bg-brand-50 text-brand-600 font-bold rounded px-1.5 py-0 tracking-wide",
                compact ? "text-[8px]" : "text-[8px] sm:text-[9px]",
              )}>
              {defaultVariant?.name || product.weight || "1 unit"}
            </div>
          </div>

          <div className={cn(compact ? "h-8" : "h-8 sm:h-9")}>
            <h4
              className={cn(
                "font-[600] text-[#1A1A1A] leading-tight line-clamp-2",
                compact ? "text-[10.5px]" : "text-[12px] sm:text-[13px]",
              )}>
              {product.name}
            </h4>
          </div>

          {/* Delivery Time & Unit info */}
          <div className="flex items-center gap-1 text-gray-500 mt-0.5 mb-1 sm:gap-1.5 sm:mt-1 sm:mb-2">
            <Clock size={compact ? 9 : 10} className="text-primary/80" />
            <span
              className={cn(
                "font-semibold",
                compact ? "text-[8px]" : "text-[9px] sm:text-[10px]",
              )}>
              {product.deliveryTime || currentLocation?.time || "10-15 mins"}
            </span>
          </div>

          {/* Price Row / ADD Button Combination for compact */}
          <div className="mt-auto flex items-center justify-between gap-1">
            <div className="flex flex-col">
              <span
                className={cn(
                  "font-[1000] text-[#1A1A1A]",
                  compact ? "text-[11px]" : "text-[13px] sm:text-sm",
                )}>
                {formatCurrencyInteger(defaultVariant?.displayPrice ?? product.price)}
              </span>
              {defaultVariant?.displayOriginalPrice && (
                <span
                  className={cn(
                    "font-medium text-gray-400 line-through leading-none",
                    compact ? "text-[8px]" : "text-[9px] sm:text-[10px]",
                  )}>
                  {formatCurrencyInteger(defaultVariant.displayOriginalPrice)}
                </span>
              )}
            </div>

            {/* ADD Button / Quantity Selector (Always in price row) */}
            <div className="flex">
              {isOutOfStock ? (
                <button
                  disabled
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  className={cn(
                    "bg-slate-100 border-[1.5px] border-slate-200 text-slate-400 rounded-lg font-black shadow-xs uppercase tracking-wide leading-none cursor-not-allowed pointer-events-none opacity-80",
                    compact
                      ? "px-2 py-1 text-[8px]"
                      : "px-2.5 py-1.5 text-[9px] sm:px-3 sm:py-2 sm:text-[10px] md:text-xs",
                  )}>
                  OUT OF STOCK
                </button>
              ) : quantity > 0 ? (
                <div
                  className={cn(
                    "flex items-center bg-white border-[1.5px] border-primary rounded-lg p-0.5 justify-between",
                    compact ? "min-w-[60px]" : "min-w-[68px] sm:min-w-[90px] md:min-w-[100px]",
                  )}>
                  <button
                    onClick={handleDecrement}
                    className="p-0.5 px-0.5 text-primary active:scale-90 transition-transform sm:p-1 sm:px-1">
                    <Minus size={compact ? 10 : 12} strokeWidth={3.5} />
                  </button>
                  <span
                    className={cn(
                      "font-black text-primary",
                      compact ? "text-[10px]" : "text-[11px] sm:text-[13px] md:text-sm",
                    )}>
                    {quantity}
                  </span>
                  <button
                    onClick={handleIncrement}
                    className="p-0.5 px-0.5 text-primary active:scale-90 transition-transform sm:p-1 sm:px-1">
                    <Plus size={compact ? 10 : 12} strokeWidth={3.5} />
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleAddToCart}
                  className={cn(
                    "bg-white border-[1.5px] border-primary text-primary rounded-lg font-black shadow-sm hover:bg-primary/5 mb-0 transition-all uppercase tracking-wide leading-none active:scale-95",
                    compact
                      ? "px-2.5 py-1 text-[10px]"
                      : "px-3.5 py-1.5 text-[11px] sm:px-7 sm:py-2 sm:text-[13px] md:text-sm md:px-8 md:py-2.5",
                  )}>
                  ADD
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  },
);

export default ProductCard;
