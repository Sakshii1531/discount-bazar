import React from "react";
import { HiOutlineArchiveBoxXMark, HiOutlineSquares2X2 } from "react-icons/hi2";
import { cn } from "@/lib/utils";
import { posVariantLabel } from "../../utils/variantLabel";

const resolvePrice = (product) => {
    const firstVariant = Array.isArray(product?.variants) && product.variants[0];
    const sale = Number(product?.salePrice ?? firstVariant?.salePrice ?? 0);
    const mrp = Number(product?.price ?? firstVariant?.price ?? 0);
    return sale > 0 && sale < mrp ? sale : mrp;
};

const ProductGrid = ({ products, isLoading, onAddProduct }) => {
    if (isLoading) {
        return (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
                {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="h-40 rounded-xl bg-slate-100 animate-pulse" />
                ))}
            </div>
        );
    }

    if (!products.length) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                <HiOutlineArchiveBoxXMark className="h-10 w-10 mb-2" />
                <p className="text-sm font-semibold">No products found</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
            {products.map((product) => {
                const variants = Array.isArray(product.variants) ? product.variants : [];
                const hasVariants = variants.length > 1;
                const singleVariantLabel = !hasVariants ? posVariantLabel(product, variants[0] || null) : "";

                // Total stock across variants for multi-variant products
                const totalStock = hasVariants
                    ? (Number(product.stock) > 0
                        ? Number(product.stock)
                        : variants.reduce((sum, v) => sum + Math.max(0, Number(v?.stock ?? 0)), 0))
                    : Number(product.stock || 0);

                const hasAvailableVariant = hasVariants
                    ? variants.some((v) => Number(v?.stock ?? product.stock ?? 0) > 0)
                    : totalStock > 0;

                const outOfStock = hasVariants ? !hasAvailableVariant : totalStock <= 0;

                return (
                    <button
                        key={product._id}
                        type="button"
                        disabled={outOfStock}
                        onClick={() => onAddProduct(product)}
                        className={cn(
                            "text-left rounded-xl border bg-white shadow-sm overflow-hidden transition-all active:scale-[0.97] flex flex-col justify-between group",
                            outOfStock
                                ? "opacity-50 cursor-not-allowed border-slate-100"
                                : "border-slate-200 hover:border-primary hover:shadow-md",
                        )}
                    >
                        <div className="w-full">
                            <div className="relative aspect-square bg-slate-50 flex items-center justify-center overflow-hidden">
                                {product.mainImage ? (
                                    <img
                                        src={product.mainImage}
                                        alt={product.name}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                    />
                                ) : (
                                    <span className="text-[10px] text-slate-300 font-semibold">No image</span>
                                )}
                                {hasVariants && (
                                    <span className="absolute top-1.5 right-1.5 bg-primary/95 text-white text-[10px] font-black px-1.5 py-0.5 rounded shadow-sm flex items-center gap-1 backdrop-blur-xs">
                                        <HiOutlineSquares2X2 className="w-3 h-3" />
                                        {variants.length} Variants
                                    </span>
                                )}
                            </div>
                            <div className="p-2">
                                <p className="text-[11px] font-bold text-slate-800 line-clamp-2 leading-tight h-7">
                                    {product.name}
                                </p>
                                {!hasVariants && singleVariantLabel ? (
                                    <p className="text-[10px] font-semibold text-slate-500 truncate mt-1">
                                        {singleVariantLabel}
                                    </p>
                                ) : null}
                                <div className="flex items-center justify-between mt-1.5">
                                    <span className="text-xs font-black text-slate-900">
                                        ₹{resolvePrice(product).toLocaleString("en-IN")}
                                    </span>
                                    <span
                                        className={cn(
                                            "text-[9px] font-bold px-1.5 py-0.5 rounded",
                                            outOfStock ? "bg-slate-200 text-slate-500" : "bg-emerald-50 text-emerald-700",
                                        )}
                                    >
                                        {outOfStock ? "Out of stock" : `${totalStock} left`}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {hasVariants && (
                            <div className="px-2 pb-2 pt-0 w-full">
                                <div className="pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px] font-bold text-primary">
                                    <span>{variants.length} variants available</span>
                                    <span className="text-xs font-black">&rsaquo;</span>
                                </div>
                            </div>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

export default ProductGrid;
