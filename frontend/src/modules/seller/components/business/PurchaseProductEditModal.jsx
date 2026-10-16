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

const formFrom = (p) => ({
    name: p.name || "",
    mrp: str(p.mrp),
    price: str(p.price),
    salePrice: str(p.salePrice),
    barcode: p.barcode || "",
    purchaseCost: str(p.purchaseCost),
    gstPercent: str(p.gstPercent ?? 0),
    purchaseGstType: p.purchaseGstType || "EXCLUSIVE",
    variants: (p.variants || []).map((v) => ({
        sku: v.sku,
        name: v.name || "",
        price: str(v.price),
        salePrice: str(v.salePrice),
        barcode: v.barcode || "",
        purchaseCost: str(v.purchaseCost),
        stock: v.stock ?? 0,
    })),
});

/** Returns an error message for the form, or "" when it can be saved. */
function validate(f, hasVariants) {
    if (!f.name.trim()) return "Product name is required";
    const gst = num(f.gstPercent || 0);
    if (!(gst >= 0 && gst <= 100)) return "GST % must be between 0 and 100";
    if (!isBlank(f.mrp) && !(num(f.mrp) >= 0)) return "MRP must be 0 or more";
    const priceRow = (row, label, checkMrp) => {
        if (!(num(row.price) > 0)) return `${label}: selling price must be more than 0`;
        if (!isBlank(row.salePrice) && !(num(row.salePrice) >= 0)) return `${label}: sale price must be 0 or more`;
        if (num(row.salePrice) > num(row.price)) return `${label}: sale price cannot be more than the selling price`;
        if (!isBlank(row.purchaseCost) && !(num(row.purchaseCost) >= 0)) return `${label}: purchase cost must be 0 or more`;
        const sell = num(row.salePrice) > 0 ? num(row.salePrice) : num(row.price);
        if (checkMrp && num(f.mrp) > 0 && sell > num(f.mrp)) return `${label}: selling price cannot be more than MRP`;
        return "";
    };
    // One product-level MRP can't cover variants of different sizes; only check it without variants.
    if (!hasVariants) return priceRow(f, "Product", true);
    const codes = f.variants.map((v) => v.barcode.trim()).filter(Boolean);
    if (new Set(codes).size !== codes.length) return "Two variants have the same barcode";
    for (const v of f.variants) {
        const e = priceRow(v, v.name || v.sku, false);
        if (e) return e;
    }
    return "";
}

/**
 * Edit the product behind a purchase-bill line without leaving the bill:
 * name, prices, barcode, GST and purchase cost (per variant when it has variants).
 * Stock is not editable here; the bill itself moves stock.
 * Render with key={product._id} so the form resets per product.
 */
