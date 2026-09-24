import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { businessApi } from "../services/businessApi";
import { posApi } from "../services/posApi";
import {
    HiOutlineSquares2X2,
    HiOutlineShoppingBag,
    HiOutlineBookOpen,
    HiOutlineBanknotes,
    HiOutlineDocumentChartBar,
    HiOutlineBuildingStorefront,
    HiOutlineUsers,
    HiOutlineUserPlus,
    HiOutlinePhone,
    HiOutlineUser,
    HiOutlineMagnifyingGlass,
    HiOutlineArrowUpRight,
    HiOutlineArrowDownLeft,
    HiOutlineCheckCircle,
    HiOutlineExclamationTriangle,
    HiOutlineXMark,
    HiOutlinePlus,
    HiOutlineCalendar,
    HiOutlineArrowPath,
    HiOutlineEye,
    HiOutlineTrash,
    HiOutlinePencilSquare,
    HiOutlineArrowUturnLeft,
} from "react-icons/hi2";

const REPORTS = [
    ["sales", "Sales"], ["purchases", "Purchases"], ["purchase-returns", "Purchase Returns"],
    ["sale-returns", "Sale Returns"], ["stock", "Stock"], ["customer-ledger", "Customer Ledger"],
    ["supplier-ledger", "Supplier Ledger"], ["day-book", "Day Book"], ["cash-register", "Cash Register"],
    ["expenses", "Expenses"], ["pnl", "Profit & Loss"], ["low-stock", "Low Stock"],
];

// Store timezone (loaded from settings); business days follow it, not the browser.
let storeTz = "Asia/Kolkata";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: storeTz }).format(new Date());
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const unwrap = (res) => res?.data?.result ?? res?.data?.data;
const errMsg = (e) => e?.response?.data?.message || e?.message || "Something went wrong";

const inputCls = "w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all";
const btnCls = "px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold shadow-xs hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer flex items-center justify-center gap-1.5";
const ghostBtn = "px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5";

const fmtCell = (k, v) => {
    if (v == null || v === "") return "—";
    if (/date|At$/.test(k) && !Number.isNaN(Date.parse(v))) return new Date(v).toLocaleDateString("en-IN");
    if (typeof v === "number") return /count|units|stock|days|lowStockAlert/i.test(k) ? v : inr(v);
    if (typeof v === "object") return v.name || JSON.stringify(v);
    return String(v);
};

