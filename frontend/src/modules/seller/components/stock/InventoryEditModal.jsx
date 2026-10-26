import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { HiOutlinePencilSquare, HiOutlineXMark, HiOutlineExclamationTriangle } from "react-icons/hi2";
import { sellerApi } from "../../services/sellerApi";

const inputCls = "w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all";
const labelCls = "block text-[11px] font-bold text-slate-600 mb-1";

// Server-computed purchase GST breakdown; never sent back.
const COMPUTED = ["purchaseBasePrice", "purchaseGstAmount", "purchaseFinalPrice"];

const str = (v) => (v === null || v === undefined ? "" : String(v));
const isBlank = (v) => v === "" || v === null || v === undefined;
const num = (v) => Number(v);

// One editable row per variant; a product without variants is a single row.
const rowsFrom = (p) => {
    const variants = Array.isArray(p.variants) ? p.variants : [];
    if (!variants.length) {
        return [{
            key: "product",
            label: p.sku || "Product",
            stock: str(p.stock ?? 0),
            price: str(p.price),
            salePrice: str(p.salePrice),
            purchaseCost: str(p.purchaseCost),
        }];
    }
    return variants.map((v, i) => ({
        key: v.sku || v.name || `variant-${i}`,
        sku: v.sku,
        name: v.name,
        label: v.name || v.sku || `Variant ${i + 1}`,
        stock: str(v.stock ?? 0),
        price: str(v.price),
        salePrice: str(v.salePrice),
        purchaseCost: str(v.purchaseCost),
    }));
};

/** Returns an error message for the rows, or "" when they can be saved. */
function validate(rows) {
    for (const r of rows) {
        const stock = num(r.stock);
        if (isBlank(r.stock) || !Number.isInteger(stock) || stock < 0) return `${r.label}: stock must be a whole number, 0 or more`;
        if (!(num(r.price) > 0)) return `${r.label}: price must be more than 0`;
        if (!isBlank(r.salePrice) && !(num(r.salePrice) >= 0)) return `${r.label}: sale price must be 0 or more`;
        if (num(r.salePrice) > num(r.price)) return `${r.label}: sale price cannot be more than the price`;
        if (!isBlank(r.purchaseCost) && !(num(r.purchaseCost) >= 0)) return `${r.label}: purchase cost must be 0 or more`;
    }
    return "";
}

const pricingChanged = (a, b) =>
    num(a.price) !== num(b.price) ||
    num(a.salePrice || 0) !== num(b.salePrice || 0) ||
    str(a.purchaseCost) !== str(b.purchaseCost);

/**
 * Edit stock, price, sale price and purchase cost of a product (per variant when it
 * has variants) from Stock Management. Prices go through the product update; stock
 * goes through stock adjustments so every change is in the movement log.
 * Render with key={product._id} so the form resets per product.
 */