const PurchaseProductEditModal = ({ product, onClose, onSaved }) => {
    const [form, setForm] = useState(() => formFrom(product));
    const [busy, setBusy] = useState(false);
    const hasVariants = (product.variants || []).length > 0;

    useEffect(() => {
        const onKey = (e) => e.key === "Escape" && !busy && onClose();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [busy, onClose]);

    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const setVariant = (idx, patch) =>
        setForm((f) => ({ ...f, variants: f.variants.map((v, i) => (i === idx ? { ...v, ...patch } : v)) }));

    const submit = async (e) => {
        e.preventDefault();
        const error = validate(form, hasVariants);
        if (error) return toast.error(error);

        const body = {
            gstPercent: num(form.gstPercent || 0),
            purchaseGstType: form.purchaseGstType,
            mrp: isBlank(form.mrp) ? 0 : num(form.mrp),
        };
        // Name only when changed: sending it regenerates the product's URL slug.
        if (form.name.trim() !== (product.name || "")) body.name = form.name.trim();
        if (hasVariants) {
            // The server replaces the whole variants array, so send every variant with all
            // its saved fields; stock is kept server-side for sellers.
            body.variants = (product.variants || []).map((orig) => {
                const v = form.variants.find((x) => x.sku === orig.sku) || {};
                const out = { ...orig };
                COMPUTED.forEach((k) => delete out[k]);
                out.name = v.name ?? orig.name;
                out.price = num(v.price);
                out.salePrice = isBlank(v.salePrice) ? 0 : num(v.salePrice);
                out.barcode = (v.barcode || "").trim();
                if (!isBlank(v.purchaseCost)) out.purchaseCost = num(v.purchaseCost);
                return out;
            });
        } else {
            body.price = num(form.price);
            body.salePrice = isBlank(form.salePrice) ? 0 : num(form.salePrice);
            body.barcode = form.barcode.trim();
            if (!isBlank(form.purchaseCost)) body.purchaseCost = num(form.purchaseCost);
        }

        setBusy(true);
        try {
            const res = await sellerApi.updateProduct(product._id, body);
            toast.success(res?.data?.message || "Product updated");
            await onSaved(res?.data?.result || null);
        } catch (err) {
            toast.error(err?.response?.data?.message || err?.message || "Failed to update product");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
            <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150" role="dialog" aria-modal="true" aria-labelledby="purchase-edit-product-title">
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-9 w-9 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                            <HiOutlinePencilSquare className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h3 id="purchase-edit-product-title" className="text-sm font-black text-slate-900 truncate">Edit Product</h3>
                            <p className="text-[11px] text-slate-500 font-medium truncate">{product.name}</p>
                        </div>
                    </div>
                    <button type="button" onClick={() => !busy && onClose()} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors" aria-label="Close">
                        <HiOutlineXMark className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={submit} className="p-6 space-y-4">
                    <div>
                        <label className={labelCls}>Product Name <span className="text-rose-500">*</span></label>
                        <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        <div>
                            <label className={labelCls}>MRP (₹)</label>
                            <input className={inputCls} type="number" min="0" step="0.01" value={form.mrp} onChange={(e) => set({ mrp: e.target.value })} />
                        </div>
                        <div>
                            <label className={labelCls}>GST %</label>
                            <input className={inputCls} type="number" min="0" max="100" step="0.01" value={form.gstPercent} onChange={(e) => set({ gstPercent: e.target.value })} />
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                            <label className={labelCls}>Purchase cost is</label>
                            <select className={inputCls} value={form.purchaseGstType} onChange={(e) => set({ purchaseGstType: e.target.value })}>
                                <option value="EXCLUSIVE">Excl. GST</option>
                                <option value="INCLUSIVE">Incl. GST</option>
                            </select>
                        </div>
                    </div>

                    {hasVariants ? (
                        <div className="space-y-2">
                            <p className="text-xs font-bold text-slate-800">Variants</p>
                            {form.variants.map((v, idx) => (
                                <div key={v.sku} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 space-y-2">
                                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                        <span className="font-mono truncate">SKU: {v.sku}</span>
                                        <span className="shrink-0">Stock: {v.stock}</span>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                        <div className="col-span-2 sm:col-span-1">
                                            <label className={labelCls}>Name</label>
                                            <input className={inputCls} value={v.name} onChange={(e) => setVariant(idx, { name: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>Price (₹) *</label>
                                            <input className={inputCls} type="number" min="0" step="0.01" value={v.price} onChange={(e) => setVariant(idx, { price: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>Sale price (₹)</label>
                                            <input className={inputCls} type="number" min="0" step="0.01" value={v.salePrice} onChange={(e) => setVariant(idx, { salePrice: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>Purchase cost (₹)</label>
                                            <input className={inputCls} type="number" min="0" step="0.01" value={v.purchaseCost} onChange={(e) => setVariant(idx, { purchaseCost: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className={labelCls}>Barcode</label>
                                            <input className={inputCls} value={v.barcode} onChange={(e) => setVariant(idx, { barcode: e.target.value })} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                                <label className={labelCls}>Selling price (₹) *</label>
                                <input className={inputCls} type="number" min="0" step="0.01" value={form.price} onChange={(e) => set({ price: e.target.value })} />
                            </div>
                            <div>
                                <label className={labelCls}>Sale price (₹)</label>
                                <input className={inputCls} type="number" min="0" step="0.01" value={form.salePrice} onChange={(e) => set({ salePrice: e.target.value })} />
                            </div>
                            <div>
                                <label className={labelCls}>Purchase cost (₹)</label>
                                <input className={inputCls} type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => set({ purchaseCost: e.target.value })} />
                            </div>
                            <div>
                                <label className={labelCls}>Barcode</label>
                                <input className={inputCls} value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} />
                            </div>
                        </div>
                    )}

                    <div className="p-3 bg-amber-50 border border-amber-200/70 rounded-xl flex items-start gap-2">
                        <HiOutlineExclamationTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                        <p className="text-[11px] text-amber-800 leading-relaxed">
                            This updates the product everywhere (POS and online store); edits may need admin re-approval.
                            Changed cost and GST are also applied to this product's lines on the bill. Stock is not changed here.
                        </p>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                        <button type="button" onClick={onClose} disabled={busy} className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 bg-white hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-50">
                            Cancel
                        </button>
                        <button type="submit" disabled={busy} className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-xs hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer">
                            {busy ? "Saving…" : "Save Product"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default PurchaseProductEditModal;
