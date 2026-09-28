import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { businessApi } from "../services/businessApi";
import { posApi } from "../services/posApi";
import { sellerApi } from "../services/sellerApi";
import { formatPriceInteger } from "@shared/utils/currency";
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
    HiOutlineDocumentText,
    HiOutlinePrinter,
    HiOutlineCube,
    HiOutlineClock,
} from "react-icons/hi2";

const REPORTS = [
    ["sales", "Sales"], ["purchases", "Purchases"], ["purchase-returns", "Purchase Returns"],
    ["sale-returns", "Sale Returns"], ["stock", "Stock"], ["customer-ledger", "Customer Ledger"],
    ["supplier-ledger", "Supplier Ledger"], ["day-book", "Day Book"], ["cash-register", "Cash Register"],
    ["expenses", "Expenses"], ["pnl", "Profit & Loss"], ["low-stock", "Low Stock"],
    ["expiry", "Expiry Report"],
];

// Store timezone (loaded from settings); business days follow it, not the browser.
let storeTz = "Asia/Kolkata";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: storeTz }).format(new Date());
// Amounts/totals are rounded up to the whole rupee (same as checkout); unit rates stay exact.
const inr = (n) => `${Number(n || 0) < 0 ? "-" : ""}₹${Math.abs(formatPriceInteger(n)).toLocaleString("en-IN")}`;
const inrExact = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const unwrap = (res) => res?.data?.results ?? res?.data?.result ?? res?.data?.data;
const errMsg = (e) => e?.response?.data?.message || e?.message || "Something went wrong";

const inputCls = "w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all";
const btnCls = "px-4 py-2.5 rounded-xl bg-primary text-white text-sm font-bold shadow-xs hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none cursor-pointer flex items-center justify-center gap-1.5";
const ghostBtn = "px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5";

