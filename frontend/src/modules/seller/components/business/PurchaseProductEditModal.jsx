import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { HiOutlinePencilSquare, HiOutlineXMark, HiOutlineExclamationTriangle, HiOutlinePlus, HiOutlineTrash } from "react-icons/hi2";
import { sellerApi } from "../../services/sellerApi";

const inputCls = "w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all";
const labelCls = "block text-[11px] font-bold text-slate-600 mb-1";

// Server-computed purchase GST breakdown; never sent back.
const COMPUTED = ["purchaseBasePrice", "purchaseGstAmount", "purchaseFinalPrice"];

const str = (v) => (v === null || v === undefined ? "" : String(v));
const isBlank = (v) => v === "" || v === null || v === undefined;
const num = (v) => Number(v);

const toDateInput = (val) => {
    if (!val) return "";
    try {
        const d = new Date(val);
        if (Number.isNaN(d.getTime())) return "";
        return d.toISOString().slice(0, 10);
    } catch {
        return "";
    }
};

const formFrom = (p) => ({
    name: p.name || "",
    mrp: str(p.mrp),
    price: str(p.price),
    salePrice: str(p.salePrice),
    barcode: p.barcode || "",
    purchaseCost: str(p.purchaseCost),
    gstPercent: str(p.gstPercent ?? 0),
    purchaseGstType: p.purchaseGstType || "EXCLUSIVE",
    expiryDate: toDateInput(p.expiryDate),
    variants: (p.variants || []).map((v, i) => ({
        key: v.sku || `saved-${i}`,
        sku: v.sku,
        name: v.name || "",
        price: str(v.price),
        salePrice: str(v.salePrice),
        barcode: v.barcode || "",
        purchaseCost: str(v.purchaseCost),
        stock: v.stock ?? 0,
        expiryDate: toDateInput(v.expiryDate),
    })),
});

let newKeySeq = 0;
// A variant row added in this popup; prices/cost start from the row above.
const newVariantRow = (from = {}) => ({
    key: `new-${(newKeySeq += 1)}`,
    isNew: true,
    sku: "",
    name: "",
    price: str(from.price),
    salePrice: str(from.salePrice),
    purchaseCost: str(from.purchaseCost),
    barcode: "",
    stock: 0,
    expiryDate: toDateInput(from.expiryDate),
});

