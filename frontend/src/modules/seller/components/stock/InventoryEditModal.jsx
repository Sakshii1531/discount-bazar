import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import {
    HiOutlinePencilSquare,
    HiOutlineXMark,
    HiOutlineExclamationTriangle,
    HiOutlinePlus,
    HiOutlineTrash
} from "react-icons/hi2";
import { sellerApi } from "../../services/sellerApi";

const inputCls = "w-full px-3 py-2 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all";
const labelCls = "block text-[11px] font-bold text-slate-600 mb-1";

// Server-computed purchase GST breakdown; never sent back.
const COMPUTED = ["purchaseBasePrice", "purchaseGstAmount", "purchaseFinalPrice"];

const str = (v) => (v === null || v === undefined ? "" : String(v));
const isBlank = (v) => v === "" || v === null || v === undefined;
const num = (v) => Number(v);
const hasValue = (v) => v !== undefined && v !== null && v !== "";

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

// One editable row per variant; a product without variants is a single row.
const formRowsFrom = (p) => {
    if (!p) return [];
    const variants = Array.isArray(p.variants) ? p.variants : [];
    if (!variants.length) {
        return [{
            key: "product",
            isBaseSingle: true,
            label: p.sku || "Product",
            name: p.name || "",
            sku: p.sku || "",
            barcode: p.barcode || "",
            expiryDate: toDateInput(p.expiryDate),
            stock: str(p.stock ?? 0),
            price: str(p.price ?? 0),
            salePrice: str(p.salePrice ?? 0),
            purchaseCost: str(p.purchaseCost ?? ""),
        }];
    }
    return variants.map((v, i) => ({
        key: v.sku || (v._id ? String(v._id) : `variant-${i}`),
        _id: v._id ? String(v._id) : undefined,
        sku: v.sku || "",
        name: v.name || "",
        label: v.name || v.sku || `Variant ${i + 1}`,
        barcode: v.barcode || p.barcode || "",
        expiryDate: toDateInput(v.expiryDate || p.expiryDate),
        stock: str(hasValue(v.stock) ? v.stock : (variants.length === 1 ? (p.stock ?? 0) : 0)),
        price: str(hasValue(v.price) ? v.price : (p.price ?? 0)),
        salePrice: str(hasValue(v.salePrice) ? v.salePrice : (p.salePrice ?? 0)),
        purchaseCost: str(hasValue(v.purchaseCost) ? v.purchaseCost : (p.purchaseCost ?? "")),
    }));
};

/** Returns an error message for the rows, or "" when they can be saved. */
function validate(rows, hasVariants) {
    if (!rows || !rows.length) return "At least one product/variant is required";
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const name = (r.name || "").trim();
        const label = hasVariants ? (name || r.label || `Variant ${i + 1}`) : "Product";

        // Only require variant name if there are multiple variants or if it's a newly added variant
        if (hasVariants && (rows.length > 1 || r.isNew) && !name) {
            return `Please provide a name for Variant #${i + 1}`;
        }

        const stock = num(r.stock);
        if (isBlank(r.stock) || !Number.isInteger(stock) || stock < 0) {
            return `${label}: stock must be a whole number, 0 or more`;
        }
        if (!(num(r.price) > 0)) {
            return `${label}: price must be more than 0`;
        }
        if (!isBlank(r.salePrice) && !(num(r.salePrice) >= 0)) {
            return `${label}: sale price must be 0 or more`;
        }
        if (num(r.salePrice) > num(r.price)) {
            return `${label}: sale price cannot be more than the price`;
        }
        if (!isBlank(r.purchaseCost) && !(num(r.purchaseCost) >= 0)) {
            return `${label}: purchase cost must be 0 or more`;
        }
    }

    if (hasVariants && rows.length > 1) {
        const codes = rows.map((v) => (v.barcode || "").trim()).filter(Boolean);
        if (new Set(codes).size !== codes.length) {
            return "Two variants have the same barcode";
        }
        const names = rows.map((v) => (v.name || "").trim().toLowerCase()).filter(Boolean);
        if (new Set(names).size !== names.length) {
            return "Two variants have the same name";
        }
    }
    return "";
}

