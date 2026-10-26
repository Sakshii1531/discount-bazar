import React from "react";
import Modal from "@shared/components/ui/Modal";
import { cn } from "@/lib/utils";

const resolveVariantPrice = (variant, product) => {
    const sale = Number(variant?.salePrice ?? product?.salePrice ?? 0);
    const mrp = Number(variant?.price ?? product?.price ?? 0);
    return sale > 0 && sale < mrp ? sale : mrp;
};

const VariantPickerModal = ({ product, onSelect, onClose }) => {
    if (!product) return null;

    const variants = Array.isArray(product.variants) ? product.variants : [];

    return (
        <Modal isOpen={Boolean(product)} onClose={onClose} title={`Select Variant — ${product.name}`} size="sm">
            <div className="space-y-2 py-1">
                {variants.map((variant, index) => {
                    const stock = Number(variant.stock ?? product.stock ?? 0);
                    const outOfStock = stock <= 0;
                    const price = resolveVariantPrice(variant, product);
                    const mrp = Number(variant.price ?? product.price ?? 0);
                    const hasDiscount = price > 0 && mrp > price;
                    const variantTitle =
                        variant.name ||
                        [variant.size, variant.colour].filter(Boolean).join(" · ") ||
                        variant.sku ||
                        `Option ${index + 1}`;

                    return (
                        <button
                            key={variant._id || variant.sku || `${variant.name}-${index}`}
                            type="button"
                            disabled={outOfStock}
                            onClick={() => onSelect(product, variant)}
                            className={cn(
                                "w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-all",
                                outOfStock
                                    ? "opacity-50 cursor-not-allowed border-slate-100 bg-slate-50"
                                    : "border-slate-200 hover:border-primary hover:bg-primary/5 active:scale-[0.99]",
                            )}
                        >
                            <div className="min-w-0 pr-2">
                                <p className="text-sm font-bold text-slate-800 truncate">{variantTitle}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span
                                        className={cn(
                                            "text-[11px] font-semibold",
                                            outOfStock ? "text-rose-500" : "text-emerald-600",
                                        )}
                                    >
                                        {outOfStock ? "Out of stock" : `${stock} left`}
                                    </span>
                                    {variant.sku && (
                                        <span className="text-[10px] text-slate-400 font-mono truncate">
                                            SKU: {variant.sku}
                                        </span>
                                    )}
                                </div>
                            </div>
                            <div className="text-right shrink-0">
                                <span className="text-sm font-black text-slate-900">
                                    ₹{Number(price || 0).toLocaleString("en-IN")}
                                </span>
                                {hasDiscount && (
                                    <span className="block text-[11px] text-slate-400 line-through">
                                        ₹{Number(mrp).toLocaleString("en-IN")}
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </Modal>
    );
};

export default VariantPickerModal;
