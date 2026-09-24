import React, { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";
import {
    HiOutlineMagnifyingGlass,
    HiOutlineArrowUturnLeft,
    HiOutlineCheckCircle,
    HiOutlineExclamationTriangle,
    HiOutlineBanknotes,
    HiOutlineCreditCard,
    HiOutlineQrCode,
    HiOutlinePrinter,
    HiOutlineReceiptPercent,
    HiOutlineArrowPath,
    HiOutlineDocumentText,
    HiOutlineXMark,
    HiOutlinePlus,
    HiOutlineMinus,
    HiOutlineSparkles,
    HiOutlineShieldCheck,
    HiOutlineArchiveBox,
    HiOutlineClock,
} from "react-icons/hi2";
import Button from "@shared/components/ui/Button";
import Input from "@shared/components/ui/Input";
import { cn } from "@/lib/utils";
import { posApi } from "../../services/posApi";
import SaleEditPanel from "./SaleEditPanel";
import ReturnReceipt from "./ReturnReceipt";

const REFUND_METHODS = [
    { value: "CASH", label: "Cash", icon: HiOutlineBanknotes, desc: "Handed over cash" },
    { value: "QR", label: "UPI / QR", icon: HiOutlineQrCode, desc: "GPay / PhonePe / Paytm" },
    { value: "CARD", label: "Card", icon: HiOutlineCreditCard, desc: "Card refund" },
    { value: "CREDIT", label: "Store Credit", icon: HiOutlineReceiptPercent, desc: "Adjust to ledger" },
];

const ReturnsPanel = ({ initialOrderId = "", shopName, seller }) => {
    const [orderIdSearch, setOrderIdSearch] = useState(initialOrderId);
    const [slip, setSlip] = useState(null);
    const [isLooking, setIsLooking] = useState(false);
    const [lookupError, setLookupError] = useState("");
    const [order, setOrder] = useState(null);
    const [lines, setLines] = useState([]);
    const [refundMethod, setRefundMethod] = useState("CASH");
    const [reason, setReason] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [recentReturns, setRecentReturns] = useState([]);
    const [isLoadingLog, setIsLoadingLog] = useState(true);

    const loadRecentReturns = () => {
        setIsLoadingLog(true);
        posApi
            .getReturns({ limit: 10 })
            .then((res) => {
                const items = res?.data?.result?.items;
                setRecentReturns(Array.isArray(items) ? items : []);
            })
            .catch(() => {})
            .finally(() => setIsLoadingLog(false));
    };

    useEffect(() => {
        loadRecentReturns();
    }, []);

    const handleLookup = async (idOverride) => {
        const trimmed = String(typeof idOverride === "string" ? idOverride : orderIdSearch).trim();
        if (!trimmed) return;
        setIsLooking(true);
        setLookupError("");
        setOrder(null);
        setLines([]);
        try {
            const res = await posApi.getOrderForReturn(trimmed);
            const data = res?.data?.result;
            if (!data) throw new Error("Order not found");
            setOrder(data.order);
            setLines(
                (data.items || []).map((item) => ({
                    ...item,
                    returnQty: 0,
                    condition: "good",
                })),
            );
        } catch (error) {
            const msg = error?.response?.data?.message || "POS order not found. Please verify the Bill ID.";
            setLookupError(msg);
        } finally {
            setIsLooking(false);
        }
    };

    useEffect(() => {
        if (initialOrderId) {
            setOrderIdSearch(initialOrderId);
            handleLookup(initialOrderId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialOrderId]);

    const updateLine = (index, patch) => {
        setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
    };

    const selectedLines = lines.filter((l) => l.returnQty > 0);
    // Refund follows the discounted price actually paid (bill discount shared across lines, rounded to whole rupee).
    const unitRefund = (l) => Math.round(Number(l.refundUnitPrice ?? l.price));
    const refundTotal = selectedLines.reduce((sum, l) => sum + unitRefund(l) * l.returnQty, 0);

    const totalRecentRefundAmount = useMemo(
        () => recentReturns.reduce((sum, r) => sum + Number(r.refundTotal || 0), 0),
        [recentReturns],
    );

    const handleSubmit = async () => {
        if (!order || selectedLines.length === 0) return;
        setIsSubmitting(true);
        try {
            const payload = {
                orderId: order.orderId,
                items: selectedLines.map((l) => ({
                    productId: l.product,
                    variantSlot: l.variantSlot || undefined,
                    quantity: l.returnQty,
                    condition: l.condition,
                })),
                refundMethod,
                reason: reason.trim() || undefined,
            };
            const res = await posApi.createReturn(payload);
            toast.success("Return recorded and refund logged successfully");
            const created = res?.data?.result;
            if (created) setSlip(created);
            setOrder(null);
            setLines([]);
            setOrderIdSearch("");
            setReason("");
            loadRecentReturns();
        } catch (error) {
            const msg = error?.response?.data?.message || "Failed to record return";
            toast.error(msg);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="space-y-5 pb-8">
            {/* Top Page Header & Quick KPIs */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-gradient-to-r from-emerald-50/70 via-teal-50/40 to-white rounded-2xl border border-emerald-100/80 p-5 shadow-xs">
                <div className="flex items-center gap-3.5">
                    <div className="h-12 w-12 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-600/20 shrink-0">
                        <HiOutlineArrowUturnLeft className="h-6 w-6 stroke-2" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-black text-slate-900 tracking-tight">Returns & Refunds Desk</h1>
                            <span className="text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full">
                                POS
                            </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Process walk-in customer returns, inspect item condition, and issue instant refunds.
                        </p>
                    </div>
                </div>

                {/* Right quick stats */}
                <div className="flex items-center gap-2 self-start sm:self-auto">
                    <div className="flex items-center gap-3 bg-white/90 backdrop-blur-xs px-3.5 py-2 rounded-xl border border-slate-200/80 shadow-xs">
                        <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Logged Returns</p>
                            <p className="text-sm font-black text-slate-900">{recentReturns.length}</p>
                        </div>
                        <div className="h-6 w-px bg-slate-200" />
                        <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Refunded</p>
                            <p className="text-sm font-black text-emerald-600">₹{totalRecentRefundAmount.toLocaleString("en-IN")}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_370px] gap-5 items-start">
                <div className="space-y-4">
                    {/* Bill Search Card */}
                    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <h2 className="text-sm font-black text-slate-900">Find POS Sale</h2>
                                <p className="text-xs text-slate-500 mt-0.5">
                                    Enter or scan the customer's Bill No. / Order ID to load billed items
                                </p>
                            </div>
                            <span className="text-[11px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded-lg">
                                Exact Match
                            </span>
                        </div>

                        <div className="flex gap-2.5">
                            <div className="relative flex-1">
                                <HiOutlineMagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
                                <Input
                                    placeholder="Enter Bill No. (e.g. ORD-XXXXXXXXXX)"
                                    value={orderIdSearch}
                                    onChange={(e) => setOrderIdSearch(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleLookup()}
                                    className="pl-11 pr-8 py-2.5 text-sm font-semibold text-slate-900 bg-slate-50/70 border-slate-200 focus:bg-white"
                                />
                                {orderIdSearch && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setOrderIdSearch("");
                                            setOrder(null);
                                            setLookupError("");
                                        }}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                    >
                                        <HiOutlineXMark className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                            <Button
                                onClick={() => handleLookup()}
                                isLoading={isLooking}
                                className="px-5 font-bold shadow-sm"
                            >
                                <HiOutlineMagnifyingGlass className="h-4 w-4 mr-1.5" />
                                Search Bill
                            </Button>
                        </div>

                        {lookupError && (
                            <div className="mt-3 flex items-center gap-2 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
                                <HiOutlineExclamationTriangle className="h-4 w-4 shrink-0 text-rose-500" />
                                <span>{lookupError}</span>
                            </div>
                        )}
                    </div>

                    {/* Empty State / How Returns Work Guide (Shown when no order is loaded) */}
                    {!order && !isLooking && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
                            <div className="text-center max-w-md mx-auto space-y-2 py-2">
                                <div className="h-14 w-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-100 shadow-xs">
                                    <HiOutlineReceiptPercent className="h-7 w-7" />
                                </div>
                                <h3 className="text-base font-black text-slate-900">Ready to Process a Return</h3>
                                <p className="text-xs text-slate-500 leading-relaxed">
                                    Search by Bill No. above to view purchased items, select quantities, inspect conditions, and issue instant refunds.
                                </p>
                            </div>

                            {/* 3 Step Workflow Graphic */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                                <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition-colors space-y-1.5">
                                    <div className="h-8 w-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xs">
                                        1
                                    </div>
                                    <p className="text-xs font-black text-slate-800">Scan or Enter Bill</p>
                                    <p className="text-[11px] text-slate-500 leading-normal">
                                        Locate the original POS sale using the bill number printed on customer receipt.
                                    </p>
                                </div>

                                <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition-colors space-y-1.5">
                                    <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center font-black text-xs">
                                        2
                                    </div>
                                    <p className="text-xs font-black text-slate-800">Select & Inspect</p>
                                    <p className="text-[11px] text-slate-500 leading-normal">
                                        Choose item quantities. Tag as <span className="font-bold text-emerald-700">Good</span> to auto-restock, or <span className="font-bold text-rose-700">Damaged</span>.
                                    </p>
                                </div>

                                <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/60 hover:bg-slate-50 transition-colors space-y-1.5">
                                    <div className="h-8 w-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center font-black text-xs">
                                        3
                                    </div>
                                    <p className="text-xs font-black text-slate-800">Auto Round Refund</p>
                                    <p className="text-[11px] text-slate-500 leading-normal">
                                        Calculates proportionate discount per unit, rounds to whole rupees, and prints return slip.
                                    </p>
                                </div>
                            </div>

                            <div className="rounded-xl border border-slate-100 bg-emerald-50/40 p-3.5 flex items-center gap-3">
                                <HiOutlineShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />
                                <p className="text-xs font-medium text-slate-600">
                                    <strong className="text-slate-900">Safe Accounting:</strong> Returns deduct from total sales, record audit logs, and automatically adjust ledger udhaar if applicable.
                                </p>
                            </div>
                        </div>
                    )}

                    {/* Order Details & Return Form (When order is found) */}
                    {order && (
                        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
                            {/* Bill Header Banner */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200/80">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-black text-slate-900">#{order.orderId}</span>
                                        <span className="text-[10px] font-black uppercase tracking-wider bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                                            POS Bill
                                        </span>
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                                        <span className="flex items-center gap-1 font-semibold text-slate-700">
                                            <HiOutlineClock className="h-3.5 w-3.5 text-slate-400" />
                                            {new Date(order.createdAt).toLocaleString("en-IN", {
                                                dateStyle: "medium",
                                                timeStyle: "short",
                                            })}
                                        </span>
                                        <span>•</span>
                                        <span>Customer: <strong className="text-slate-800">{order.walkInCustomer?.name || "Walk-in"}</strong> {order.walkInCustomer?.phone ? `(${order.walkInCustomer.phone})` : ""}</span>
                                    </div>
                                </div>

                                <div className="flex sm:flex-col items-center sm:items-end justify-between gap-1 text-right">
                                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                        Paid via {order.posPaymentMethod || "CASH"}
                                    </span>
                                    <span className="text-sm font-black text-slate-900">
                                        Grand Total: ₹{Number(order.paymentBreakdown?.grandTotal || 0).toLocaleString("en-IN")}
                                    </span>
                                </div>
                            </div>

                            {/* Optional Edit Bill Accordion */}
                            {lines.every((l) => !l.returnedQuantity) && (
                                <SaleEditPanel order={order} lines={lines} onSaved={handleLookup} />
                            )}

                            {/* Items List */}
                            <div className="space-y-2.5">
                                <div className="flex items-center justify-between px-1">
                                    <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
                                        Purchased Items ({lines.length})
                                    </h3>
                                    <span className="text-[11px] font-bold text-slate-400">
                                        Select return quantity & condition
                                    </span>
                                </div>

                                {lines.map((line, idx) => {
                                    const isExhausted = line.returnableQuantity <= 0;
                                    const isSelected = line.returnQty > 0;
                                    const refundPerUnit = unitRefund(line);

                                    return (
                                        <div
                                            key={`${line.product}-${line.variantSlot || ""}`}
                                            className={cn(
                                                "rounded-xl border transition-all p-3.5",
                                                isSelected
                                                    ? "border-emerald-300 bg-emerald-50/20 shadow-xs ring-1 ring-emerald-200"
                                                    : isExhausted
                                                    ? "border-slate-100 bg-slate-50/40 opacity-60"
                                                    : "border-slate-200/90 bg-white hover:border-slate-300",
                                            )}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-xs font-bold text-slate-900 truncate">
                                                            {line.name}
                                                        </p>
                                                        {line.variantSlot && (
                                                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                                                {line.variantSlot}
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-500 font-medium">
                                                        <span>Bought: <strong>{line.quantity}</strong></span>
                                                        <span>•</span>
                                                        {line.returnedQuantity > 0 && (
                                                            <>
                                                                <span className="text-amber-700 font-bold">Returned: {line.returnedQuantity}</span>
                                                                <span>•</span>
                                                            </>
                                                        )}
                                                        <span className={cn(
                                                            "font-bold",
                                                            isExhausted ? "text-slate-400" : "text-emerald-700",
                                                        )}>
                                                            {line.returnableQuantity} returnable
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="text-right shrink-0">
                                                    <div className="text-xs font-black text-slate-900">
                                                        ₹{line.price.toLocaleString("en-IN")}
                                                    </div>
                                                    <div className="mt-0.5">
                                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-black bg-emerald-100 text-emerald-800">
                                                            refund ₹{refundPerUnit}/unit
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Quantity and Condition controls */}
                                            {line.returnableQuantity > 0 ? (
                                                <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-slate-100">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-bold text-slate-600">Return Qty:</span>
                                                        <div className="flex items-center border border-slate-200 rounded-lg bg-white overflow-hidden shadow-2xs">
                                                            <button
                                                                type="button"
                                                                disabled={line.returnQty <= 0}
                                                                onClick={() => updateLine(idx, { returnQty: Math.max(0, line.returnQty - 1) })}
                                                                className="h-7 w-7 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-white"
                                                            >
                                                                <HiOutlineMinus className="h-3 w-3 stroke-2" />
                                                            </button>
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                max={line.returnableQuantity}
                                                                value={line.returnQty}
                                                                onChange={(e) => {
                                                                    const val = Math.min(
                                                                        Math.max(0, Number(e.target.value) || 0),
                                                                        line.returnableQuantity,
                                                                    );
                                                                    updateLine(idx, { returnQty: val });
                                                                }}
                                                                className="w-12 text-center text-xs font-black text-slate-900 border-x border-slate-200 py-1 outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                            />
                                                            <button
                                                                type="button"
                                                                disabled={line.returnQty >= line.returnableQuantity}
                                                                onClick={() => updateLine(idx, { returnQty: Math.min(line.returnableQuantity, line.returnQty + 1) })}
                                                                className="h-7 w-7 flex items-center justify-center text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-white"
                                                            >
                                                                <HiOutlinePlus className="h-3 w-3 stroke-2" />
                                                            </button>
                                                        </div>

                                                        {line.returnQty !== line.returnableQuantity && (
                                                            <button
                                                                type="button"
                                                                onClick={() => updateLine(idx, { returnQty: line.returnableQuantity })}
                                                                className="text-[10px] font-bold text-slate-500 hover:text-emerald-700 underline ml-1"
                                                            >
                                                                Max ({line.returnableQuantity})
                                                            </button>
                                                        )}
                                                    </div>

                                                    {/* Condition pill buttons */}
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-xs font-bold text-slate-600 mr-1">Condition:</span>
                                                        <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                                                            <button
                                                                type="button"
                                                                onClick={() => updateLine(idx, { condition: "good" })}
                                                                className={cn(
                                                                    "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-all",
                                                                    line.condition === "good"
                                                                        ? "bg-white text-emerald-700 shadow-2xs"
                                                                        : "text-slate-500 hover:text-slate-700",
                                                                )}
                                                            >
                                                                <HiOutlineCheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                                                                Good (Restock)
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => updateLine(idx, { condition: "damaged" })}
                                                                className={cn(
                                                                    "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold transition-all",
                                                                    line.condition === "damaged"
                                                                        ? "bg-white text-rose-700 shadow-2xs"
                                                                        : "text-slate-500 hover:text-slate-700",
                                                                )}
                                                            >
                                                                <HiOutlineExclamationTriangle className="h-3.5 w-3.5 text-rose-500" />
                                                                Damaged
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="mt-2 text-[11px] font-bold text-slate-400">
                                                    ✓ All units have already been returned
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Refund & Process Panel (when items are selected) */}
                            {selectedLines.length > 0 && (
                                <div className="rounded-2xl border-2 border-emerald-500/30 bg-gradient-to-b from-emerald-50/30 to-white p-5 shadow-sm space-y-4">
                                    <div className="flex items-center justify-between pb-3 border-b border-emerald-100">
                                        <div className="flex items-center gap-2">
                                            <div className="h-7 w-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold">
                                                <HiOutlineReceiptPercent className="h-4 w-4" />
                                            </div>
                                            <h4 className="text-sm font-black text-slate-900">Refund Summary</h4>
                                        </div>
                                        <span className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                            {selectedLines.reduce((acc, l) => acc + l.returnQty, 0)} item(s) to return
                                        </span>
                                    </div>

                                    {/* Refund Method Grid */}
                                    <div>
                                        <p className="text-xs font-black text-slate-700 mb-2">How are you refunding?</p>
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                            {REFUND_METHODS.map(({ value, label, icon: Icon, desc }) => (
                                                <button
                                                    key={value}
                                                    type="button"
                                                    onClick={() => setRefundMethod(value)}
                                                    className={cn(
                                                        "flex flex-col items-center justify-center text-center p-3 rounded-xl border-2 transition-all cursor-pointer",
                                                        refundMethod === value
                                                            ? "border-emerald-600 bg-white text-emerald-900 shadow-xs ring-2 ring-emerald-500/20"
                                                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                                                    )}
                                                >
                                                    <Icon className={cn("h-5 w-5 mb-1", refundMethod === value ? "text-emerald-600" : "text-slate-400")} />
                                                    <span className="text-xs font-black">{label}</span>
                                                    <span className="text-[10px] text-slate-400">{desc}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    <Input
                                        placeholder="Reason for return (optional, e.g. Defective, Wrong item)"
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        className="text-xs bg-white"
                                    />

                                    {/* Total highlight */}
                                    <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-900 text-white shadow-xs">
                                        <div>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                                Net Amount to Refund
                                            </p>
                                            <p className="text-[11px] text-emerald-400 font-medium">
                                                ✓ Rounded to nearest whole rupee
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <span className="text-2xl font-black text-emerald-400">
                                                ₹{refundTotal.toLocaleString("en-IN")}
                                            </span>
                                        </div>
                                    </div>

                                    <Button
                                        className="w-full py-3 text-sm font-black shadow-md bg-emerald-600 hover:bg-emerald-700"
                                        size="lg"
                                        isLoading={isSubmitting}
                                        onClick={handleSubmit}
                                    >
                                        <HiOutlineArrowUturnLeft className="h-5 w-5 mr-2 stroke-2" />
                                        Process Return & Print Slip
                                    </Button>

                                    <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500 font-medium text-center">
                                        <HiOutlineArchiveBox className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                        <span>Good items restock instantly; damaged items are archived for audit.</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Right Sidebar: Recent Returns List */}
                <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs h-fit lg:sticky lg:top-24 space-y-3.5">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                        <div className="flex items-center gap-2">
                            <HiOutlineClock className="h-4 w-4 text-slate-400" />
                            <h2 className="text-sm font-black text-slate-900">Recent Returns</h2>
                        </div>
                        <button
                            type="button"
                            onClick={loadRecentReturns}
                            title="Refresh"
                            className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
                        >
                            <HiOutlineArrowPath className={cn("h-3.5 w-3.5", isLoadingLog && "animate-spin")} />
                        </button>
                    </div>

                    {isLoadingLog ? (
                        <div className="py-8 text-center space-y-2">
                            <HiOutlineArrowPath className="h-5 w-5 text-slate-400 animate-spin mx-auto" />
                            <p className="text-xs text-slate-400 font-medium">Loading returns history…</p>
                        </div>
                    ) : recentReturns.length === 0 ? (
                        <div className="py-8 text-center space-y-1.5">
                            <div className="h-10 w-10 rounded-full bg-slate-50 text-slate-300 flex items-center justify-center mx-auto">
                                <HiOutlineDocumentText className="h-5 w-5" />
                            </div>
                            <p className="text-xs font-bold text-slate-700">No returns recorded yet</p>
                            <p className="text-[11px] text-slate-400">Processed returns will show up here</p>
                        </div>
                    ) : (
                        <div className="space-y-2.5 max-h-[calc(100vh-220px)] overflow-y-auto pr-0.5">
                            {recentReturns.map((ret) => (
                                <div
                                    key={ret._id}
                                    className="group rounded-xl border border-slate-200/80 hover:border-emerald-300 bg-white hover:bg-emerald-50/20 p-3 transition-all space-y-1.5 shadow-2xs"
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-xs font-black text-slate-900">
                                            #{ret.orderId}
                                        </span>
                                        <span className="text-xs font-black px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                                            ₹{Math.round(Number(ret.refundTotal || 0)).toLocaleString("en-IN")}
                                        </span>
                                    </div>

                                    <div className="flex items-center justify-between text-[11px] text-slate-500">
                                        <span>
                                            {new Date(ret.createdAt).toLocaleString("en-IN", {
                                                dateStyle: "short",
                                                timeStyle: "short",
                                            })}
                                        </span>
                                        <span className="font-bold text-slate-700 uppercase text-[10px] bg-slate-100 px-1.5 py-0.5 rounded">
                                            {ret.refundMethod}
                                        </span>
                                    </div>

                                    <p className="text-[11px] text-slate-600 line-clamp-2 leading-relaxed">
                                        {(ret.items || [])
                                            .map((it) => `${it.quantity}x ${it.productName || "item"} (${it.condition})`)
                                            .join(", ")}
                                    </p>

                                    <div className="pt-1.5 border-t border-slate-100 flex items-center justify-end">
                                        <button
                                            type="button"
                                            onClick={() => setSlip(ret)}
                                            className="flex items-center gap-1 text-[11px] font-bold text-slate-600 hover:text-emerald-700 transition-colors"
                                        >
                                            <HiOutlinePrinter className="h-3.5 w-3.5" />
                                            Print Slip
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {slip && <ReturnReceipt ret={slip} shopName={shopName} seller={seller} onClose={() => setSlip(null)} />}
        </div>
    );
};

export default ReturnsPanel;