/**
 * Edit stock, price, sale price, purchase cost, barcode, expiry date, and variants of a product
 * from Stock Management.
 * Render with key={product._id} so the form resets per product.
 */
const InventoryEditModal = ({ product, onClose, onSaved }) => {
    const [initial] = useState(() => formRowsFrom(product));
    const [rows, setRows] = useState(initial);
    const [reason, setReason] = useState("");
    const [busy, setBusy] = useState(false);

    const hasVariants = !(rows.length === 1 && rows[0]?.isBaseSingle);

    useEffect(() => {
        const onKey = (e) => e.key === "Escape" && !busy && onClose();
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [busy, onClose]);

    const setRow = (idx, patch) =>
        setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

    const addVariant = () => {
        setRows((currentRows) => {
            if (currentRows.length === 1 && currentRows[0]?.isBaseSingle) {
                const baseRow = {
                    ...currentRows[0],
                    key: "base",
                    isBase: true,
                    isBaseSingle: false,
                    name: product?.size || "Standard",
                    label: product?.size || "Standard",
                };
                const newRow = {
                    key: `new-${Date.now()}`,
                    isNew: true,
                    sku: "",
                    name: "",
                    label: "New Variant",
                    stock: "0",
                    price: baseRow.price,
                    salePrice: baseRow.salePrice,
                    purchaseCost: baseRow.purchaseCost,
                    barcode: "",
                    expiryDate: baseRow.expiryDate || "",
                };
                return [baseRow, newRow];
            }

            const last = currentRows[currentRows.length - 1];
            const newRow = {
                key: `new-${Date.now()}`,
                isNew: true,
                sku: "",
                name: "",
                label: `Variant ${currentRows.length + 1}`,
                stock: "0",
                price: last ? last.price : str(product?.price ?? 0),
                salePrice: last ? last.salePrice : str(product?.salePrice ?? 0),
                purchaseCost: last ? last.purchaseCost : str(product?.purchaseCost ?? ""),
                barcode: "",
                expiryDate: last ? last.expiryDate : "",
            };
            return [...currentRows, newRow];
        });
    };

    const removeVariant = (key) => {
        setRows((currentRows) => {
            const remaining = currentRows.filter((r) => r.key !== key);
            if (remaining.length === 1 && remaining[0]?.isBase) {
                // Back to a plain product: restore the product name the base row had.
                return [{
                    ...remaining[0],
                    key: "product",
                    isBaseSingle: true,
                    isBase: false,
                    name: product?.name || "",
                    label: product?.sku || "Product",
                }];
            }
            return remaining;
        });
    };

    const submit = async (e) => {
        e.preventDefault();
        const error = validate(rows, hasVariants);
        if (error) return toast.error(error);

        const productId = product?._id || product?.id;
        if (!productId) {
            return toast.error("Product ID missing");
        }

        const editable = (r) => ({
            name: (r.name || "").trim(),
            price: num(r.price),
            salePrice: isBlank(r.salePrice) ? 0 : num(r.salePrice),
            barcode: (r.barcode || "").trim(),
            expiryDate: r.expiryDate ? r.expiryDate : null,
            ...(isBlank(r.purchaseCost) ? {} : { purchaseCost: num(r.purchaseCost) }),
        });

        let body = {};
        if (hasVariants) {
            const variants = rows.map((r) => {
                if (r.isNew) {
                    return {
                        ...(r.sku?.trim() ? { sku: r.sku.trim().toUpperCase() } : {}),
                        ...editable(r),
                        stock: Math.max(0, num(r.stock) || 0),
                    };
                }
                if (r.isBase) {
                    return {
                        sku: product?.sku || "",
                        size: product?.size || "",
                        colour: product?.colour || "",
                        ...editable(r),
                        stock: product?.stock ?? 0,
                    };
                }
                const orig =
                    (product?.variants || []).find(
                        (v) =>
                            (r.sku && v.sku === r.sku) ||
                            (r._id && v._id && String(v._id) === String(r._id)) ||
                            (v._id && String(v._id) === String(r.key))
                    ) || {};
                const out = { ...orig };
                COMPUTED.forEach((k) => delete out[k]);
                return {
                    ...out,
                    ...editable(r),
                };
            });

            const first = editable(rows[0] || {});
            body = {
                variants,
                price: first.price,
                salePrice: first.salePrice,
                barcode: first.barcode,
                expiryDate: first.expiryDate,
            };
        } else {
            const single = editable(rows[0] || {});
            body = {
                price: single.price,
                salePrice: single.salePrice,
                barcode: single.barcode,
                expiryDate: single.expiryDate,
                ...(isBlank(rows[0]?.purchaseCost) ? {} : { purchaseCost: num(rows[0]?.purchaseCost) }),
            };
        }

        // Determine stock movements for existing items
        const stockMoves = [];
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            if (r.isNew) continue; // New variants have stock initialized via updateProduct
            const init =
                initial.find((o) => (r.sku && o.sku === r.sku) || o.key === r.key) ||
                (i === 0 && initial[0]);
            if (init) {
                const from = num(init.stock);
                const to = num(r.stock);
                if (from !== to) {
                    stockMoves.push({ row: r, from, to });
                }
            }
        }

        const hasStructuralChange =
            hasVariants !== !(initial.length === 1 && initial[0]?.isBaseSingle) ||
            rows.length !== initial.length;
        const hasRowChanges = rows.some((r, i) => {
            const init = initial[i];
            if (!init) return true;
            return (
                (r.name || "").trim() !== (init.name || "").trim() ||
                num(r.price) !== num(init.price) ||
                num(r.salePrice || 0) !== num(init.salePrice || 0) ||
                str(r.purchaseCost) !== str(init.purchaseCost) ||
                (r.barcode || "").trim() !== (init.barcode || "").trim() ||
                (r.expiryDate || "") !== (init.expiryDate || "")
            );
        });

        if (!hasStructuralChange && !hasRowChanges && !stockMoves.length) {
            return onClose();
        }

        setBusy(true);
        let changed = false;
        try {
            if (hasStructuralChange || hasRowChanges) {
                const res = await sellerApi.updateProduct(productId, body);
                changed = true;
                toast.success(res?.data?.message || "Product updated");
            }

            for (const { row, from, to } of stockMoves) {
                let variantSkuToAdjust = undefined;
                if (hasVariants) {
                    if (product?.variants?.length === 1) {
                        variantSkuToAdjust = row.sku || product.variants[0]?.sku || undefined;
                    } else {
                        const origVariant = (product?.variants || []).find((v) =>
                            (row.sku && v.sku === row.sku) ||
                            (row._id && v._id && String(v._id) === String(row._id))
                        );
                        // The product update above has already saved any rename, so a
                        // variant without a SKU must be looked up by its NEW name.
                        variantSkuToAdjust =
                            origVariant?.sku || row.sku || (row.name || "").trim() || undefined;
                    }
                }

                await sellerApi.adjustStock({
                    productId,
                    variantSku: variantSkuToAdjust,
                    type: to > from ? "Restock" : "Correction",
                    quantity: Math.abs(to - from),
                    note: reason.trim() || `Stock set from ${from} to ${to}`,
                });
                changed = true;
            }

            if (stockMoves.length) {
                toast.success("Stock updated");
            }
            await onSaved();
        } catch (err) {
            toast.error(err?.response?.data?.message || err?.message || "Failed to save changes");
            if (changed) await onSaved();
        } finally {
            setBusy(false);
        }
    };

    return (
        <div
            className="fixed inset-0 z-[100] bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
            onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
        >
            <div
                className="bg-white w-full max-w-3xl max-h-[calc(100dvh-2rem)] flex flex-col rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150"
                role="dialog"
                aria-modal="true"
                aria-labelledby="inventory-edit-title"
            >
                <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <div className="h-9 w-9 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                            <HiOutlinePencilSquare className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                            <h3 id="inventory-edit-title" className="text-sm font-black text-slate-900 truncate">
                                Edit Stock, Pricing &amp; Variants
                            </h3>
                            <p className="text-[11px] text-slate-500 font-medium truncate">{product?.name || "Product"}</p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => !busy && onClose()}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                        aria-label="Close"
                    >
                        <HiOutlineXMark className="h-5 w-5" />
                    </button>
                </div>

                <form onSubmit={submit} className="flex-1 min-h-0 flex flex-col">
                    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-6 space-y-4">
                        <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-black text-slate-800 uppercase tracking-wider">
                                {hasVariants ? `Variants (${rows.length})` : "Product Details & Stock"}
                            </p>
                            <button
                                type="button"
                                onClick={addVariant}
                                disabled={busy}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 text-primary hover:bg-primary/20 text-xs font-bold transition-all active:scale-95 cursor-pointer disabled:opacity-50"
                            >
                                <HiOutlinePlus className="h-3.5 w-3.5" />
                                Add Variant
                            </button>
                        </div>

                        {rows.map((r, idx) => (
                            <div
                                key={r.key}
                                className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-3 transition-all hover:border-slate-300"
                            >
                                {hasVariants && (
                                    <div className="flex items-center justify-between gap-3 pb-2.5 border-b border-slate-200/70">
                                        <div className="flex-1 min-w-0">
                                            <label className={labelCls}>Variant Name</label>
                                            <input
                                                className={inputCls}
                                                placeholder="e.g. 500g, Medium, Pack of 2..."
                                                value={r.name}
                                                onChange={(e) => setRow(idx, { name: e.target.value })}
                                                autoFocus={r.isNew}
                                            />
                                        </div>
                                        <div className="flex items-center gap-2 pt-4 shrink-0">
                                            {r.sku && (
                                                <span className="text-[11px] font-mono font-medium text-slate-500 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                                                    SKU: {r.sku}
                                                </span>
                                            )}
                                            {rows.length > 1 && (
                                                <button
                                                    type="button"
                                                    onClick={() => removeVariant(r.key)}
                                                    disabled={busy}
                                                    className="p-2 rounded-xl text-rose-500 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-100 transition-colors disabled:opacity-50"
                                                    title="Remove variant"
                                                >
                                                    <HiOutlineTrash className="h-4 w-4" />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    <div>
                                        <label className={labelCls}>Stock (units)</label>
                                        <input
                                            className={inputCls}
                                            type="number"
                                            min="0"
                                            step="1"
                                            value={r.stock}
                                            onChange={(e) => setRow(idx, { stock: e.target.value })}
                                            autoFocus={idx === 0 && !r.isNew}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Price (₹) *</label>
                                        <input
                                            className={inputCls}
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={r.price}
                                            onChange={(e) => setRow(idx, { price: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Sale price (₹)</label>
                                        <input
                                            className={inputCls}
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={r.salePrice}
                                            onChange={(e) => setRow(idx, { salePrice: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Purchase cost (₹)</label>
                                        <input
                                            className={inputCls}
                                            type="number"
                                            min="0"
                                            step="0.01"
                                            value={r.purchaseCost}
                                            onChange={(e) => setRow(idx, { purchaseCost: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Barcode</label>
                                        <input
                                            className={inputCls}
                                            type="text"
                                            placeholder="e.g. 8901234567890"
                                            value={r.barcode}
                                            onChange={(e) => setRow(idx, { barcode: e.target.value })}
                                        />
                                    </div>
                                    <div>
                                        <label className={labelCls}>Expiry Date</label>
                                        <input
                                            className={inputCls}
                                            type="date"
                                            value={r.expiryDate}
                                            onChange={(e) => setRow(idx, { expiryDate: e.target.value })}
                                        />
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
                                Price, barcode, and variant changes update the product everywhere (POS and online store) and may need admin re-approval.
                                Stock changes are recorded in the stock movement history.
                            </p>
                        </div>
                    </div>

                    <div className="shrink-0 flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 bg-white">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={busy}
                            className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-bold text-slate-700 bg-white hover:bg-slate-50 transition-all cursor-pointer disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={busy}
                            className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold shadow-xs hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer"
                        >
                            {busy ? "Saving…" : "Save Changes"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default InventoryEditModal;
