import React, { useEffect, useState } from "react";
import { toast } from "sonner";
import { posApi } from "../../services/posApi";
import { businessApi } from "../../services/businessApi";

const METHODS = [
    ["CASH", "Cash"], ["QR", "UPI / QR"], ["CARD", "Card"], ["OTHER", "Other"], ["CREDIT", "Credit (Udhaar)"], ["SPLIT", "Split"],
];
const SPLIT_TENDERS = [["CASH", "Cash"], ["CARD", "Card"], ["QR", "UPI / QR"], ["OTHER", "Other"]];

const resolvePrice = (entity) => {
    const sale = Number(entity?.salePrice || 0);
    const mrp = Number(entity?.price || 0);
    return sale > 0 && sale < mrp ? sale : mrp;
};

const splitFromOrder = (order) => {
    const out = { CASH: "", CARD: "", QR: "", OTHER: "" };
    (order.posPayments || []).forEach((p) => {
        out[p.method] = p.amount;
    });
    return out;
};

/**
 * Audited bill edit: change quantities/prices, discount or payment method.
 * Setting a quantity to 0 removes the line. A reason is mandatory and the
 * server keeps a before/after history. The server blocks the edit once the
 * business day is closed or the bill has returns.
 */
const SaleEditPanel = ({ order, lines, onSaved }) => {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState([]);
    const [discount, setDiscount] = useState(0);
    const [method, setMethod] = useState(order.posPaymentMethod || "CASH");
    const [customers, setCustomers] = useState([]);
    const [customerId, setCustomerId] = useState(order.posCustomer || "");
    const [amountPaid, setAmountPaid] = useState(order.posAmountPaid ?? 0);
    const [reason, setReason] = useState("");
    const [saving, setSaving] = useState(false);
    const [split, setSplit] = useState(() => splitFromOrder(order));
    const [itemSearch, setItemSearch] = useState("");
    const [itemResults, setItemResults] = useState([]);

    useEffect(() => {
        setDraft(lines.map((l) => ({ product: l.product, variantSlot: l.variantSlot || "", name: l.name, quantity: l.quantity, price: l.price })));
        setDiscount(order.paymentBreakdown?.discountTotal || 0);
        setMethod(order.posPaymentMethod || "CASH");
        setCustomerId(order.posCustomer || "");
        setAmountPaid(order.posAmountPaid ?? 0);
        setSplit(splitFromOrder(order));
        setReason("");
    }, [order, lines]);

    // Product search for adding a new line to the bill (server-side, whole catalog).
    useEffect(() => {
        const term = itemSearch.trim();
        if (!open || term.length < 2) {
            setItemResults([]);
            return undefined;
        }
        const t = setTimeout(() => {
            posApi
                .getCatalog({ search: term })
                .then((res) => setItemResults((Array.isArray(res?.data?.results) ? res.data.results : []).slice(0, 8)))
                .catch(() => setItemResults([]));
        }, 300);
        return () => clearTimeout(t);
    }, [itemSearch, open]);

    const addItem = (product, variant) => {
        const variantSlot = variant?.sku || "";
        setDraft((ds) => {
            const idx = ds.findIndex((d) => String(d.product) === String(product._id) && (d.variantSlot || "") === variantSlot);
            if (idx >= 0) return ds.map((d, j) => (j === idx ? { ...d, quantity: Number(d.quantity || 0) + 1 } : d));
            return [
                ...ds,
                {
                    product: product._id,
                    variantSlot,
                    name: variant?.name ? `${product.name} (${variant.name})` : product.name,
                    quantity: 1,
                    price: resolvePrice(variant || product),
                },
            ];
        });
        setItemSearch("");
        setItemResults([]);
    };

    useEffect(() => {
        if (open) businessApi.listCustomers().then((r) => setCustomers(r?.data?.results || r?.data?.result || [])).catch(() => {});
    }, [open]);

    const kept = draft.filter((d) => Number(d.quantity) > 0);
    const subtotal = kept.reduce((s, d) => s + Number(d.price || 0) * Number(d.quantity), 0);
    const total = Math.max(0, subtotal - (Number(discount) || 0));
    const splitLines = SPLIT_TENDERS.map(([m]) => ({ method: m, amount: Number(split[m]) || 0 })).filter((l) => l.amount > 0);
    const splitGap = Math.round((total - splitLines.reduce((s, l) => s + l.amount, 0)) * 100) / 100;
    const splitInvalid = method === "SPLIT" && (splitLines.length < 2 || Math.abs(splitGap) > 0.01);

    const save = async () => {
        setSaving(true);
        try {
            await posApi.editSale(order.orderId, {
                items: kept.map((d) => ({ productId: d.product, variantSku: d.variantSlot || undefined, quantity: Number(d.quantity), price: Number(d.price) })),
                posPaymentMethod: method,
                posCustomerId: customerId || undefined,
                amountPaid: method === "CREDIT" ? Number(amountPaid) || 0 : undefined,
                posPayments: method === "SPLIT" ? splitLines : undefined,
                discount: Number(discount) || 0,
                reason: reason.trim() || "Bill correction",
            });
            toast.success("Bill updated");
            setOpen(false);
            onSaved?.();
        } catch (e) {
            toast.error(e?.response?.data?.message || "Could not edit bill");
        } finally {
            setSaving(false);
        }
    };

    if (!open) {
        return (
            <button type="button" onClick={() => setOpen(true)} className="text-xs font-bold text-primary underline mb-3">
                Edit this bill
            </button>
        );
    }

    const input = "px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white";
    return (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 mb-3 space-y-2">
            <p className="text-xs font-black text-slate-800">Edit bill #{order.orderId} (audited)</p>
            {draft.map((d, i) => (
                <div key={`${d.product}-${d.variantSlot}`} className="flex items-center gap-2">
                    <span className="text-xs flex-1 truncate">{d.name}</span>
                    <input type="number" min="0" className={`${input} w-16`} value={d.quantity}
                        onChange={(e) => setDraft((ds) => ds.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
                    <input type="number" min="0" className={`${input} w-20`} value={d.price}
                        onChange={(e) => setDraft((ds) => ds.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                </div>
            ))}
            <div className="relative">
                <input className={`${input} w-full`} placeholder="Add item — search name / SKU / barcode" value={itemSearch}
                    onChange={(e) => setItemSearch(e.target.value)} />
                {itemResults.length > 0 && (
                    <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                        {itemResults.map((p) => {
                            const variants = Array.isArray(p.variants) ? p.variants : [];
                            if (variants.length > 1) {
                                return variants.map((v) => (
                                    <button key={`${p._id}-${v.sku}`} type="button" onClick={() => addItem(p, v)}
                                        className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-slate-50">
                                        {p.name} <span className="text-slate-500">({v.name || v.sku})</span> — ₹{resolvePrice(v)}
                                    </button>
                                ));
                            }
                            return (
                                <button key={p._id} type="button" onClick={() => addItem(p, variants[0] || null)}
                                    className="w-full text-left px-2.5 py-1.5 text-xs hover:bg-slate-50">
                                    {p.name} — ₹{resolvePrice(variants[0] || p)}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
            <div className="grid grid-cols-2 gap-2">
                <input type="number" min="0" className={input} placeholder="Discount ₹" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                <select className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
                    {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
            </div>
            {method === "CREDIT" && (
                <div className="grid grid-cols-2 gap-2">
                    <select className={input} value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                        <option value="">Select customer</option>
                        {customers.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
                    </select>
                    <input type="number" min="0" className={input} placeholder="Paid now ₹" value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
                </div>
            )}
            {method === "SPLIT" && (
                <div className="space-y-1">
                    <div className="grid grid-cols-4 gap-2">
                        {SPLIT_TENDERS.map(([m, l]) => (
                            <input key={m} type="number" min="0" className={input} placeholder={`${l} ₹`} value={split[m]}
                                onChange={(e) => setSplit((sp) => ({ ...sp, [m]: e.target.value }))} />
                        ))}
                    </div>
                    {splitInvalid && (
                        <p className="text-[10px] font-bold text-rose-600">
                            Split must use at least two tenders and add up to ₹{total.toLocaleString("en-IN")} ({splitGap > 0 ? `₹${splitGap} left` : `₹${-splitGap} over`})
                        </p>
                    )}
                </div>
            )}
            <input className={`${input} w-full`} placeholder="Reason for edit (optional, e.g. quantity adjustment)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex items-center gap-2">
                <span className="text-xs font-bold">New total: ₹{total.toLocaleString("en-IN")}</span>
                <button type="button" onClick={() => setOpen(false)} className="ml-auto text-xs font-bold text-slate-500">Cancel</button>
                <button type="button" disabled={saving || !kept.length || splitInvalid} onClick={save}
                    className="text-xs font-bold px-3 py-1.5 rounded-lg bg-primary text-white disabled:opacity-50">
                    {saving ? "Saving…" : "Save changes"}
                </button>
            </div>
        </div>
    );
};

export default SaleEditPanel;