const InventoryEditModal = ({ product, onClose, onSaved }) => {
    const [initial] = useState(() => rowsFrom(product));
    const [rows, setRows] = useState(initial);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);
    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;

    useEffect(() => {
        const onKey = (e) => e.key === "Escape" && !busy && onClose();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [busy, onClose]);

    const setRow = (idx, patch) => setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

    const savePricing = () => {
        const priced = (r) => ({
            price: num(r.price),
            salePrice: isBlank(r.salePrice) ? 0 : num(r.salePrice),
            ...(isBlank(r.purchaseCost) ? {} : { purchaseCost: num(r.purchaseCost) }),
        });
        if (!hasVariants) return sellerApi.updateProduct(product._id, priced(rows[0]));

        // The server replaces the whole variants array, so send every saved variant with
        // all its fields; it keeps their stock as is for sellers.
        const variants = product.variants.map((v, i) => {
            const out = { ...v };
            COMPUTED.forEach((k) => delete out[k]);
            return { ...out, ...priced(rows[i]) };
        });
        // Top-level price mirrors the first variant, as when the product is created.
        const { price, salePrice } = priced(rows[0]);
        return sellerApi.updateProduct(product._id, { variants, price, salePrice });
    };

    const submit = async (e) => {
        e.preventDefault();
        const error = validate(rows);
        if (error) return toast.error(error);

        const pricing = rows.some((r, i) => pricingChanged(r, initial[i]));
        const stockMoves = rows
            .map((r, i) => ({ row: r, from: num(initial[i].stock), to: num(r.stock) }))
            .filter((m) => m.from !== m.to);
        if (!pricing && !stockMoves.length) return onClose();

        setBusy(true);
        let changed = false;
        try {
            if (pricing) {
                const res = await savePricing();
                changed = true;
                toast.success(res?.data?.message || "Prices updated");
            }
            // One at a time: each adjustment saves the whole product document.
            for (const { row, from, to } of stockMoves) {
                await sellerApi.adjustStock({
                    productId: product._id,
                    variantSku: hasVariants ? (row.sku || row.name) : undefined,
                    type: to > from ? "Restock" : "Correction",
                    quantity: Math.abs(to - from),
                    note: reason.trim() || `Stock set from ${from} to ${to}`,
                });
                changed = true;
            }
            if (stockMoves.length) toast.success("Stock updated");
            await onSaved();
        } catch (err) {
            toast.error(err?.response?.data?.message || err?.message || "Failed to save changes");
            // Part of the save went through; close so a retry starts from the stored values.
            if (changed) await onSaved();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
            <div className="bg-white w-full max-w-2xl max-h-[calc(100dvh-2rem)] flex flex-col rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150" role="dialog" aria-modal="true" aria-labelledby="inventory-edit-title">
                <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-9 w-9 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                            <HiOutlinePencilSquare className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h3 id="inventory-edit-title" className="text-sm font-black text-slate-900 truncate">Edit Stock &amp; Pricing</h3>
                            <p className="text-[11px] text-slate-500 font-medium truncate">{product.name}</p>
                        </div>
                    </div>
                    <button type="button" onClick={() => !busy && onClose()} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" aria-label="Close">
                        <HiOutlineXMark className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={submit} className="flex-1 min-h-0 flex flex-col">
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-3">
                        {hasVariants && <p className="text-xs font-bold text-slate-800">Variants ({rows.length})</p>}
                        {rows.map((r, idx) => (
                            <div key={r.key} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                                {hasVariants && (
                                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                        <span className="font-bold text-slate-800 truncate">{r.label}</span>
                                        {r.sku && <span className="font-mono truncate">SKU: {r.sku}</span>}
                                    </div>
                                )}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                    <div>
                                        <label className={labelCls}>Stock (units)</label>
                                        <input className={inputCls} type="number" min="0" step="1" value={r.stock} onChange={(e) => setRow(idx, { stock: e.target.value })} autoFocus={idx === 0} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Price (₹) *</label>
                                        <input className={inputCls} type="number" min="0" step="0.01" value={r.price} onChange={(e) => setRow(idx, { price: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Sale price (₹)</label>
                                        <input className={inputCls} type="number" min="0" step="0.01" value={r.salePrice} onChange={(e) => setRow(idx, { salePrice: e.target.value })} />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Purchase cost (₹)</label>
                                        <input className={inputCls} type="number" min="0" step="0.01" value={r.purchaseCost} onChange={(e) => setRow(idx, { purchaseCost: e.target.value })} />
                                    </div>
                                </div>
                            </div>
                        ))}

                        <div>
                            <label className={labelCls}>Reason for stock change (optional)</label>
                            <textarea
                                className={`${inputCls} resize-none h-16`}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="e.g. Supplier delivery, damaged items, stock count…"
                            />
                        </div>

                        <div className="p-3 bg-amber-50 border border-amber-200/70 rounded-xl flex items-start gap-2">
                            <HiOutlineExclamationTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                            <p className="text-[11px] text-amber-800 leading-relaxed">
                                Price changes update the product everywhere (POS and online store) and may need admin re-approval.
                                Stock changes are recorded in the stock movement history.
                            </p>
                        </div>
                    </div>

                    <div className="shrink-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-white">
                        <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 bg-white hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-50">
                            Cancel
                        </button>
                        <button type="submit" disabled={busy} className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-xs hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer">
                            {busy ? "Saving…" : "Save Changes"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default InventoryEditModal;
