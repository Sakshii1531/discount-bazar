import React from "react";
import Modal from "@shared/components/ui/Modal";
import { cn } from "@/lib/utils";

const VariantPickerModal = ({ product, onSelect, onClose }) => {
    if (!product) return null;

    return (
        <Modal isOpen={Boolean(product)} onClose={onClose} title={`Select option — ${product.name}`} size="sm">
            <div className="space-y-2">
                {(product.variants || []).map((variant) => {
                    const stock = Number(variant.stock ?? product.stock ?? 0);
                    const outOfStock = stock <= 0;
                    const price = Number(variant.salePrice || 0) > 0 && Number(variant.salePrice) < Number(variant.price)
                        ? variant.salePrice
                        : variant.price;
                    return (
                        <button
                            key={variant.sku || variant.name}
                            type="button"
                            disabled={outOfStock}
                            onClick={() => onSelect(product, variant)}
                            className={cn(
                                "w-full flex items-center justify-between px-4 py-3 rounded-xl border text-left transition-colors",
                                outOfStock
                                    ? "opacity-50 cursor-not-allowed border-slate-100 bg-slate-50"
                                    : "border-slate-200 hover:border-primary hover:bg-primary/5",
                            )}
                        >
                            <div>
                                <p className="text-sm font-bold text-slate-800">{variant.name || variant.sku}</p>
                                <p className="text-[11px] text-slate-500">{outOfStock ? "Out of stock" : `${stock} left`}</p>
                            </div>
                            <span className="text-sm font-black text-slate-900">₹{Number(price || 0).toLocaleString("en-IN")}</span>
                        </button>
                    );
                })}
            </div>
        </Modal>
    );
};

export default VariantPickerModal;
