import React from "react";
import { cn } from "@/lib/utils";
import { computePurchaseGst } from "@shared/utils/currency";

const fmt = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Product-level purchase GST settings: GST Type (Inclusive / Exclusive) + custom GST Rate.
 * The rate is the product's existing `gstPercent` (also used for sales GST at POS).
 */
export const PurchaseGstSettings = ({ gstType, gstRate, onTypeChange, onRateChange }) => {
    const type = String(gstType || "EXCLUSIVE").toUpperCase();
    const rateError = computePurchaseGst("", gstRate, type).error;

    return (
        <div className="p-4 sm:p-5 bg-white rounded-2xl border border-slate-200 space-y-3">
            <div>
                <h4 className="text-sm font-bold text-slate-900">Purchase Price GST</h4>
                <p className="text-xs text-slate-600 font-medium">
                    Set whether each variant&apos;s Purchase Cost includes GST. Base, GST and Final purchase price are calculated automatically.
                </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 items-start">
                <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest ml-1">GST Type</label>
                    <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-xl">
                        {[
                            ["EXCLUSIVE", "Exclusive"],
                            ["INCLUSIVE", "Inclusive"],
                        ].map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                onClick={() => onTypeChange(value)}
                                className={cn(
                                    "py-1.5 rounded-lg text-xs font-bold transition-all",
                                    type === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700",
                                )}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-slate-500 ml-1">
                        {type === "INCLUSIVE" ? "Purchase Cost already includes GST." : "GST is added on top of Purchase Cost."}
                    </p>
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-600 uppercase tracking-widest ml-1">GST Rate (%)</label>
                    <input
                        type="number"
                        min="0"
                        max="100"
                        step="any"
                        inputMode="decimal"
                        onKeyDown={(e) => {
                            if (["-", "+", "e", "E"].includes(e.key)) e.preventDefault();
                        }}
                        value={gstRate ?? ""}
                        onChange={(e) => onRateChange(e.target.value)}
                        placeholder="e.g. 5, 10.5, 18"
                        className={cn(
                            "w-full px-3 py-2 bg-white ring-1 border-none rounded-xl text-xs font-bold outline-none focus:ring-2",
                            rateError ? "ring-rose-300 focus:ring-rose-200" : "ring-slate-200 focus:ring-primary/10",
                        )}
                    />
                    {rateError ? (
                        <p className="text-[10px] font-bold text-rose-600 ml-1">{rateError}</p>
                    ) : (
                        <p className="text-[10px] text-slate-500 ml-1">Any rate, e.g. 5, 10.5 or 18. Also used for GST on POS sales.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

/** Live per-variant breakdown for the entered Purchase Cost. The entered value itself is never changed. */
export const PurchaseGstBreakdown = ({ purchaseCost, gstRate, gstType }) => {
    const r = computePurchaseGst(purchaseCost, gstRate, gstType);
    if (r.empty) {
        return (
            <p className="text-[10px] text-slate-500 font-medium">
                Enter a Purchase Cost to see Base price, GST amount and Final purchase price.
            </p>
        );
    }
    if (r.error) {
        return <p className="text-[10px] font-bold text-rose-600">{r.error}</p>;
    }
    const cells = [
        ["Purchase Price", fmt(purchaseCost), "text-slate-900"],
        ["Base Purchase Price", fmt(r.basePrice), "text-slate-900"],
        ["GST Amount", fmt(r.gstAmount), "text-amber-700"],
        ["Final Purchase Price", fmt(r.finalPrice), "text-emerald-700"],
    ];
    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {cells.map(([label, value, tone]) => (
                <div key={label} className="px-3 py-2 rounded-xl bg-white ring-1 ring-slate-200">
                    <p className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">{label}</p>
                    <p className={cn("text-xs font-black", tone)}>{value}</p>
                </div>
            ))}
        </div>
    );
};

/** First validation error across the GST rate and all variants' purchase costs (for submit). */
export const findPurchaseGstError = (variants, gstRate, gstType) => {
    const rateError = computePurchaseGst("", gstRate, gstType).error;
    if (rateError) return rateError;
    for (let i = 0; i < (variants || []).length; i += 1) {
        const r = computePurchaseGst(variants[i]?.purchaseCost ?? "", gstRate, gstType);
        if (r.error) return (variants.length > 1 ? `Variant #${i + 1}: ` : "") + r.error;
    }
    return null;
};