const Table = ({ rows, hide = ["_id", "__v", "seller", "createdAt", "updatedAt", "sellerId"] }) => {
    if (!rows?.length) {
        return (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
                <p className="text-sm font-medium text-slate-400">No records found</p>
            </div>
        );
    }
    const cols = Object.keys(rows[0]).filter((k) => !hide.includes(k) && typeof rows[0][k] !== "object");
    return (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-xs">
                <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-600 uppercase tracking-wider font-bold">
                    <tr>
                        {cols.map((c) => (
                            <th key={c} className="text-left px-4 py-3">
                                {c.replace(/([A-Z])/g, " $1").trim()}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {rows.map((r, i) => (
                        <tr key={r._id || i} className="hover:bg-slate-50/60 transition-colors">
                            {cols.map((c) => (
                                <td key={c} className="px-4 py-3 whitespace-nowrap text-slate-700 font-medium">
                                    {fmtCell(c, r[c])}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

const Stat = ({ label, value, tone = "", icon: Icon }) => (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs flex items-center justify-between">
        <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">{label}</p>
            <p className={`text-xl font-black mt-1 ${tone || "text-slate-900"}`}>{value}</p>
        </div>
        {Icon && (
            <div className="h-10 w-10 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                <Icon className="h-5 w-5" />
            </div>
        )}
    </div>
);

/* ---------- Dashboard ---------- */
const DashboardTab = ({ onNavigateTab }) => {
    const [d, setD] = useState(null);
    useEffect(() => {
        businessApi.dashboard().then((r) => setD(unwrap(r))).catch((e) => toast.error(errMsg(e)));
    }, []);
    if (!d) return <div className="py-12 text-center text-sm text-slate-400">Loading metrics…</div>;

    const lowStockList = Array.isArray(d.lowStock) ? d.lowStock : [];
    const lowStockCount = Number(d.lowStockCount || lowStockList.length || 0);

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label={`Sales today (${d.salesCount})`} value={inr(d.salesToday)} icon={HiOutlineShoppingBag} />
                <Stat label="Purchases today" value={inr(d.purchasesToday)} icon={HiOutlineBuildingStorefront} />
                <Stat label="Profit today" value={inr(d.profitToday)} tone={d.profitToday < 0 ? "text-rose-600" : "text-emerald-600"} icon={HiOutlineBanknotes} />
                <Stat label="Expenses today" value={inr(d.expensesToday)} tone="text-slate-700" icon={HiOutlineArrowUpRight} />
                <Stat label="Stock units" value={d.stockUnits} icon={HiOutlineSquares2X2} />
                <Stat label="Stock value (cost)" value={inr(d.stockValue)} icon={HiOutlineBanknotes} />
                <Stat label="Customer pending" value={inr(d.customerPending)} tone="text-amber-600" icon={HiOutlineUsers} />
                <Stat label="Supplier pending" value={inr(d.supplierPending)} tone="text-amber-600" icon={HiOutlineBuildingStorefront} />
            </div>

            {/* Enhanced Low Stock Alert Card */}
            <div className={cn(
                "rounded-2xl border p-5 shadow-xs space-y-4 bg-white",
                lowStockCount > 0 ? "border-amber-200 ring-1 ring-amber-100/60" : "border-slate-200"
            )}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-3">
                        <div className={cn(
                            "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                            lowStockCount > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                        )}>
                            {lowStockCount > 0 ? (
                                <HiOutlineExclamationTriangle className="h-6 w-6" />
                            ) : (
                                <HiOutlineCheckCircle className="h-6 w-6" />
                            )}
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-black text-slate-900">Low Stock Inventory Alert</h3>
                                {lowStockCount > 0 ? (
                                    <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-100 text-rose-700 border border-rose-200">
                                        {lowStockCount} {lowStockCount === 1 ? "Item Needs Attention" : "Items Need Attention"}
                                    </span>
                                ) : (
                                    <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                                        All Stock Healthy
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">
                                {lowStockCount > 0
                                    ? "These products have reached or breached their minimum alert threshold."
                                    : "All products in your catalog are currently above minimum threshold levels."}
                            </p>
                        </div>
                    </div>

                    {onNavigateTab && lowStockCount > 0 && (
                        <button
                            type="button"
                            onClick={() => onNavigateTab("purchases")}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90 active:scale-95 transition-all shadow-xs cursor-pointer shrink-0"
                        >
                            <HiOutlineShoppingBag className="h-4 w-4" />
                            <span>Create Purchase Bill</span>
                        </button>
                    )}
                </div>

                {lowStockList.length > 0 ? (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-slate-600 uppercase tracking-wider font-bold border-b border-slate-200">
                                <tr>
                                    <th className="text-left px-4 py-3">Product Name</th>
                                    <th className="text-left px-4 py-3">SKU</th>
                                    <th className="text-left px-4 py-3">Current Stock</th>
                                    <th className="text-left px-4 py-3">Min. Stock Limit</th>
                                    <th className="text-right px-4 py-3">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 bg-white">
                                {lowStockList.map((item, idx) => {
                                    const stock = Number(item.stock || 0);
                                    const alertVal = Number(item.lowStockAlert || item.threshold || 0);
                                    const isOut = stock <= 0;
                                    return (
                                        <tr key={item._id || item.sku || idx} className="hover:bg-slate-50/70 transition-colors">
                                            <td className="px-4 py-3 font-bold text-slate-900 text-sm">
                                                {item.name}
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="font-mono text-[11px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded-md border border-slate-200">
                                                    {item.sku || "—"}
                                                </span>
                                            </td>
                                            <td className="px-4 py-3">
                                                {isOut ? (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-100 text-rose-700 border border-rose-200">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-rose-600 animate-pulse" />
                                                        0 (Out of Stock)
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-100 text-amber-800 border border-amber-200">
                                                        <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                                                        {stock} units left
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-slate-600 font-medium">
                                                Below <span className="font-bold text-slate-900">{alertVal}</span> units
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                {isOut ? (
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-black text-rose-600 bg-rose-50 px-2.5 py-1 rounded-md border border-rose-200">
                                                        <HiOutlineExclamationTriangle className="h-3.5 w-3.5" /> Out of Stock
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                                                        Low Stock
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-slate-400 text-sm">
                        No low-stock products found.
                    </div>
                )}
            </div>
        </div>
    );
};

/* ---------- Purchases ---------- */
const emptyLine = { productId: "", variantSku: "", quantity: 1, cost: "", gstPercent: 0 };

const PurchasesTab = () => {
    const [suppliers, setSuppliers] = useState([]);
    const [products, setProducts] = useState([]);
    const [bills, setBills] = useState([]);
    const [form, setForm] = useState({ supplierId: "", billNo: "", amountPaid: "", paymentMethod: "CASH" });
    const [lines, setLines] = useState([{ ...emptyLine }]);
    const [editingId, setEditingId] = useState(null);
    const [busy, setBusy] = useState(false);
    const [ret, setRet] = useState(null);

    const load = useCallback(() => {
        businessApi.listPurchases().then((r) => setBills(unwrap(r) || []));
        businessApi.listSuppliers().then((r) => setSuppliers(unwrap(r) || []));
    }, []);
    useEffect(() => {
        load();
        posApi.getCatalog({}).then((r) => setProducts(unwrap(r) || []));
    }, [load]);

    const total = useMemo(
        () => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.cost) || 0) * (1 + (Number(l.gstPercent) || 0) / 100), 0),
        [lines],
    );

    const setLine = (i, patch) => setLines((ls) => ls.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, ...patch };
        if (patch.productId) {
            const p = products.find((x) => x._id === patch.productId);
            next.variantSku = p?.variants?.length === 1 ? p.variants[0].sku : "";
            if (p) { next.cost = p.purchaseCost || next.cost; next.gstPercent = p.gstPercent || 0; }
        }
        if (patch.variantSku) {
            const v = products.find((x) => x._id === next.productId)?.variants?.find((x) => x.sku === patch.variantSku);
            if (v?.purchaseCost) next.cost = v.purchaseCost;
        }
        return next;
    }));

    const payload = (confirm) => ({
        supplierId: form.supplierId,
        billNo: form.billNo,
        amountPaid: Number(form.amountPaid) || 0,
        paymentMethod: form.paymentMethod,
        confirm,
        items: lines.filter((l) => l.productId).map((l) => ({
            productId: l.productId, variantSku: l.variantSku || "", quantity: Number(l.quantity), cost: Number(l.cost), gstPercent: Number(l.gstPercent) || 0,
        })),
    });

    const reset = () => {
        setEditingId(null);
        setForm({ supplierId: "", billNo: "", amountPaid: "", paymentMethod: "CASH" });
        setLines([{ ...emptyLine }]);
    };

    const save = async (confirm) => {
        setBusy(true);
        try {
            if (editingId) await businessApi.updatePurchase(editingId, payload(false));
            else await businessApi.createPurchase(payload(confirm));
            toast.success(editingId ? "Bill updated" : confirm ? "Bill confirmed — stock increased" : "Draft saved");
            reset();
            load();
        } catch (e) { toast.error(errMsg(e)); } finally { setBusy(false); }
    };

    const act = async (fn, msg) => {
        try { await fn(); toast.success(msg); load(); } catch (e) { toast.error(errMsg(e)); }
    };

    const edit = (b) => {
        setEditingId(b._id);
        setForm({ supplierId: b.supplier?._id || b.supplier, billNo: b.billNo, amountPaid: b.amountPaid, paymentMethod: b.paymentMethod || "CASH" });
        setLines(b.items.map((i) => ({ productId: i.product, variantSku: i.variantSku || "", quantity: i.quantity, cost: i.cost, gstPercent: i.gstPercent })));
        window.scrollTo({ top: 0, behavior: "smooth" });
    };

    const submitReturn = async () => {
        try {
            await businessApi.createPurchaseReturn({
                supplierId: ret.supplierId, purchaseBillId: ret.billId, reason: ret.reason,
                items: [{ productId: ret.productId, variantSku: ret.variantSku, quantity: Number(ret.quantity), cost: Number(ret.cost) }],
            });
            toast.success("Purchase return recorded — stock reduced");
            setRet(null);
            load();
        } catch (e) { toast.error(errMsg(e)); }
    };

    return (
        <div className="space-y-5">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                            <HiOutlineShoppingBag className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-slate-900">{editingId ? "Edit Purchase Bill" : "New Purchase Bill"}</h3>
                            <p className="text-xs text-slate-500">Record incoming stock and payments from wholesale suppliers</p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Select Supplier *</label>
                        <select className={inputCls} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                            <option value="">— Choose supplier —</option>
                            {suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Bill / Invoice No.</label>
                        <input className={`${inputCls} uppercase`} autoCapitalize="characters" placeholder="e.g. INV-9042" value={form.billNo} onChange={(e) => setForm({ ...form, billNo: e.target.value.toUpperCase() })} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Amount Paid Now (₹)</label>
                        <input className={inputCls} type="number" min="0" placeholder="Paid now (₹)" value={form.amountPaid} onChange={(e) => setForm({ ...form, amountPaid: e.target.value })} />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">Payment Method</label>
                        <select className={inputCls} value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}>
                            {["CASH", "UPI", "CARD", "OTHER"].map((m) => <option key={m}>{m}</option>)}
                        </select>
                    </div>
                </div>

                <div className="space-y-2 border-t border-slate-100 pt-3">
                    <p className="text-xs font-bold text-slate-700">Line Items</p>
                    {lines.map((l, i) => (
                        <div key={i} className="grid grid-cols-2 md:grid-cols-[2fr_1.2fr_1fr_1fr_1fr_auto] gap-2 items-center bg-slate-50/50 p-2.5 rounded-xl border border-slate-100">
                            <select className={`${inputCls} col-span-2 md:col-span-1`} value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
                                <option value="">Select product</option>
                                {products.map((p) => <option key={p._id} value={p._id}>{p.name}{p.barcode ? ` · ${p.barcode}` : ""}</option>)}
                            </select>
                            {products.find((x) => x._id === l.productId)?.variants?.length > 0 && (
                                <select className={`${inputCls} col-span-2 md:col-span-1`} value={l.variantSku} onChange={(e) => setLine(i, { variantSku: e.target.value })}>
                                    <option value="">Variant…</option>
                                    {products.find((x) => x._id === l.productId).variants.map((v) => <option key={v.sku} value={v.sku}>{v.name || v.sku}</option>)}
                                </select>
                            )}
                            <input className={inputCls} type="number" min="1" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                            <input className={inputCls} type="number" min="0" placeholder="Cost" value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })} />
                            <input className={inputCls} type="number" min="0" placeholder="GST %" value={l.gstPercent} onChange={(e) => setLine(i, { gstPercent: e.target.value })} />
                            <button type="button" className="p-2 text-slate-400 hover:text-rose-600 rounded-lg" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, x) => x !== i) : ls))}>
                                <HiOutlineTrash className="h-4 w-4" />
                            </button>
                        </div>
                    ))}
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button type="button" className={ghostBtn} onClick={() => setLines((ls) => [...ls, { ...emptyLine }])}>
                        <HiOutlinePlus className="h-4 w-4" /> Add Line Item
                    </button>
                    <div className="ml-auto text-right">
                        <span className="text-xs text-slate-500 font-medium mr-2">Total (incl. GST):</span>
                        <span className="text-base font-black text-slate-900">{inr(total)}</span>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 pt-2 border-t border-slate-100">
                    {editingId ? (
                        <>
                            <button className={ghostBtn} onClick={reset}>Cancel Edit</button>
                            <button className={btnCls} disabled={busy} onClick={() => save(false)}>Save Changes</button>
                        </>
                    ) : (
                        <>
                            <button className={ghostBtn} disabled={busy} onClick={() => save(false)}>Save Draft</button>
                            <button className={btnCls} disabled={busy || !form.supplierId} onClick={() => save(true)}>
                                <HiOutlineCheckCircle className="h-4 w-4" /> Save & Confirm (Adds Stock)
                            </button>
                        </>
                    )}
                </div>
            </div>

            {ret && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 space-y-3">
                    <p className="font-bold text-sm text-amber-900">Purchase Return — {ret.name}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <input className={inputCls} type="number" min="1" value={ret.quantity} onChange={(e) => setRet({ ...ret, quantity: e.target.value })} placeholder="Qty" />
                        <input className={inputCls} type="number" min="0" value={ret.cost} onChange={(e) => setRet({ ...ret, cost: e.target.value })} placeholder="Cost" />
                        <input className={inputCls} value={ret.reason} onChange={(e) => setRet({ ...ret, reason: e.target.value })} placeholder="Reason for return" />
                    </div>
                    <div className="flex gap-2">
                        <button className={btnCls} onClick={submitReturn}>Return to Supplier</button>
                        <button className={ghostBtn} onClick={() => setRet(null)}>Close</button>
                    </div>
                </div>
            )}

            <div className="space-y-3">
                <h4 className="text-sm font-bold text-slate-900">Purchase History ({bills.length})</h4>
                {bills.map((b) => (
                    <div key={b._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                            <span className="font-black text-slate-900">#{b.billNo || "NO-NUMBER"}</span>
                            <span className="text-slate-600 font-medium">· {b.supplier?.name}</span>
                            <span className="text-slate-400 text-xs">({new Date(b.billDate).toLocaleDateString("en-IN")})</span>
                            <span className="ml-auto font-black text-slate-900">{inr(b.total)}</span>
                            <span className={cn(
                                "text-[10px] font-black px-2.5 py-0.5 rounded-full",
                                b.status === "CONFIRMED" ? "bg-emerald-100 text-emerald-800" :
                                b.status === "CANCELLED" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"
                            )}>
                                {b.status}
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-2">{b.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</p>
                        {b.status !== "CANCELLED" && (
                            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
                                {b.status === "DRAFT" && (
                                    <button className={btnCls} onClick={() => act(() => businessApi.confirmPurchase(b._id), "Confirmed — stock increased")}>
                                        <HiOutlineCheckCircle className="h-4 w-4" /> Confirm
                                    </button>
                                )}
                                <button className={ghostBtn} onClick={() => edit(b)}>
                                    <HiOutlinePencilSquare className="h-3.5 w-3.5" /> Edit
                                </button>
                                {b.status === "CONFIRMED" && (
                                    <button className={ghostBtn} onClick={() => setRet({ supplierId: b.supplier?._id, billId: b._id, productId: b.items[0].product, variantSku: b.items[0].variantSku || "", name: b.items[0].name, quantity: 1, cost: b.items[0].cost, reason: "" })}>
                                        <HiOutlineArrowUturnLeft className="h-3.5 w-3.5" /> Return Item
                                    </button>
                                )}
                                <button className="px-3 py-1.5 rounded-xl border border-rose-200 text-xs font-bold text-rose-600 hover:bg-rose-50 transition-colors ml-auto cursor-pointer" onClick={() => window.confirm("Cancel this bill? Stock will be reversed.") && act(() => businessApi.cancelPurchase(b._id), "Cancelled")}>
                                    Cancel Bill
                                </button>
                            </div>
                        )}
                    </div>
                ))}
                {!bills.length && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-400 text-sm">
                        No purchase bills recorded yet
                    </div>
                )}
            </div>
        </div>
    );
};

/* ---------- Suppliers / Customers ledger ---------- */
const capitalizeWords = (str) => {
    return String(str || "").replace(/(?:^|\s)\S/g, (char) => char.toUpperCase());
};

const PartiesTab = () => {
    const [kind, setKind] = useState("suppliers");
    const [rows, setRows] = useState([]);
    const [searchTerm, setSearchTerm] = useState("");
    const [form, setForm] = useState({ name: "", phone: "" });
    const [touched, setTouched] = useState({ name: false, phone: false });
    const [ledger, setLedger] = useState(null);
    const [pay, setPay] = useState({ amount: "", method: "CASH" });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const partyType = kind === "suppliers" ? "SUPPLIER" : "CUSTOMER";

    const load = useCallback(() => {
        (kind === "suppliers" ? businessApi.listSuppliers() : businessApi.listCustomers()).then((r) => setRows(unwrap(r) || []));
    }, [kind]);
    useEffect(() => {
        load();
        setLedger(null);
        setSearchTerm("");
        setForm({ name: "", phone: "" });
        setTouched({ name: false, phone: false });
    }, [load]);

    // Validation computations
    const nameTrimmed = form.name.trim();
    const isNameTooShort = touched.name && nameTrimmed.length > 0 && nameTrimmed.length < 2;
    const isNameOnlyNumbers = touched.name && nameTrimmed.length >= 2 && /^\d+$/.test(nameTrimmed);
    const isNameValid = nameTrimmed.length >= 2 && !/^\d+$/.test(nameTrimmed);

    const phoneClean = form.phone.trim();
    const phoneDigits = phoneClean.replace(/\D/g, "");
    const isPhoneInvalid = touched.phone && phoneClean.length > 0 && (phoneDigits.length < 10 || phoneDigits.length > 13);
    const isPhoneValid = !phoneClean || (phoneDigits.length >= 10 && phoneDigits.length <= 13);

    const isFormValid = isNameValid && isPhoneValid;

    const handleNameChange = (e) => {
        const formatted = capitalizeWords(e.target.value);
        setForm((prev) => ({ ...prev, name: formatted }));
        if (!touched.name) setTouched((prev) => ({ ...prev, name: true }));
    };

    const handlePhoneChange = (e) => {
        // Only accept numbers and optional leading +
        let val = e.target.value.replace(/[^\d+]/g, "");
        if (val.indexOf("+") > 0) {
            val = val.replace(/\+/g, "");
        }
        if (val.length > 15) val = val.slice(0, 15);
        setForm((prev) => ({ ...prev, phone: val }));
        if (!touched.phone) setTouched((prev) => ({ ...prev, phone: true }));
    };

    const add = async () => {
        setTouched({ name: true, phone: true });
        if (!isNameValid) {
            if (nameTrimmed.length < 2) {
                toast.error("Please enter a valid name (at least 2 characters)");
            } else if (/^\d+$/.test(nameTrimmed)) {
                toast.error("Name cannot contain only numbers");
            }
            return;
        }
        if (!isPhoneValid) {
            toast.error("Please enter a valid 10-digit phone number or leave it blank");
            return;
        }
        setIsSubmitting(true);
        try {
            const payload = {
                name: capitalizeWords(nameTrimmed),
                phone: phoneClean,
            };
            await (kind === "suppliers" ? businessApi.saveSupplier(payload) : businessApi.saveCustomer(payload));
            toast.success(`${kind === "suppliers" ? "Supplier" : "Customer"} added successfully`);
            setForm({ name: "", phone: "" });
            setTouched({ name: false, phone: false });
            load();
        } catch (e) {
            toast.error(errMsg(e));
        } finally {
            setIsSubmitting(false);
        }
    };

    const open = async (p) => {
        try {
            const r = await businessApi.partyLedger(kind, p._id);
            setLedger({ party: p, ...unwrap(r) });
        } catch (e) {
            toast.error(errMsg(e));
        }
    };

    const pay1 = async () => {
        try {
            await businessApi.recordPayment({ partyType, partyId: ledger.party._id, amount: Number(pay.amount), method: pay.method });
            toast.success("Payment recorded");
            setPay({ amount: "", method: "CASH" });
            open(ledger.party);
            load();
        } catch (e) {
            toast.error(errMsg(e));
        }
    };

    const filteredRows = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter((r) => (r.name || "").toLowerCase().includes(q) || (r.phone || "").includes(q));
    }, [rows, searchTerm]);

    return (
        <div className="space-y-5">
            {/* Segmented Switcher */}
            <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-2xl w-fit">
                <button
                    type="button"
                    onClick={() => setKind("suppliers")}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
                        kind === "suppliers" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                    )}
                >
                    <HiOutlineBuildingStorefront className="h-4 w-4" />
                    <span>Supplier Ledger</span>
                </button>
                <button
                    type="button"
                    onClick={() => setKind("customers")}
                    className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
                        kind === "customers" ? "bg-white text-slate-900 shadow-xs" : "text-slate-500 hover:text-slate-800"
                    )}
                >
                    <HiOutlineUsers className="h-4 w-4" />
                    <span>Customer Ledger (Udhaar)</span>
                </button>
            </div>

            {/* Enhanced Add Party Card */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2.5">
                        <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                            <HiOutlineUserPlus className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-slate-900">
                                Add New {kind === "suppliers" ? "Supplier / Vendor" : "Customer (Udhaar Khata)"}
                            </h3>
                            <p className="text-xs text-slate-500">
                                {kind === "suppliers"
                                    ? "Register a wholesaler/distributor to manage purchase invoices and payments"
                                    : "Register a walk-in counter customer to enable credit (udhaar) sales at POS"}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] gap-3 items-start">
                    <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                            {kind === "suppliers" ? "Supplier Name" : "Customer Name"} <span className="text-rose-500">*</span>
                        </label>
                        <div className="relative">
                            <HiOutlineUser className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <input
                                autoCapitalize="words"
                                className={cn(
                                    "w-full pl-10 pr-3.5 py-2.5 rounded-xl border text-sm capitalize transition-all outline-none",
                                    (isNameTooShort || isNameOnlyNumbers)
                                        ? "border-rose-400 bg-rose-50/20 focus:border-rose-500 focus:ring-2 focus:ring-rose-200/50"
                                        : "border-slate-200 bg-slate-50/50 focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20"
                                )}
                                placeholder={kind === "suppliers" ? "e.g. Mahavir Textiles" : "e.g. Ramesh Kumar"}
                                value={form.name}
                                onChange={handleNameChange}
                                onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
                                onKeyDown={(e) => e.key === "Enter" && add()}
                                maxLength={100}
                            />
                        </div>
                        {isNameTooShort && (
                            <p className="text-[11px] text-rose-600 mt-1 font-medium">
                                Name must be at least 2 characters long
                            </p>
                        )}
                        {isNameOnlyNumbers && (
                            <p className="text-[11px] text-rose-600 mt-1 font-medium">
                                Name cannot contain only numbers
                            </p>
                        )}
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1">
                            Phone Number <span className="text-slate-400 font-normal">(Optional, 10 Digits)</span>
                        </label>
                        <div className="relative">
                            <HiOutlinePhone className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                            <input
                                type="tel"
                                inputMode="numeric"
                                className={cn(
                                    "w-full pl-10 pr-3.5 py-2.5 rounded-xl border text-sm transition-all outline-none",
                                    isPhoneInvalid
                                        ? "border-rose-400 bg-rose-50/20 focus:border-rose-500 focus:ring-2 focus:ring-rose-200/50"
                                        : "border-slate-200 bg-slate-50/50 focus:bg-white focus:border-primary focus:ring-2 focus:ring-primary/20"
                                )}
                                placeholder="e.g. 9876543210"
                                value={form.phone}
                                onChange={handlePhoneChange}
                                onBlur={() => setTouched((prev) => ({ ...prev, phone: true }))}
                                onKeyDown={(e) => e.key === "Enter" && add()}
                                maxLength={15}
                            />
                        </div>
                        {isPhoneInvalid && (
                            <p className="text-[11px] text-rose-600 mt-1 font-medium">
                                Enter a valid 10-digit phone number
                            </p>
                        )}
                    </div>

                    <div className="pt-0 sm:pt-6">
                        <button
                            type="button"
                            disabled={!isFormValid || isSubmitting}
                            onClick={add}
                            className={cn(
                                "w-full sm:w-auto h-[42px] px-6 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-xs",
                                isFormValid && !isSubmitting
                                    ? "bg-primary text-white hover:bg-primary/90 active:scale-95 cursor-pointer"
                                    : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed"
                            )}
                            title={!isFormValid ? "Please enter a valid name and phone to enable" : ""}
                        >
                            <HiOutlineUserPlus className="h-4 w-4" />
                            <span>{isSubmitting ? "Adding..." : `Add ${kind === "suppliers" ? "Supplier" : "Customer"}`}</span>
                        </button>
                    </div>
                </div>

                {!nameTrimmed && (
                    <p className="text-[11px] text-slate-400 flex items-center gap-1">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
                        Type a name in the box above to enable the "Add" button.
                    </p>
                )}
            </div>

            {/* Parties Directory List */}
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-black text-slate-900">
                            {kind === "suppliers" ? "Supplier Directory" : "Customer (Udhaar) Directory"} ({rows.length})
                        </h3>
                        <p className="text-xs text-slate-500">
                            {kind === "suppliers"
                                ? "Manage your suppliers, outstanding dues, and payment statements"
                                : "Track counter customer credit balances and collect due payments"}
                        </p>
                    </div>
                    <div className="relative w-full sm:w-64">
                        <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search name or phone..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 text-xs bg-slate-50 focus:bg-white focus:border-primary outline-none transition-colors"
                        />
                    </div>
                </div>

                {filteredRows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center space-y-1">
                        <p className="text-sm font-bold text-slate-600">
                            {searchTerm ? "No matching records found" : `No ${kind === "suppliers" ? "suppliers" : "customers"} registered yet`}
                        </p>
                        <p className="text-xs text-slate-400">
                            {searchTerm ? "Try searching with a different term" : "Use the form above to add your first entry."}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-100">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50 text-slate-500 uppercase tracking-wider font-bold border-b border-slate-200">
                                <tr>
                                    <th className="text-left px-4 py-3">Party Name</th>
                                    <th className="text-left px-4 py-3">Phone</th>
                                    <th className="text-left px-4 py-3">
                                        {kind === "suppliers" ? "Payable (You Owe)" : "Outstanding Due (Receivable)"}
                                    </th>
                                    <th className="text-right px-4 py-3">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredRows.map((p) => {
                                    const balance = Number(p.balance || 0);
                                    return (
                                        <tr key={p._id} className="hover:bg-slate-50/70 transition-colors">
                                            <td className="px-4 py-3">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="h-8 w-8 rounded-full bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0 border border-slate-200">
                                                        {(p.name || "?")[0].toUpperCase()}
                                                    </div>
                                                    <span className="font-bold text-slate-900 text-sm">{p.name}</span>
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 text-slate-600">
                                                {p.phone ? (
                                                    <span className="inline-flex items-center gap-1 text-slate-700 font-medium">
                                                        <HiOutlinePhone className="h-3.5 w-3.5 text-slate-400" />
                                                        {p.phone}
                                                    </span>
                                                ) : (
                                                    <span className="text-slate-400 italic">None</span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3">
                                                {balance === 0 ? (
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                        <HiOutlineCheckCircle className="h-3 w-3" /> Settled (₹0)
                                                    </span>
                                                ) : (
                                                    <span className={cn(
                                                        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-black border",
                                                        kind === "suppliers"
                                                            ? "bg-rose-50 text-rose-700 border-rose-200"
                                                            : "bg-amber-50 text-amber-700 border-amber-200"
                                                    )}>
                                                        {inr(balance)}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => open(p)}
                                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 text-primary hover:bg-primary hover:text-white font-bold text-xs transition-all cursor-pointer active:scale-95"
                                                >
                                                    <HiOutlineEye className="h-3.5 w-3.5" />
                                                    <span>View Ledger</span>
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Ledger Statement Drawer / Modal */}
            {ledger && (
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-md space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-base font-black text-slate-900">{ledger.party.name}</h3>
                                <span className="text-xs text-slate-500 font-medium">({kind === "suppliers" ? "Supplier" : "Customer"})</span>
                            </div>
                            <p className="text-xs text-slate-500">
                                {ledger.party.phone ? `Phone: ${ledger.party.phone}` : "No phone provided"}
                            </p>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="text-right">
                                <p className="text-[10px] uppercase font-bold text-slate-400">Current Balance</p>
                                <p className={cn(
                                    "text-lg font-black",
                                    ledger.balance > 0 ? (kind === "suppliers" ? "text-rose-600" : "text-amber-600") : "text-emerald-600"
                                )}>
                                    {inr(ledger.balance)}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => setLedger(null)}
                                className="h-8 w-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center cursor-pointer transition-colors"
                            >
                                <HiOutlineXMark className="h-5 w-5" />
                            </button>
                        </div>
                    </div>

                    {/* Record Payment Sub-Card */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-2.5">
                        <p className="text-xs font-bold text-slate-800">
                            Record Payment {kind === "suppliers" ? "Made to Supplier" : "Received from Customer"}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                            <input
                                className={inputCls}
                                type="number"
                                min="0"
                                placeholder={kind === "suppliers" ? "Amount paid (₹)" : "Amount received (₹)"}
                                value={pay.amount}
                                onChange={(e) => setPay({ ...pay, amount: e.target.value })}
                            />
                            <select className={inputCls} value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })}>
                                {["CASH", "UPI", "CARD", "OTHER"].map((m) => <option key={m}>{m}</option>)}
                            </select>
                            <button className={btnCls} disabled={!Number(pay.amount)} onClick={pay1}>
                                Save Payment
                            </button>
                        </div>
                    </div>

                    {/* Statement Table */}
                    <div className="space-y-2">
                        <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">Transaction Statement</p>
                        <Table
                            rows={ledger.entries.map((e) => ({
                                date: e.date,
                                kind: e.kind,
                                refNo: e.refNo || "—",
                                method: e.method || "—",
                                debit: e.effect === 1 ? inr(e.amount) : "—",
                                credit: e.effect === -1 ? inr(e.amount) : "—",
                                balance: inr(e.balance),
                            }))}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

/* ---------- Day book, expenses, cash ---------- */
const CashTab = () => {
    const [tz, setTz] = useState(storeTz);
    const [date, setDate] = useState(today());
    useEffect(() => {
        businessApi.getSettings().then((r) => {
            const z = unwrap(r)?.timezone;
            if (z) { storeTz = z; setTz(z); setDate(today()); }
        }).catch(() => {});
    }, []);
    const [book, setBook] = useState(null);
    const [opening, setOpening] = useState("");
    const [counted, setCounted] = useState("");
    const [exp, setExp] = useState({ category: "", amount: "", method: "CASH" });
    const [entry, setEntry] = useState({ direction: "IN", amount: "", note: "" });

    const load = useCallback(() => {
        businessApi.cashToday(date).then((r) => setBook(unwrap(r))).catch((e) => toast.error(errMsg(e)));
    }, [date]);
    useEffect(load, [load]);

    const run = async (fn, msg, reset) => {
        try { await fn(); toast.success(msg); reset?.(); load(); } catch (e) { toast.error(errMsg(e)); }
    };

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 bg-white p-3 rounded-2xl border border-slate-200">
                <input type="date" className={`${inputCls} max-w-[180px]`} value={date} onChange={(e) => setDate(e.target.value)} />
                <input className={`${inputCls} max-w-[200px]`} value={tz} onChange={(e) => setTz(e.target.value)} placeholder="Timezone e.g. Asia/Kolkata" />
                <button className={ghostBtn} onClick={() => run(() => businessApi.saveSettings({ timezone: tz }).then(() => { storeTz = tz; }), "Timezone saved")}>
                    <HiOutlineCheckCircle className="h-4 w-4" /> Save Timezone
                </button>
            </div>
            {book && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="Opening cash" value={inr(book.openingCash)} icon={HiOutlineBanknotes} />
                    <Stat label="Cash sales" value={inr(book.cashSales)} tone="text-emerald-600" icon={HiOutlineShoppingBag} />
                    <Stat label="UPI / Card / Online" value={inr(book.digitalTotal)} tone="text-primary" icon={HiOutlineBanknotes} />
                    <Stat label="Expenses" value={inr(book.expensesTotal)} tone="text-rose-600" icon={HiOutlineArrowUpRight} />
                    <Stat label="Cash in (total)" value={inr(book.cashIn)} tone="text-emerald-600" icon={HiOutlineArrowDownLeft} />
                    <Stat label="Cash out (total)" value={inr(book.cashOut)} tone="text-rose-600" icon={HiOutlineArrowUpRight} />
                    <Stat label="Closing cash (expected)" value={inr(book.closingCash)} tone="text-emerald-600" icon={HiOutlineBanknotes} />
                    <Stat label="Day status" value={book.closed ? "Closed" : "Open"} tone={book.closed ? "text-rose-600 font-bold" : "text-emerald-600 font-bold"} icon={HiOutlineCalendar} />
                </div>
            )}
            <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
                    <p className="font-bold text-sm text-slate-900">Opening / Counted Closing Cash</p>
                    <input className={inputCls} type="number" min="0" placeholder="Opening cash (₹)" value={opening} onChange={(e) => setOpening(e.target.value)} />
                    <input className={inputCls} type="number" min="0" placeholder="Counted closing cash (₹)" value={counted} onChange={(e) => setCounted(e.target.value)} />
                    <button className={btnCls} disabled={opening === ""} onClick={() => run(() => businessApi.setOpening({ dateKey: date, openingCash: Number(opening), ...(counted !== "" && { countedClosingCash: Number(counted) }) }), "Saved")}>
                        Save Cash Figures
                    </button>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
                    <p className="font-bold text-sm text-slate-900">Close / Reopen Day</p>
                    <p className="text-xs text-slate-500 leading-relaxed">
                        Closing locks this day against any new bills, expenses, payments, or purchases to preserve your daily cash register reconciliation.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                        {book?.closed ? (
                            <button className={ghostBtn} onClick={() => run(() => businessApi.reopenDay({ dateKey: date }), "Day reopened")}>
                                <HiOutlineArrowPath className="h-4 w-4" /> Reopen Day
                            </button>
                        ) : (
                            <button className="px-4 py-2 rounded-xl bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 active:scale-95 transition-all cursor-pointer" onClick={() => window.confirm("Close " + date + "? Counted cash: " + (counted || "not entered")) && run(() => businessApi.closeDay({ dateKey: date, ...(counted !== "" && { countedClosingCash: Number(counted) }) }), "Day closed")}>
                                Close Day
                            </button>
                        )}
                    </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
                    <p className="font-bold text-sm text-slate-900">Add Store Expense</p>
                    <input className={`${inputCls} capitalize`} autoCapitalize="words" placeholder="Category (e.g. Tea / Snacks, Rent, Stationery)" value={exp.category} onChange={(e) => setExp({ ...exp, category: capitalizeWords(e.target.value) })} />
                    <div className="grid grid-cols-2 gap-2">
                        <input className={inputCls} type="number" min="0" placeholder="Amount (₹)" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} />
                        <select className={inputCls} value={exp.method} onChange={(e) => setExp({ ...exp, method: e.target.value })}>
                            {["CASH", "UPI", "CARD", "OTHER"].map((m) => <option key={m}>{m}</option>)}
                        </select>
                    </div>
                    <button className={btnCls} disabled={!Number(exp.amount)} onClick={() => run(() => businessApi.addExpense({ category: exp.category || "General", amount: Number(exp.amount), method: exp.method, date: new Date(`${date}T12:00:00+05:30`) }), "Expense added", () => setExp({ category: "", amount: "", method: "CASH" }))}>
                        Add Expense
                    </button>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
                    <p className="font-bold text-sm text-slate-900">Manual Cash In / Cash Out</p>
                    <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr_2fr] gap-2">
                        <select className={inputCls} value={entry.direction} onChange={(e) => setEntry({ ...entry, direction: e.target.value })}>
                            <option>IN</option>
                            <option>OUT</option>
                        </select>
                        <input className={inputCls} type="number" min="0" placeholder="Amount" value={entry.amount} onChange={(e) => setEntry({ ...entry, amount: e.target.value })} />
                        <input className={inputCls} placeholder="Note (e.g. Owner withdrawal)" value={entry.note} onChange={(e) => setEntry({ ...entry, note: e.target.value })} />
                    </div>
                    <button className={btnCls} disabled={!Number(entry.amount)} onClick={() => run(() => businessApi.addCashEntry({ direction: entry.direction, amount: Number(entry.amount), note: entry.note, date: new Date(`${date}T12:00:00+05:30`) }), "Recorded", () => setEntry({ direction: "IN", amount: "", note: "" }))}>
                        Record Cash Flow
                    </button>
                </div>
            </div>
        </div>
    );
};

/* ---------- Reports ---------- */
const ReportsTab = () => {
    const [type, setType] = useState("sales");
    const [from, setFrom] = useState(today());
    const [to, setTo] = useState(today());
    const [data, setData] = useState(null);

    useEffect(() => {
        setData(null);
        businessApi.report(type, { from, to }).then((r) => setData(unwrap(r))).catch((e) => toast.error(errMsg(e)));
    }, [type, from, to]);

    const rows = useMemo(() => (data?.rows || []).map((r) => (r.digitalSales ? { ...r, ...r.digitalSales, digitalSales: undefined } : r)), [data]);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap gap-2 items-center bg-white p-3 rounded-2xl border border-slate-200">
                <select className={`${inputCls} max-w-[200px]`} value={type} onChange={(e) => setType(e.target.value)}>
                    {REPORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <div className="flex items-center gap-1 text-xs text-slate-500 font-bold">
                    <span>From:</span>
                    <input type="date" className={`${inputCls} max-w-[150px]`} value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="flex items-center gap-1 text-xs text-slate-500 font-bold">
                    <span>To:</span>
                    <input type="date" className={`${inputCls} max-w-[150px]`} value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
            </div>
            {data?.totals && (
                <div className="flex flex-wrap gap-2 text-xs">
                    {Object.entries(data.totals).map(([k, v]) => (
                        <span key={k} className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 font-bold text-slate-700 shadow-xs">
                            {k}: <span className="text-primary font-black">{typeof v === "number" ? fmtCell(k, v) : v}</span>
                        </span>
                    ))}
                </div>
            )}
            {data ? <Table rows={rows} /> : <div className="py-8 text-center text-sm text-slate-400">Loading report data…</div>}
        </div>
    );
};

// URL section (/seller/business/:section) <-> internal tab key
const SECTION_TO_TAB = { purchases: "purchases", ledgers: "parties", cash: "cash", reports: "reports" };
const TAB_TO_PATH = {
    dashboard: "/seller/business",
    purchases: "/seller/business/purchases",
    parties: "/seller/business/ledgers",
    cash: "/seller/business/cash",
    reports: "/seller/business/reports",
};

const Business = () => {
    const { section } = useParams();
    const navigate = useNavigate();
    const tab = SECTION_TO_TAB[section] || "dashboard";
    const setTab = (k) => navigate(TAB_TO_PATH[k] || TAB_TO_PATH.dashboard);
    return (
        <div className="space-y-5 max-w-[1400px] mx-auto pb-10">
            {/* Page Header */}
            <div>
                <h1 className="text-xl font-black text-slate-900 tracking-tight">Business & Khata Book</h1>
                <p className="text-xs text-slate-500 mt-0.5">
                    Manage purchases, customer udhaar ledgers, supplier accounts, and daily cash register
                </p>
            </div>

            {/* Tab Views */}
            {tab === "dashboard" && <DashboardTab onNavigateTab={setTab} />}
            {tab === "purchases" && <PurchasesTab />}
            {tab === "parties" && <PartiesTab />}
            {tab === "cash" && <CashTab />}
            {tab === "reports" && <ReportsTab />}
        </div>
    );
};

export default Business;