const fmtCell = (k, v) => {
    if (v == null || v === "") return "—";
    if (/date|At$/.test(k) && !Number.isNaN(Date.parse(v))) return new Date(v).toLocaleDateString("en-IN");
    if (typeof v === "number") {
        if (/count|units|stock|days|lowStockAlert/i.test(k)) return v;
        return /(cost|price|rate|mrp)$/i.test(k) ? inrExact(v) : inr(v);
    }
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

/* ---------- Expiry Report & Tracker Card ---------- */
const ExpiryReportCard = ({ items = [], totals = {}, onNavigateTab }) => {
    const [filter, setFilter] = useState("all");
    const [specificDate, setSpecificDate] = useState("");
    const [searchTerm, setSearchTerm] = useState("");

    const totalCount = Number(totals.count || items.length || 0);
    const expiredCount = Number(totals.expired || items.filter(i => i.daysLeft < 0).length || 0);
    const todayCount = Number(totals.today || items.filter(i => i.daysLeft === 0).length || 0);
    const tomorrowCount = Number(totals.tomorrow || items.filter(i => i.daysLeft === 1).length || 0);
    const next7DaysCount = Number(totals.next7Days || items.filter(i => i.daysLeft >= 0 && i.daysLeft <= 7).length || 0);
    const next30DaysCount = Number(totals.next30Days || items.filter(i => i.daysLeft >= 0 && i.daysLeft <= 30).length || 0);

    const hasUrgentAlerts = expiredCount > 0 || todayCount > 0 || next7DaysCount > 0;

    const filteredItems = useMemo(() => {
        let list = Array.isArray(items) ? [...items] : [];

        if (searchTerm.trim()) {
            const q = searchTerm.trim().toLowerCase();
            list = list.filter(i =>
                (i.name && i.name.toLowerCase().includes(q)) ||
                (i.sku && i.sku.toLowerCase().includes(q)) ||
                (i.barcode && i.barcode.toLowerCase().includes(q))
            );
        }

        if (specificDate) {
            list = list.filter(i => {
                if (!i.expiryDate) return false;
                const dateStr = new Date(i.expiryDate).toISOString().slice(0, 10);
                return dateStr === specificDate;
            });
            return list;
        }

        if (filter === "expired") {
            list = list.filter(i => i.daysLeft < 0);
        } else if (filter === "7days") {
            list = list.filter(i => i.daysLeft >= 0 && i.daysLeft <= 7);
        } else if (filter === "30days") {
            list = list.filter(i => i.daysLeft >= 0 && i.daysLeft <= 30);
        }

        return list;
    }, [items, filter, specificDate, searchTerm]);

    const handleDateChange = (dateVal) => {
        setSpecificDate(dateVal);
        if (dateVal) {
            setFilter("custom_date");
        } else {
            setFilter("all");
        }
    };

    const clearDate = () => {
        setSpecificDate("");
        setFilter("all");
    };

    return (
        <div className={cn(
            "rounded-2xl border p-5 shadow-xs space-y-4 bg-white",
            hasUrgentAlerts ? "border-amber-200 ring-1 ring-amber-100/60" : "border-slate-200"
        )}>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-3">
                    <div className={cn(
                        "h-10 w-10 rounded-xl flex items-center justify-center shrink-0",
                        expiredCount > 0 ? "bg-rose-100 text-rose-700" :
                        next7DaysCount > 0 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                    )}>
                        <HiOutlineClock className="h-6 w-6" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-sm font-black text-slate-900">Product Expiry Report & Tracker</h3>
                            {expiredCount > 0 ? (
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-100 text-rose-700 border border-rose-200">
                                    {expiredCount} {expiredCount === 1 ? "Expired Product" : "Expired Products"}
                                </span>
                            ) : next7DaysCount > 0 ? (
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                    {next7DaysCount} Expiring This Week
                                </span>
                            ) : totalCount > 0 ? (
                                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700 border border-emerald-200">
                                    All Dates Healthy
                                </span>
                            ) : null}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Track upcoming product expirations, filter by exact day, and manage stock.
                        </p>
                    </div>
                </div>

                {onNavigateTab && (
                    <button
                        type="button"
                        onClick={() => onNavigateTab("products")}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50 active:scale-95 transition-all shadow-xs cursor-pointer shrink-0"
                    >
                        <HiOutlineCube className="h-4 w-4" />
                        <span>Manage Products</span>
                    </button>
                )}
            </div>

            {/* Clean Controls Toolbar */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                {/* Segmented Filter Pills */}
                <div className="flex items-center gap-1 p-1 bg-slate-100/80 rounded-xl border border-slate-200/60 w-fit">
                    {[
                        { id: "all", label: "All Items", count: totalCount },
                        { id: "7days", label: "Expiring Soon", count: next7DaysCount, highlight: true },
                        { id: "expired", label: "Expired", count: expiredCount, isDanger: true },
                        { id: "30days", label: "In 30 Days", count: next30DaysCount },
                    ].map((tab) => {
                        const isActive = !specificDate && filter === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => {
                                    setSpecificDate("");
                                    setFilter(tab.id);
                                }}
                                className={cn(
                                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap",
                                    isActive
                                        ? "bg-white text-slate-900 shadow-xs"
                                        : "text-slate-600 hover:text-slate-900"
                                )}
                            >
                                <span>{tab.label}</span>
                                {tab.count > 0 ? (
                                    <span className={cn(
                                        "px-1.5 py-0.2 rounded-full text-[10px] font-black",
                                        isActive
                                            ? (tab.isDanger ? "bg-rose-100 text-rose-700" : "bg-slate-900 text-white")
                                            : (tab.isDanger ? "bg-rose-100 text-rose-700" : tab.highlight ? "bg-amber-100 text-amber-800" : "bg-slate-200/80 text-slate-700")
                                    )}>
                                        {tab.count}
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>

                {/* Right: Date Picker & Search */}
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                    {/* Specific Day Picker */}
                    <div className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs transition-all bg-white",
                        specificDate ? "border-primary ring-2 ring-primary/10 text-primary font-bold shadow-xs" : "border-slate-200 text-slate-600"
                    )}>
                        <HiOutlineCalendar className="h-4 w-4 text-slate-400 shrink-0" />
                        <span className="text-[11px] font-bold text-slate-500 whitespace-nowrap">Filter Day:</span>
                        <input
                            type="date"
                            value={specificDate}
                            onChange={(e) => handleDateChange(e.target.value)}
                            className="text-xs font-semibold text-slate-800 bg-transparent outline-none cursor-pointer"
                            title="Select a specific date to view products expiring on that day"
                        />
                        {specificDate && (
                            <button
                                type="button"
                                onClick={clearDate}
                                className="text-slate-400 hover:text-rose-600 transition-colors p-0.5 rounded-full"
                                title="Clear date filter"
                            >
                                <HiOutlineXMark className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Search */}
                    <div className="relative min-w-[180px] sm:w-52">
                        <HiOutlineMagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <input
                            type="text"
                            placeholder="Search product / SKU..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-8 pr-7 py-1.5 rounded-xl border border-slate-200 text-xs bg-white focus:outline-none focus:border-primary transition-all placeholder:text-slate-400"
                        />
                        {searchTerm && (
                            <button
                                type="button"
                                onClick={() => setSearchTerm("")}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                            >
                                <HiOutlineXMark className="h-3 w-3" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Specific Date Active Pill */}
            {specificDate && (
                <div className="flex items-center justify-between px-3.5 py-2 bg-blue-50/70 border border-blue-100 rounded-xl text-xs text-blue-900 font-medium">
                    <div className="flex items-center gap-2">
                        <HiOutlineCalendar className="h-4 w-4 text-blue-600 shrink-0" />
                        <span>
                            Showing products expiring on: <strong className="font-bold">{new Date(`${specificDate}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</strong> ({filteredItems.length} found)
                        </span>
                    </div>
                    <button
                        type="button"
                        onClick={clearDate}
                        className="text-xs font-bold text-blue-600 hover:text-blue-800 underline cursor-pointer"
                    >
                        View all dates
                    </button>
                </div>
            )}

            {/* Table */}
            {filteredItems.length > 0 ? (
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50/80 text-slate-500 uppercase tracking-wider font-bold border-b border-slate-200">
                            <tr>
                                <th className="text-left px-4 py-3">Product Name</th>
                                <th className="text-left px-4 py-3">SKU / Barcode</th>
                                <th className="text-left px-4 py-3">Available Stock</th>
                                <th className="text-left px-4 py-3">Expiry Date</th>
                                <th className="text-right px-4 py-3">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                            {filteredItems.map((item, idx) => {
                                const stock = Number(item.stock || 0);
                                const days = item.daysLeft;
                                const isExpired = days < 0;
                                const isToday = days === 0;
                                const isTomorrow = days === 1;

                                return (
                                    <tr key={item._id || item.sku || idx} className="hover:bg-slate-50/70 transition-colors">
                                        <td className="px-4 py-3 font-bold text-slate-900 text-sm capitalize">
                                            {item.name}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="font-mono text-[11px] bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded-md border border-slate-200">
                                                {item.sku || item.barcode || "—"}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-slate-800 font-bold">
                                            {stock} units
                                        </td>
                                        <td className="px-4 py-3 font-medium text-slate-800">
                                            <div className="inline-flex items-center gap-1.5">
                                                <HiOutlineCalendar className="h-3.5 w-3.5 text-slate-400" />
                                                <span>
                                                    {new Date(item.expiryDate).toLocaleDateString("en-IN", {
                                                        day: "2-digit",
                                                        month: "short",
                                                        year: "numeric"
                                                    })}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {isExpired ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-black text-rose-700 bg-rose-100 px-2.5 py-1 rounded-md border border-rose-200">
                                                    <HiOutlineExclamationTriangle className="h-3.5 w-3.5 text-rose-600" />
                                                    Expired ({Math.abs(days)}d ago)
                                                </span>
                                            ) : isToday ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-black text-rose-600 bg-rose-50 px-2.5 py-1 rounded-md border border-rose-200">
                                                    Expires Today
                                                </span>
                                            ) : isTomorrow ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-800 bg-amber-100 px-2.5 py-1 rounded-md border border-amber-200">
                                                    Expires Tomorrow
                                                </span>
                                            ) : days <= 7 ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md border border-amber-200">
                                                    In {days} days
                                                </span>
                                            ) : days <= 30 ? (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
                                                    In {days} days
                                                </span>
                                            ) : (
                                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-50 px-2.5 py-1 rounded-md border border-slate-200">
                                                    In {days} days
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
                <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center space-y-2">
                    <p className="text-sm font-bold text-slate-600">
                        {specificDate
                            ? "No products found expiring on this selected date."
                            : searchTerm
                            ? "No products matching your search term."
                            : totalCount === 0
                            ? "No products with expiry dates recorded yet."
                            : "No products found matching this filter."}
                    </p>
                    <p className="text-xs text-slate-400 max-w-md mx-auto">
                        {totalCount === 0
                            ? "Set expiry dates when adding or editing products to track shelf-life and avoid stock loss."
                            : "Try selecting 'All Items' or clearing the date picker to view all tracked products."}
                    </p>
                    {(specificDate || filter !== "all" || searchTerm) && (
                        <button
                            type="button"
                            onClick={() => {
                                setSpecificDate("");
                                setFilter("all");
                                setSearchTerm("");
                            }}
                            className="text-xs font-bold text-primary hover:underline cursor-pointer pt-1"
                        >
                            Reset all filters
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

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
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                <Stat label={`Sales today (${d.salesCount})`} value={inr(d.salesToday)} icon={HiOutlineShoppingBag} />
                <Stat label="Purchases today" value={inr(d.purchasesToday)} icon={HiOutlineBuildingStorefront} />
                <Stat label="Profit today" value={inr(d.profitToday)} tone={d.profitToday < 0 ? "text-rose-600" : "text-emerald-600"} icon={HiOutlineBanknotes} />
                <Stat label="Expenses today" value={inr(d.expensesToday)} tone="text-slate-700" icon={HiOutlineArrowUpRight} />
                <Stat label="Stock units" value={d.stockUnits} icon={HiOutlineSquares2X2} />
                <Stat label="Stock value (cost)" value={inr(d.stockValue)} icon={HiOutlineBanknotes} />
                <Stat label="Customer pending" value={inr(d.customerPending)} tone="text-amber-600" icon={HiOutlineUsers} />
                <Stat label="Supplier pending" value={inr(d.supplierPending)} tone="text-amber-600" icon={HiOutlineBuildingStorefront} />
                <Stat label="Expiring (30d)" value={d.expiryTotals?.next30Days || 0} tone={(d.expiryTotals?.next7Days || 0) > 0 ? "text-amber-600" : "text-slate-900"} icon={HiOutlineClock} />
                <Stat label="Expired items" value={d.expiryTotals?.expired || 0} tone={(d.expiryTotals?.expired || 0) > 0 ? "text-rose-600" : "text-slate-400"} icon={HiOutlineExclamationTriangle} />
            </div>

            {/* Product Expiry Report & Tracker Card */}
            <ExpiryReportCard
                items={d.expiryAlerts || []}
                totals={d.expiryTotals || {}}
                onNavigateTab={onNavigateTab}
            />

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
    const navigate = useNavigate();
    const location = useLocation();
    const [suppliers, setSuppliers] = useState([]);
    const [products, setProducts] = useState([]);
    const [bills, setBills] = useState([]);
    const [form, setForm] = useState({ supplierId: "", billNo: "", amountPaid: "", paymentMethod: "CASH" });
    const [lines, setLines] = useState([{ ...emptyLine }]);
    const [editingId, setEditingId] = useState(null);
    const [busy, setBusy] = useState(false);
    const [ret, setRet] = useState(null);
    const [invoiceBill, setInvoiceBill] = useState(null);
    const [dbCategories, setDbCategories] = useState([]);
    const [isQuickProductOpen, setIsQuickProductOpen] = useState(false);
    const [targetLineIndex, setTargetLineIndex] = useState(null);
    const [quickBusy, setQuickBusy] = useState(false);
    const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
    const [supplierForm, setSupplierForm] = useState({ name: "", phone: "" });
    const [supplierBusy, setSupplierBusy] = useState(false);
    const hasSupplier = Boolean(form.supplierId);
    const [quickProd, setQuickProd] = useState({
        name: "",
        header: "",
        category: "",
        subcategory: "",
        price: "",
        variantName: "Standard",
        sku: "",
        barcode: "",
    });

    const makeSku = (name, index = 1) => {
        const prefix = String(name || "")
            .trim()
            .replace(/[^a-zA-Z0-9]/g, "")
            .slice(0, 5)
            .toUpperCase() || "ITEM";
        return `${prefix}-${String(index).padStart(3, "0")}`;
    };

    // Restore draft if returning from Add Product page
    useEffect(() => {
        try {
            const rawDraft = sessionStorage.getItem("seller_purchases_draft");
            if (rawDraft) {
                const parsed = JSON.parse(rawDraft);
                if (parsed.form) setForm((f) => ({ ...f, ...parsed.form }));
                if (Array.isArray(parsed.lines) && parsed.lines.length > 0) {
                    setLines(parsed.lines);
                }
                if (parsed.targetLineIndex !== undefined && parsed.targetLineIndex !== null) {
                    setTargetLineIndex(parsed.targetLineIndex);
                }
                sessionStorage.removeItem("seller_purchases_draft");
            }
        } catch (e) {}
    }, []);

    const load = useCallback(() => {
        businessApi.listPurchases().then((r) => setBills(unwrap(r) || []));
        businessApi.listSuppliers().then((r) => setSuppliers(unwrap(r) || []));
    }, []);
    useEffect(() => {
        load();
        posApi.getCatalog({}).then((r) => {
            const list = unwrap(r) || [];
            setProducts(list);
            const createdId = location.state?.createdProductId;
            if (createdId) {
                const targetIdx = location.state?.targetLineIndex;
                setLines((prevLines) => {
                    const idx = targetIdx !== undefined && targetIdx !== null && targetIdx < prevLines.length
                        ? targetIdx
                        : 0;
                    return prevLines.map((line, i) => i === idx ? { ...line, productId: createdId } : line);
                });
            }
        });
        sellerApi.getCategoryTree().then((r) => {
            const cats = r.data?.results || r.data?.result || [];
            setDbCategories(cats);
        }).catch(() => {});
    }, [load, location.state]);

    const openAddSupplier = () => {
        setSupplierForm({ name: "", phone: "" });
        setIsSupplierModalOpen(true);
    };

    const handleCreateSupplier = async (e) => {
        e?.preventDefault();
        const name = capitalizeWords(supplierForm.name.trim());
        const phone = supplierForm.phone.trim();
        const phoneDigits = phone.replace(/\D/g, "");
        if (name.length < 2) {
            toast.error("Please enter a valid name (at least 2 characters)");
            return;
        }
        if (/^\d+$/.test(name)) {
            toast.error("Name cannot contain only numbers");
            return;
        }
        if (phone && (phoneDigits.length < 10 || phoneDigits.length > 13)) {
            toast.error("Please enter a valid 10-digit phone number or leave it blank");
            return;
        }
        setSupplierBusy(true);
        try {
            const res = await businessApi.saveSupplier({ name, phone });
            const created = unwrap(res);
            const list = unwrap(await businessApi.listSuppliers()) || [];
            setSuppliers(list);
            const createdId = created?._id || list.find((x) => x.name === name)?._id;
            if (createdId) setForm((f) => ({ ...f, supplierId: createdId }));
            toast.success("Supplier added and selected");
            setIsSupplierModalOpen(false);
        } catch (err) {
            toast.error(errMsg(err));
        } finally {
            setSupplierBusy(false);
        }
    };

    const openQuickAddProduct = (lineIdx = null) => {
        try {
            sessionStorage.setItem(
                "seller_purchases_draft",
                JSON.stringify({ form, lines, targetLineIndex: lineIdx })
            );
        } catch (e) {}
        navigate("/seller/products/add?returnTo=/seller/business/purchases", {
            state: { returnTo: "/seller/business/purchases", targetLineIndex: lineIdx }
        });
    };

    const handleCreateQuickProduct = async (e) => {
        e?.preventDefault();
        const trimmedName = quickProd.name.trim();
        if (!trimmedName) {
            toast.error("Please enter a product name");
            return;
        }
        if (!quickProd.header || !quickProd.category || !quickProd.subcategory) {
            toast.error("Please select Main Group, Category, and Sub-Category");
            return;
        }
        const priceNum = Number(quickProd.price);
        if (!quickProd.price || priceNum <= 0) {
            toast.error("Please enter a valid Selling Price (MRP)");
            return;
        }

        setQuickBusy(true);
        try {
            const data = new FormData();
            data.append("name", trimmedName);
            const sku = quickProd.sku.trim().toUpperCase() || makeSku(trimmedName, 1);
            data.append("sku", sku);
            data.append("price", priceNum);
            data.append("salePrice", priceNum);
            data.append("stock", 0);
            data.append("headerId", quickProd.header);
            data.append("categoryId", quickProd.category);
            data.append("subcategoryId", quickProd.subcategory);
            data.append("status", "active");

            if (quickProd.barcode.trim()) {
                data.append("barcode", quickProd.barcode.trim());
            }

            const variantItem = {
                id: Date.now(),
                name: quickProd.variantName.trim() || "Standard",
                price: priceNum,
                salePrice: priceNum,
                stock: 0,
                sku: sku,
                barcode: quickProd.barcode.trim(),
            };
            data.append("variants", JSON.stringify([variantItem]));

            const res = await sellerApi.createProduct(data);
            const created = res.data?.result || res.data?.results;

            // Refresh catalog
            const catRes = await posApi.getCatalog({});
            const updated = unwrap(catRes) || [];
            setProducts(updated);

            const createdId = created?._id || created?.id || updated.find((p) => p.name === trimmedName)?._id;

            if (targetLineIndex != null) {
                setLine(targetLineIndex, { productId: createdId, variantSku: sku });
            } else {
                setLines((prev) => [...prev, { ...emptyLine, productId: createdId, variantSku: sku }]);
            }

            toast.success(`"${trimmedName}" created and added to bill!`);
            setIsQuickProductOpen(false);
        } catch (err) {
            toast.error(err?.response?.data?.message || err.message || "Failed to create product");
        } finally {
            setQuickBusy(false);
        }
    };

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
                        <div className="flex items-center gap-1.5">
                            <select className={inputCls} value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                                <option value="">— Choose supplier —</option>
                                {suppliers.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
                            </select>
                            <button
                                type="button"
                                onClick={openAddSupplier}
                                className="shrink-0 px-2.5 py-2.5 rounded-xl border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 active:scale-95 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                                title="Add new supplier"
                            >
                                <HiOutlineUserPlus className="h-3.5 w-3.5" />
                                <span className="hidden xl:inline text-xs">New</span>
                            </button>
                        </div>
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

                <div className="space-y-3 border-t border-slate-100 pt-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                        <p className="text-xs font-bold text-slate-800 uppercase tracking-wider">Purchase Items & Stock Inward</p>
                        <p className="text-[11px] text-slate-500 font-medium">Enter incoming stock quantity and purchase cost received from supplier</p>
                    </div>

                    {!hasSupplier && (
                        <div className="p-3 bg-amber-50/80 border border-amber-200/70 rounded-xl flex items-start gap-2">
                            <HiOutlineExclamationTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                            <p className="text-[11px] text-amber-800 leading-relaxed">
                                Select a supplier first (or add a new one) to add or select products for this bill.
                            </p>
                        </div>
                    )}

                    {/* Column Headers for clarity */}
                    <div className="hidden md:grid md:grid-cols-[2fr_1.2fr_1.1fr_1.1fr_0.9fr_auto] gap-2 px-2 text-[11px] font-bold text-slate-600 uppercase tracking-wide">
                        <span>1. Product Name *</span>
                        <span>2. Variant / Unit</span>
                        <span>3. Stock Qty (Piece/Kg) *</span>
                        <span>4. Purchase Cost (₹) *</span>
                        <span>5. GST %</span>
                        <span className="w-8"></span>
                    </div>

                    {lines.map((l, i) => {
                        const prod = products.find((x) => x._id === l.productId);
                        const hasVariants = prod?.variants?.length > 0;
                        return (
                            <div key={i} className="grid grid-cols-2 md:grid-cols-[2fr_1.2fr_1.1fr_1.1fr_0.9fr_auto] gap-2 items-end md:items-center bg-slate-50/80 p-3 rounded-xl border border-slate-200">
                                <div className="col-span-2 md:col-span-1">
                                    <div className="flex items-center justify-between md:hidden mb-1">
                                        <label className="text-[10px] font-bold text-slate-600">Product Name *</label>
                                        <button
                                            type="button"
                                            onClick={() => openQuickAddProduct(i)}
                                            className="text-[10px] font-bold text-primary hover:underline flex items-center gap-0.5"
                                        >
                                            <HiOutlinePlus className="h-3 w-3" /> New
                                        </button>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <select
                                            className={cn(inputCls, !hasSupplier && "bg-slate-100 text-slate-400 cursor-not-allowed")}
                                            disabled={!hasSupplier}
                                            title={!hasSupplier ? "Select a supplier first" : undefined}
                                            value={l.productId}
                                            onChange={(e) => setLine(i, { productId: e.target.value })}
                                        >
                                            <option value="">{hasSupplier ? "— Select product —" : "— Select supplier first —"}</option>
                                            {products.map((p) => <option key={p._id} value={p._id}>{p.name}{p.barcode ? ` · ${p.barcode}` : ""}</option>)}
                                        </select>
                                        <button
                                            type="button"
                                            onClick={() => openQuickAddProduct(i)}
                                            className="shrink-0 px-2.5 py-2.5 rounded-xl border border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 active:scale-95 text-xs font-bold transition-all cursor-pointer flex items-center gap-1"
                                            title="Add new product"
                                        >
                                            <HiOutlinePlus className="h-3.5 w-3.5" />
                                            <span className="hidden xl:inline text-xs">New</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="col-span-2 md:col-span-1">
                                    <label className="block md:hidden text-[10px] font-bold text-slate-600 mb-1">Variant / Unit</label>
                                    {hasVariants ? (
                                        <select className={inputCls} disabled={!hasSupplier} value={l.variantSku} onChange={(e) => setLine(i, { variantSku: e.target.value })}>
                                            <option value="">— Choose variant —</option>
                                            {prod.variants.map((v) => <option key={v.sku} value={v.sku}>{v.name || v.sku}</option>)}
                                        </select>
                                    ) : (
                                        <select disabled className={`${inputCls} bg-slate-100 text-slate-400 cursor-not-allowed`}>
                                            <option>Standard (No Variant)</option>
                                        </select>
                                    )}
                                </div>
                                <div>
                                    <label className="block md:hidden text-[10px] font-bold text-slate-600 mb-1">Stock Qty *</label>
                                    <input className={inputCls} type="number" min="1" placeholder="Stock Qty (e.g. 50)" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} title="Stock quantity received" />
                                </div>
                                <div>
                                    <label className="block md:hidden text-[10px] font-bold text-slate-600 mb-1">Purchase Cost (₹) *</label>
                                    <input className={inputCls} type="number" min="0" step="0.01" placeholder="Cost Price ₹ (per unit)" value={l.cost} onChange={(e) => setLine(i, { cost: e.target.value })} title="Cost price per unit" />
                                </div>
                                <div>
                                    <label className="block md:hidden text-[10px] font-bold text-slate-600 mb-1">GST %</label>
                                    <input className={inputCls} type="number" min="0" placeholder="GST % (e.g. 0)" value={l.gstPercent} onChange={(e) => setLine(i, { gstPercent: e.target.value })} />
                                </div>
                                <div className="flex justify-end">
                                    <button type="button" className="p-2 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer" title="Remove Item" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, x) => x !== i) : ls))}>
                                        <HiOutlineTrash className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                    <button type="button" className={`${ghostBtn} disabled:opacity-40 disabled:pointer-events-none`} disabled={!hasSupplier} title={!hasSupplier ? "Select a supplier first" : undefined} onClick={() => setLines((ls) => [...ls, { ...emptyLine }])}>
                        <HiOutlinePlus className="h-4 w-4" /> Add Line Item
                    </button>
                    <button
                        type="button"
                        title="Add new product"
                        className="px-3 py-1.5 rounded-xl border border-primary/30 text-xs font-bold text-primary bg-primary/5 hover:bg-primary/10 active:scale-95 transition-all cursor-pointer flex items-center gap-1.5"
                        onClick={() => openQuickAddProduct(null)}
                    >
                        <HiOutlinePlus className="h-4 w-4" /> Add New Product
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
                <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-5 space-y-4">
                    <div>
                        <p className="font-black text-sm text-amber-950">Purchase Return — {ret.name}</p>
                        <p className="text-xs text-amber-800/80 mt-0.5">Return damaged or expired stock to the supplier. This reduces inventory and adjusts supplier balance.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-amber-950 mb-1">Return Quantity (Pieces/Kg) *</label>
                            <input className={inputCls} type="number" min="1" value={ret.quantity} onChange={(e) => setRet({ ...ret, quantity: e.target.value })} placeholder="Return quantity" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-amber-950 mb-1">Cost Price (₹ per unit) *</label>
                            <input className={inputCls} type="number" min="0" step="0.01" value={ret.cost} onChange={(e) => setRet({ ...ret, cost: e.target.value })} placeholder="Cost price ₹" />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-amber-950 mb-1">Reason for Return *</label>
                            <input className={inputCls} value={ret.reason} onChange={(e) => setRet({ ...ret, reason: e.target.value })} placeholder="e.g. Damaged, Expired, Defective" />
                        </div>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                        <button className="px-4 py-2.5 rounded-xl bg-amber-800 text-white text-xs font-bold hover:bg-amber-900 active:scale-95 transition-all cursor-pointer shadow-xs" onClick={submitReturn}>Return to Supplier</button>
                        <button className={ghostBtn} onClick={() => setRet(null)}>Close</button>
                    </div>
                </div>
            )}

            <div className="space-y-3">
                <h4 className="text-sm font-bold text-slate-900">Purchase History ({bills.length})</h4>
                {bills.map((b) => (
                    <div key={b._id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-black text-slate-900">#{b.billNo || "NO-NUMBER"}</span>
                                <span className="text-slate-600 font-medium">· {b.supplier?.name}</span>
                                <span className="text-slate-400 text-xs">({new Date(b.billDate).toLocaleDateString("en-IN")})</span>
                            </div>
                            <span className={cn(
                                "text-[10px] font-black px-2.5 py-0.5 rounded-full",
                                b.status === "CONFIRMED" ? "bg-emerald-100 text-emerald-800" :
                                b.status === "CANCELLED" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"
                            )}>
                                {b.status}
                            </span>
                        </div>

                        {/* Payment & Balance Breakdown */}
                        <div className="flex flex-wrap items-center justify-between gap-2 my-2 py-2 border-y border-slate-100 text-xs">
                            <div className="flex flex-wrap items-center gap-2.5">
                                <span className="text-slate-600">Total: <strong className="text-slate-900 text-sm font-black">{inr(b.total)}</strong></span>
                                <span className="text-slate-300">|</span>
                                <span className="text-slate-600">Paid: <strong className="text-emerald-700 font-bold">{inr(b.amountPaid || 0)}</strong></span>
                                <span className="text-slate-300">|</span>
                                <span className="text-slate-600">
                                    Due (Udhaar): <strong className={Number(b.total - (b.amountPaid || 0)) > 0 ? "text-rose-600 font-bold" : "text-emerald-600 font-bold"}>
                                        {inr(Math.max(0, b.total - (b.amountPaid || 0)))}
                                    </strong>
                                </span>
                            </div>
                            <div>
                                {Number(b.amountPaid || 0) <= 0 ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                        Unpaid (Credit / Udhaar)
                                    </span>
                                ) : Number(b.amountPaid || 0) < Number(b.total) ? (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                                        Partially Paid
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                        Fully Paid
                                    </span>
                                )}
                            </div>
                        </div>

                        <p className="text-xs text-slate-500 mt-1">{b.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}</p>
                        {b.status !== "CANCELLED" && (
                            <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
                                {b.status === "DRAFT" && (
                                    <button className={btnCls} onClick={() => act(() => businessApi.confirmPurchase(b._id), "Confirmed — stock increased")}>
                                        <HiOutlineCheckCircle className="h-4 w-4" /> Confirm
                                    </button>
                                )}
                                <button className={ghostBtn} onClick={() => setInvoiceBill(b)}>
                                    <HiOutlineDocumentText className="h-3.5 w-3.5 text-primary" /> View Invoice
                                </button>
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

            {/* Purchase Invoice Modal */}
            {invoiceBill && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
                    <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
                            <div className="flex items-center gap-2.5">
                                <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                                    <HiOutlineDocumentText className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-slate-900">Purchase Invoice #{invoiceBill.billNo}</h3>
                                    <p className="text-[11px] text-slate-500 font-medium">
                                        {new Date(invoiceBill.billDate).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => window.print()}
                                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 active:scale-95 transition-all cursor-pointer shadow-xs"
                                >
                                    <HiOutlinePrinter className="h-4 w-4" /> Print
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setInvoiceBill(null)}
                                    className="h-8 w-8 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
                                >
                                    <HiOutlineXMark className="h-5 w-5" />
                                </button>
                            </div>
                        </div>

                        {/* Invoice Sheet */}
                        <div className="p-6 space-y-6 text-xs text-slate-700">
                            {/* Supplier & Bill Info */}
                            <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-200">
                                <div>
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Supplier / Vendor Details</span>
                                    <h4 className="text-base font-black text-slate-900 mt-0.5">{invoiceBill.supplier?.name || "Supplier"}</h4>
                                    {invoiceBill.supplier?.phone && <p className="text-slate-600 mt-0.5 font-medium">Phone: {invoiceBill.supplier.phone}</p>}
                                    {invoiceBill.supplier?.gstin && <p className="text-slate-600 font-medium">GSTIN: {invoiceBill.supplier.gstin}</p>}
                                    {invoiceBill.supplier?.address && <p className="text-slate-500 mt-0.5 max-w-xs">{invoiceBill.supplier.address}</p>}
                                </div>
                                <div className="text-right space-y-1">
                                    <span className="inline-block text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">
                                        Purchase Invoice
                                    </span>
                                    <p className="font-mono text-slate-900 font-black text-sm">#{invoiceBill.billNo}</p>
                                    <p className="text-slate-500">Date: {new Date(invoiceBill.billDate).toLocaleDateString("en-IN")}</p>
                                    <span className={cn(
                                        "inline-block text-[10px] font-black px-2.5 py-0.5 rounded-md mt-1",
                                        invoiceBill.status === "CONFIRMED" ? "bg-emerald-100 text-emerald-800" :
                                        invoiceBill.status === "CANCELLED" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"
                                    )}>
                                        Status: {invoiceBill.status}
                                    </span>
                                </div>
                            </div>

                            {/* Items Table */}
                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider border-b border-slate-200">
                                        <tr>
                                            <th className="text-left py-2.5 px-3">#</th>
                                            <th className="text-left py-2.5 px-3">Item Description</th>
                                            <th className="text-center py-2.5 px-3">Qty</th>
                                            <th className="text-right py-2.5 px-3">Unit Cost (₹)</th>
                                            <th className="text-center py-2.5 px-3">GST</th>
                                            <th className="text-right py-2.5 px-3">Line Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {invoiceBill.items?.map((item, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50/50">
                                                <td className="py-2.5 px-3 text-slate-400 font-mono">{idx + 1}</td>
                                                <td className="py-2.5 px-3 font-bold text-slate-900">
                                                    {item.name}
                                                    {item.variantSku ? <span className="text-[11px] font-normal text-slate-500 block">Variant/SKU: {item.variantSku}</span> : null}
                                                </td>
                                                <td className="py-2.5 px-3 text-center font-bold text-slate-800">{item.quantity}</td>
                                                <td className="py-2.5 px-3 text-right">{inrExact(item.cost)}</td>
                                                <td className="py-2.5 px-3 text-center text-slate-500">{item.gstPercent || 0}%</td>
                                                <td className="py-2.5 px-3 text-right font-bold text-slate-900">
                                                    {inr(item.lineTotal || (item.quantity * item.cost * (1 + (item.gstPercent || 0) / 100)))}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Totals & Payment Summary */}
                            <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pt-2">
                                <div className="space-y-1.5 text-xs text-slate-600 max-w-xs">
                                    <p><strong className="text-slate-800">Payment Method:</strong> {invoiceBill.paymentMethod || "CREDIT (Pending)"}</p>
                                    {invoiceBill.note && <p><strong className="text-slate-800">Note:</strong> {invoiceBill.note}</p>}
                                </div>
                                <div className="w-full sm:w-72 space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                                    <div className="flex justify-between text-slate-600">
                                        <span>Subtotal (Excl. Tax):</span>
                                        <span className="font-semibold">{inr(invoiceBill.subtotal || invoiceBill.total)}</span>
                                    </div>
                                    <div className="flex justify-between text-slate-600">
                                        <span>GST Total:</span>
                                        <span className="font-semibold">{inr(invoiceBill.gstTotal || 0)}</span>
                                    </div>
                                    <div className="flex justify-between text-slate-900 font-black text-sm border-t border-slate-200 pt-2">
                                        <span>Grand Total:</span>
                                        <span className="text-primary font-black">{inr(invoiceBill.total)}</span>
                                    </div>
                                    <div className="flex justify-between text-emerald-700 font-bold border-t border-dashed border-slate-200 pt-1.5">
                                        <span>Amount Paid:</span>
                                        <span>{inr(invoiceBill.amountPaid || 0)}</span>
                                    </div>
                                    <div className="flex justify-between text-rose-600 font-bold">
                                        <span>Balance Due (Udhaar):</span>
                                        <span>{inr(Math.max(0, invoiceBill.total - (invoiceBill.amountPaid || 0)))}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-slate-100 bg-slate-50/70">
                            <button
                                type="button"
                                onClick={() => setInvoiceBill(null)}
                                className={ghostBtn}
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                onClick={() => window.print()}
                                className={btnCls}
                            >
                                <HiOutlinePrinter className="h-4 w-4" /> Print Invoice
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Quick Add Product Modal */}
            {isQuickProductOpen && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
                    <div className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
                            <div className="flex items-center gap-2.5">
                                <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                                    <HiOutlineCube className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-slate-900">Quick Add New Product</h3>
                                    <p className="text-[11px] text-slate-500 font-medium">Create item instantly & add to current purchase bill</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => !quickBusy && setIsQuickProductOpen(false)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                                <HiOutlineXMark className="h-5 w-5" />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <form onSubmit={handleCreateQuickProduct} className="p-6 space-y-4">
                            {/* Product Title */}
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    Product Name <span className="text-rose-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    className={inputCls}
                                    placeholder="e.g. Fortune Sunflower Oil 1L"
                                    value={quickProd.name}
                                    onChange={(e) => {
                                        const nextName = e.target.value;
                                        setQuickProd((prev) => ({
                                            ...prev,
                                            name: nextName,
                                            sku: !prev.sku || prev.sku === makeSku(prev.name, 1) ? makeSku(nextName, 1) : prev.sku,
                                        }));
                                    }}
                                    autoFocus
                                />
                            </div>

                            {/* Category Hierarchy */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                        Main Group <span className="text-rose-500">*</span>
                                    </label>
                                    <select
                                        className={inputCls}
                                        value={quickProd.header}
                                        onChange={(e) => setQuickProd({ ...quickProd, header: e.target.value, category: "", subcategory: "" })}
                                        required
                                    >
                                        <option value="">— Select —</option>
                                        {dbCategories.map((h) => (
                                            <option key={h._id || h.id} value={h._id || h.id}>{h.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                        Category <span className="text-rose-500">*</span>
                                    </label>
                                    <select
                                        className={inputCls}
                                        value={quickProd.category}
                                        onChange={(e) => setQuickProd({ ...quickProd, category: e.target.value, subcategory: "" })}
                                        disabled={!quickProd.header}
                                        required
                                    >
                                        <option value="">— Select —</option>
                                        {(dbCategories.find((h) => (h._id || h.id) === quickProd.header)?.children || []).map((c) => (
                                            <option key={c._id || c.id} value={c._id || c.id}>{c.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                                        Sub-Category <span className="text-rose-500">*</span>
                                    </label>
                                    <select
                                        className={inputCls}
                                        value={quickProd.subcategory}
                                        onChange={(e) => setQuickProd({ ...quickProd, subcategory: e.target.value })}
                                        disabled={!quickProd.category}
                                        required
                                    >
                                        <option value="">— Select —</option>
                                        {(
                                            dbCategories
                                                .find((h) => (h._id || h.id) === quickProd.header)
                                                ?.children?.find((c) => (c._id || c.id) === quickProd.category)?.children || []
                                        ).map((sc) => (
                                            <option key={sc._id || sc.id} value={sc._id || sc.id}>{sc.name}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Pricing & Unit */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        Selling Price (MRP ₹) <span className="text-rose-500">*</span>
                                    </label>
                                    <input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        required
                                        className={inputCls}
                                        placeholder="e.g. 150"
                                        value={quickProd.price}
                                        onChange={(e) => setQuickProd({ ...quickProd, price: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">
                                        Variant / Unit Name
                                    </label>
                                    <input
                                        type="text"
                                        className={inputCls}
                                        placeholder="e.g. Standard, 500g, 1L"
                                        value={quickProd.variantName}
                                        onChange={(e) => setQuickProd({ ...quickProd, variantName: e.target.value })}
                                    />
                                </div>
                            </div>

                            {/* Product Code & Barcode */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Product Code (SKU)</label>
                                    <input
                                        type="text"
                                        className={`${inputCls} font-mono font-bold uppercase`}
                                        placeholder="e.g. ITEM-001"
                                        value={quickProd.sku}
                                        onChange={(e) => setQuickProd({ ...quickProd, sku: e.target.value.toUpperCase() })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-700 mb-1">Barcode (Optional)</label>
                                    <input
                                        type="text"
                                        className={inputCls}
                                        placeholder="Scan or type barcode"
                                        value={quickProd.barcode}
                                        onChange={(e) => setQuickProd({ ...quickProd, barcode: e.target.value })}
                                    />
                                </div>
                            </div>

                            {/* Info Banner */}
                            <div className="p-3 bg-amber-50/80 border border-amber-200/70 rounded-xl flex items-start gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0"></span>
                                <p className="text-[11px] text-amber-800 leading-relaxed">
                                    Initial stock will be created as <strong>0</strong>. When you confirm this purchase bill, the incoming quantity and cost will automatically update stock and inventory.
                                </p>
                            </div>

                            {/* Modal Actions */}
                            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                                <button
                                    type="button"
                                    disabled={quickBusy}
                                    onClick={() => setIsQuickProductOpen(false)}
                                    className={ghostBtn}
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={quickBusy}
                                    className={btnCls}
                                >
                                    {quickBusy ? (
                                        <>
                                            <HiOutlineArrowPath className="h-4 w-4 animate-spin" /> Creating...
                                        </>
                                    ) : (
                                        <>
                                            <HiOutlinePlus className="h-4 w-4" /> Create & Add to Bill
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {isSupplierModalOpen && (
                <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
                    <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
                            <div className="flex items-center gap-2.5">
                                <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold">
                                    <HiOutlineUserPlus className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="text-sm font-black text-slate-900">Add New Supplier</h3>
                                    <p className="text-[11px] text-slate-500 font-medium">Create a supplier & select it for this purchase bill</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => !supplierBusy && setIsSupplierModalOpen(false)}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                            >
                                <HiOutlineXMark className="h-5 w-5" />
                            </button>
                        </div>
                        <form onSubmit={handleCreateSupplier} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">Supplier Name <span className="text-rose-500">*</span></label>
                                <input
                                    autoFocus
                                    autoCapitalize="words"
                                    className={`${inputCls} capitalize`}
                                    placeholder="e.g. Mahavir Textiles"
                                    maxLength={100}
                                    value={supplierForm.name}
                                    onChange={(e) => setSupplierForm({ ...supplierForm, name: capitalizeWords(e.target.value) })}
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-700 mb-1">
                                    Phone Number <span className="text-slate-400 font-normal">(Optional, 10 Digits)</span>
                                </label>
                                <input
                                    type="tel"
                                    inputMode="numeric"
                                    className={inputCls}
                                    placeholder="e.g. 9876543210"
                                    maxLength={15}
                                    value={supplierForm.phone}
                                    onChange={(e) => {
                                        let val = e.target.value.replace(/[^\d+]/g, "");
                                        if (val.indexOf("+") > 0) val = val.replace(/\+/g, "");
                                        setSupplierForm({ ...supplierForm, phone: val.slice(0, 15) });
                                    }}
                                />
                            </div>
                            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                                <button type="button" disabled={supplierBusy} onClick={() => setIsSupplierModalOpen(false)} className={ghostBtn}>
                                    Cancel
                                </button>
                                <button type="submit" disabled={supplierBusy || supplierForm.name.trim().length < 2} className={btnCls}>
                                    {supplierBusy ? (
                                        <>
                                            <HiOutlineArrowPath className="h-4 w-4 animate-spin" /> Adding...
                                        </>
                                    ) : (
                                        <>
                                            <HiOutlineUserPlus className="h-4 w-4" /> Add & Select Supplier
                                        </>
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
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

    useEffect(() => {
        if (ledger) {
            document.body.style.overflow = "hidden";
            document.documentElement.style.overflow = "hidden";
        } else {
            document.body.style.overflow = "";
            document.documentElement.style.overflow = "";
        }
        return () => {
            document.body.style.overflow = "";
            document.documentElement.style.overflow = "";
        };
    }, [ledger]);

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

            {/* Ledger Statement Modal Card */}
            {ledger && (
                <div
                    className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
                    onClick={(e) => { if (e.target === e.currentTarget) setLedger(null); }}
                >
                    <div className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-150">
                        {/* Modal Header */}
                        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-slate-100 bg-slate-50/70">
                            <div>
                                <div className="flex items-center gap-2">
                                    <h3 className="text-base font-black text-slate-900">{ledger.party.name}</h3>
                                    <span className="text-xs text-slate-500 font-medium">({kind === "suppliers" ? "Supplier Ledger" : "Customer Ledger"})</span>
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

                        {/* Modal Body */}
                        <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
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

/* ---------- Account (payments made / received) ---------- */
const ACCOUNT_VIEWS = [
    { key: "payments", label: "Payment", hint: "Money you paid out — suppliers, refunds, expenses, cash out", icon: HiOutlineArrowUpRight },
    { key: "received", label: "Received", hint: "Money you received — sales, online orders, customer payments, cash in", icon: HiOutlineArrowDownLeft },
];
const monthStart = () => `${today().slice(0, 8)}01`;

const AccountTab = ({ view }) => {
    const [from, setFrom] = useState(monthStart());
    const [to, setTo] = useState(today());
    const [searchTerm, setSearchTerm] = useState("");
    const [typeFilter, setTypeFilter] = useState("all");
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let active = true;
        setLoading(true);
        businessApi.accounts(view, { from, to })
            .then((r) => { if (active) setData(unwrap(r)); })
            .catch((e) => { if (active) { setData(null); toast.error(errMsg(e)); } })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [view, from, to]);

    useEffect(() => { setTypeFilter("all"); }, [view]);

    const rows = useMemo(() => {
        const q = searchTerm.trim().toLowerCase();
        return (data?.rows || []).filter((r) => {
            if (typeFilter !== "all" && r.type !== typeFilter) return false;
            if (!q) return true;
            return [r.type, r.party, r.reference, r.method, r.note, String(r.amount)]
                .some((v) => String(v || "").toLowerCase().includes(q));
        });
    }, [data, searchTerm, typeFilter]);

    const filteredTotal = useMemo(() => rows.reduce((s, r) => s + formatPriceInteger(r.amount), 0), [rows]);
    const roundedTotals = useMemo(() => {
        const byType = {};
        let amount = 0;
        for (const r of data?.rows || []) {
            const v = formatPriceInteger(r.amount);
            byType[r.type] = (byType[r.type] || 0) + v;
            amount += v;
        }
        return { amount, byType };
    }, [data]);
    const isPayments = view === "payments";
    const active = ACCOUNT_VIEWS.find((v) => v.key === view);

    return (
        <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                    <div className="flex items-center gap-2.5">
                        <div className={cn(
                            "h-9 w-9 rounded-xl flex items-center justify-center font-bold",
                            isPayments ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
                        )}>
                            <active.icon className="h-5 w-5" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black text-slate-900">{isPayments ? "Payments Made" : "Payments Received"}</h3>
                            <p className="text-xs text-slate-500">{active.hint}</p>
                        </div>
                    </div>
                    <div className="text-left lg:text-right">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{isPayments ? "Total Paid" : "Total Received"}</p>
                        <p className={cn("text-xl font-black", isPayments ? "text-rose-600" : "text-emerald-600")}>{inr(roundedTotals.amount)}</p>
                    </div>
                </div>

                <div className="flex flex-wrap gap-2 items-center">
                    <div className="flex items-center gap-1 text-xs text-slate-500 font-bold">
                        <span>From:</span>
                        <input type="date" className={`${inputCls} max-w-[150px]`} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
                    </div>
                    <div className="flex items-center gap-1 text-xs text-slate-500 font-bold">
                        <span>To:</span>
                        <input type="date" className={`${inputCls} max-w-[150px]`} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
                    </div>
                    <select className={`${inputCls} max-w-[200px]`} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                        <option value="all">All types</option>
                        {Object.keys(data?.totals?.byType || {}).map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <div className="relative flex-1 min-w-[200px]">
                        <HiOutlineMagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <input
                            className={`${inputCls} pl-10`}
                            placeholder="Search by party, reference, method or note..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </div>

                {Object.keys(roundedTotals.byType).length > 0 && (
                    <div className="flex flex-wrap gap-2 text-xs">
                        {Object.entries(roundedTotals.byType).map(([k, v]) => (
                            <span key={k} className="px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 font-bold text-slate-700">
                                {k}: <span className="text-primary font-black">{inr(v)}</span>
                            </span>
                        ))}
                    </div>
                )}

                {loading && !data ? (
                    <div className="py-8 text-center text-sm text-slate-400">Loading transactions…</div>
                ) : rows.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-400">
                        {isPayments ? "No payments made in this period." : "No payments received in this period."}
                    </div>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                <tr>
                                    <th className="px-3 py-2.5 text-left">Date</th>
                                    <th className="px-3 py-2.5 text-left">Type</th>
                                    <th className="px-3 py-2.5 text-left">{isPayments ? "Paid To" : "Received From"}</th>
                                    <th className="px-3 py-2.5 text-left">Reference</th>
                                    <th className="px-3 py-2.5 text-left">Method</th>
                                    <th className="px-3 py-2.5 text-left">Note</th>
                                    <th className="px-3 py-2.5 text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {rows.map((r) => (
                                    <tr key={`${r.type}-${r.id}`} className="hover:bg-slate-50/70">
                                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">
                                            {new Date(r.date).toLocaleString("en-IN", { timeZone: storeTz, day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                                        </td>
                                        <td className="px-3 py-2.5 whitespace-nowrap font-bold text-slate-800">{r.type}</td>
                                        <td className="px-3 py-2.5 text-slate-700">{r.party || "—"}</td>
                                        <td className="px-3 py-2.5 text-slate-500 font-mono text-xs">{r.reference || "—"}</td>
                                        <td className="px-3 py-2.5 whitespace-nowrap text-slate-600">{r.method || "—"}</td>
                                        <td className="px-3 py-2.5 text-slate-500 max-w-[240px] truncate" title={r.note}>{r.note || "—"}</td>
                                        <td className={cn("px-3 py-2.5 text-right font-black whitespace-nowrap", isPayments ? "text-rose-600" : "text-emerald-600")}>
                                            {isPayments ? "− " : "+ "}{inr(r.amount)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-slate-50">
                                <tr>
                                    <td colSpan={6} className="px-3 py-2.5 text-xs font-bold text-slate-600">
                                        {rows.length} transaction{rows.length === 1 ? "" : "s"}
                                    </td>
                                    <td className={cn("px-3 py-2.5 text-right font-black", isPayments ? "text-rose-600" : "text-emerald-600")}>
                                        {inr(filteredTotal)}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

// URL section (/seller/business/:section) <-> internal tab key
const SECTION_TO_TAB = { purchases: "purchases", ledgers: "parties", cash: "cash", reports: "reports", account: "account" };
const TAB_TO_PATH = {
    dashboard: "/seller/business",
    purchases: "/seller/business/purchases",
    parties: "/seller/business/ledgers",
    cash: "/seller/business/cash",
    reports: "/seller/business/reports",
    account: "/seller/business/account/payment",
};

// Account sub-pages: /seller/business/account/payment | /received (sidebar sub-links)
const ACCOUNT_PATH_TO_VIEW = { payment: "payments", received: "received" };

const Business = () => {
    const { section, view } = useParams();
    const navigate = useNavigate();
    const tab = SECTION_TO_TAB[section] || "dashboard";
    const setTab = (k) => navigate(TAB_TO_PATH[k] || TAB_TO_PATH.dashboard);
    const accountView = ACCOUNT_PATH_TO_VIEW[view];

    useEffect(() => {
        if (tab === "account" && !accountView) navigate("/seller/business/account/payment", { replace: true });
    }, [tab, accountView, navigate]);
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
            {tab === "account" && accountView && <AccountTab key={accountView} view={accountView} />}
        </div>
    );
};

export default Business;