const SKU_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const keyOf = (v) => String(v || "").trim().toLowerCase();
const firstDuplicate = (values) => {
    const seen = new Set();
    for (const v of values.map(keyOf).filter(Boolean)) {
        if (seen.has(v)) return v;
        seen.add(v);
    }
    return null;
};

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
        if ((v.isNew || v.isBase) && !v.name.trim()) return "Give every new variant a name";
        if (v.isNew && v.sku.trim() && !SKU_PATTERN.test(v.sku.trim())) {
            return `SKU "${v.sku.trim()}": use letters, numbers, - or _ (max 40)`;
        }
    }
    const dupName = firstDuplicate(f.variants.map((v) => v.name));
    if (dupName) return `Two variants are named "${dupName}"`;
    const dupSku = firstDuplicate(f.variants.map((v) => v.sku));
    if (dupSku) return `Two variants have the SKU "${dupSku.toUpperCase()}"`;
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
    const [focusKey, setFocusKey] = useState(null);
    const hasVariants = form.variants.length > 0;

    useEffect(() => {
        const onKey = (e) => e.key === "Escape" && !busy && onClose();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [busy, onClose]);

    const set = (patch) => setForm((f) => ({ ...f, ...patch }));
    const setVariant = (idx, patch) =>
        setForm((f) => ({ ...f, variants: f.variants.map((v, i) => (i === idx ? { ...v, ...patch } : v)) }));

    // Add a variant row. A product without variants first becomes variant 1 (same SKU,
    // so the server keeps its stock), then the new row is added after it.
    const addVariant = () => {
        const row = newVariantRow();
        setForm((f) => {
            const rows = f.variants.length
                ? f.variants
                : [{
                    key: "base",
                    isBase: true,
                    sku: product.sku || "",
                    name: product.size || "Standard",
                    price: f.price,
                    salePrice: f.salePrice,
                    purchaseCost: f.purchaseCost,
                    barcode: f.barcode,
                    stock: product.stock ?? 0,
                    expiryDate: f.expiryDate || toDateInput(product.expiryDate),
                }];
            const last = rows[rows.length - 1];
            return {
                ...f,
                variants: [
                    ...rows,
                    {
                        ...row,
                        price: last.price,
                        salePrice: last.salePrice,
                        purchaseCost: last.purchaseCost,
                        expiryDate: last.expiryDate || "",
                    },
                ],
            };
        });
        setFocusKey(row.key);
    };

    const removeVariant = (key) =>
        setForm((f) => {
            const rows = f.variants.filter((v) => v.key !== key);
            // Undo the conversion when the only added row goes away again.
            if (rows.length === 1 && rows[0].isBase) {
                const base = rows[0];
                return {
                    ...f,
                    price: base.price,
                    salePrice: base.salePrice,
                    purchaseCost: base.purchaseCost,
                    barcode: base.barcode,
                    expiryDate: base.expiryDate,
                    variants: [],
                };
            }
            return { ...f, variants: rows };
        });

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
            // The server replaces the whole variants array, so send every saved variant with
            // all its fields; stock is kept server-side for sellers. New variants start at 0
            // stock (it comes in through the purchase bill) and get a SKU from the server
            // when left blank.
            const editable = (v) => ({
                name: v.name.trim(),
                price: num(v.price),
                salePrice: isBlank(v.salePrice) ? 0 : num(v.salePrice),
                barcode: (v.barcode || "").trim(),
                ...(isBlank(v.purchaseCost) ? {} : { purchaseCost: num(v.purchaseCost) }),
                expiryDate: v.expiryDate ? v.expiryDate : "",
            });
            body.variants = form.variants.map((v) => {
                if (v.isNew) return { sku: v.sku.trim().toUpperCase(), ...editable(v), stock: 0 };
                if (v.isBase) {
                    return { sku: v.sku, size: product.size || "", colour: product.colour || "", ...editable(v), stock: product.stock ?? 0 };
                }
                const out = { ...((product.variants || []).find((o) => o.sku === v.sku) || {}) };
                COMPUTED.forEach((k) => delete out[k]);
                return { ...out, ...editable(v) };
            });
        } else {
            body.price = num(form.price);
            body.salePrice = isBlank(form.salePrice) ? 0 : num(form.salePrice);
            body.barcode = form.barcode.trim();
            if (!isBlank(form.purchaseCost)) body.purchaseCost = num(form.purchaseCost);
            body.expiryDate = form.expiryDate ? form.expiryDate : "";
        }

        setBusy(true);
        try {
            const res = await sellerApi.updateProduct(product._id, body);
            const added = form.variants.filter((v) => v.isNew).length;
            const message = res?.data?.message || "Product updated";
            toast.success(added ? `${added} variant${added === 1 ? "" : "s"} added. ${message}` : message);
            await onSaved(res?.data?.result || null);
        } catch (err) {
            toast.error(err?.response?.data?.message || err?.message || "Failed to update product");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
            {/* Capped to the screen: header and actions stay put, the fields scroll between them
                (a centred box taller than the screen would be cut off at the top). */}
            <div className="bg-white w-full max-w-2xl max-h-[calc(100dvh-2rem)] flex flex-col rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150" role="dialog" aria-modal="true" aria-labelledby="purchase-edit-product-title">
                <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
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

                <form onSubmit={submit} className="flex-1 min-h-0 flex flex-col">
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-4">
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
                                <p className="text-xs font-bold text-slate-800">Variants ({form.variants.length})</p>
                                {form.variants.map((v, idx) => (
                                    <div
                                        key={v.key}
                                        data-testid={v.isNew ? "new-variant" : "variant"}
                                        className={`rounded-xl border p-3 space-y-2 ${v.isNew ? "border-primary/40 bg-primary/5" : "border-slate-200 bg-slate-50/70"}`}
                                    >
                                        <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                                            {v.isNew ? (
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="shrink-0 rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">New</span>
                                                    <input
                                                        className="min-w-0 w-40 px-2 py-1 rounded-lg border border-slate-200 bg-white font-mono text-[11px] uppercase focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                                                        placeholder="SKU (auto)"
                                                        aria-label="New variant SKU"
                                                        maxLength={40}
                                                        value={v.sku}
                                                        onChange={(e) => setVariant(idx, { sku: e.target.value })}
                                                    />
                                                </div>
                                            ) : (
                                                <span className="font-mono truncate">SKU: {v.sku}</span>
                                            )}
                                            <div className="flex items-center gap-2 shrink-0">
                                                <span>{v.isNew ? "Stock: 0 (add on this bill)" : `Stock: ${v.stock}`}</span>
                                                {v.isNew && (
                                                    <button
                                                        type="button"
                                                        onClick={() => removeVariant(v.key)}
                                                        className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                                        aria-label="Remove new variant"
                                                        title="Remove this new variant"
                                                    >
                                                        <HiOutlineTrash className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                                            <div>
                                                <label className={labelCls}>Name{v.isNew || v.isBase ? " *" : ""}</label>
                                                <input
                                                    className={inputCls}
                                                    value={v.name}
                                                    placeholder={v.isNew ? "e.g. 500 g" : undefined}
                                                    aria-label={v.isNew ? "New variant name" : undefined}
                                                    autoFocus={v.key === focusKey}
                                                    onChange={(e) => setVariant(idx, { name: e.target.value })}
                                                />
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
                                            <div>
                                                <label className={labelCls}>Expiry Date</label>
                                                <input
                                                    className={inputCls}
                                                    type="date"
                                                    value={v.expiryDate || ""}
                                                    onChange={(e) => setVariant(idx, { expiryDate: e.target.value })}
                                                    aria-label="Variant expiry date"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                <button
                                    type="button"
                                    onClick={addVariant}
                                    className="w-full flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 px-3 py-2.5 text-xs font-bold text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                                >
                                    <HiOutlinePlus className="h-4 w-4" /> Add variant
                                </button>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
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
                                <div>
                                    <label className={labelCls}>Expiry Date</label>
                                    <input className={inputCls} type="date" value={form.expiryDate || ""} onChange={(e) => set({ expiryDate: e.target.value })} aria-label="Product expiry date" />
                                </div>
                                <div className="col-span-2 sm:col-span-3 pt-1">
                                    <button
                                        type="button"
                                        onClick={addVariant}
                                        className="w-full flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 px-3 py-2.5 text-xs font-bold text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                                    >
                                        <HiOutlinePlus className="h-4 w-4" /> Add variant (sizes, flavours…)
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="p-3 bg-amber-50 border border-amber-200/70 rounded-xl flex items-start gap-2">
                            <HiOutlineExclamationTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                            <p className="text-[11px] text-amber-800 leading-relaxed">
                                This updates the product everywhere (POS and online store); edits may need admin re-approval.
                                Changed cost and GST are also applied to this product's lines on the bill. Stock is not changed here;
                                new variants start at 0 and get their stock from this purchase bill.
                            </p>
                        </div>
                    </div>

                    <div className="shrink-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-white">
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
