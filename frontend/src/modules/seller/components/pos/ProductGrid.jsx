import React from "react";
import { HiOutlineArchiveBoxXMark } from "react-icons/hi2";
import { cn } from "@/lib/utils";

const resolvePrice = (product) => {
    const sale = Number(product.salePrice || 0);
    const mrp = Number(product.price || 0);
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
                const stock = Number(product.stock || 0);
                const outOfStock = stock <= 0;
                return (
                    <button
                        key={product._id}
                        type="button"
                        disabled={outOfStock}
                        onClick={() => onAddProduct(product)}
                        className={cn(
                            "text-left rounded-xl border bg-white shadow-sm overflow-hidden transition-all active:scale-[0.97]",
                            outOfStock
                                ? "opacity-50 cursor-not-allowed border-slate-100"
                                : "border-slate-200 hover:border-primary hover:shadow-md",
                        )}
                    >
                        <div className="aspect-square bg-slate-50 flex items-center justify-center overflow-hidden">
                            {product.mainImage ? (
                                <img src={product.mainImage} alt={product.name} className="w-full h-full object-cover" />
                            ) : (
                                <span className="text-[10px] text-slate-300 font-semibold">No image</span>
                            )}
                        </div>
                        <div className="p-2">
                            <p className="text-[11px] font-bold text-slate-800 line-clamp-2 leading-tight h-7">
                                {product.name}
                            </p>
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
                                    {outOfStock ? "Out of stock" : `${stock} left`}
                                </span>
                            </div>
                        </div>
                    </button>
                );
            })}
        </div>
    );
};

export default ProductGrid;
