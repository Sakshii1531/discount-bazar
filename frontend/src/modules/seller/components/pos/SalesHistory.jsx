import React, { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
    HiOutlineMagnifyingGlass,
    HiOutlinePrinter,
    HiOutlineArrowUturnLeft,
    HiOutlineReceiptPercent,
} from "react-icons/hi2";
import Button from "@shared/components/ui/Button";
import Input from "@shared/components/ui/Input";
import { posApi } from "../../services/posApi";
import ReceiptPrint from "./ReceiptPrint";

const METHOD_LABELS = { CASH: "Cash", CARD: "Card", QR: "QR / UPI", CREDIT: "Credit", OTHER: "Other", SPLIT: "Split" };
const inr = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Past POS bills: search by bill number / customer name / phone, filter by
 * date, reprint a bill copy, or jump to Returns to return or edit it.
 */
const SalesHistory = ({ shopName, seller }) => {
    const navigate = useNavigate();
    const [search, setSearch] = useState("");
    const [from, setFrom] = useState("");
    const [to, setTo] = useState("");
    const [page, setPage] = useState(1);
    const [data, setData] = useState({ items: [], totalPages: 1, total: 0 });
    const [isLoading, setIsLoading] = useState(true);
    const [reprint, setReprint] = useState(null);

    const load = useCallback(
        (nextPage = 1) => {
            setIsLoading(true);
            posApi
                .getSales({
                    page: nextPage,
                    limit: 20,
                    search: search.trim() || undefined,
                    from: from || undefined,
                    to: to || undefined,
                })
                .then((res) => {
                    const result = res?.data?.result || {};
                    setData({
                        items: Array.isArray(result.items) ? result.items : [],
                        totalPages: result.totalPages || 1,
                        total: result.total || 0,
                    });
                    setPage(nextPage);
                })
                .catch(() => toast.error("Failed to load sales"))
                .finally(() => setIsLoading(false));
        },
        [search, from, to],
    );

    useEffect(() => {
        load(1);
        // Initial load only; filters apply on Search.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_160px_auto] gap-2">
                    <Input
                        placeholder="Bill number, customer name or phone"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && load(1)}
                    />
                    <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="From date" />
                    <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="To date" />
                    <Button onClick={() => load(1)} isLoading={isLoading}>
                        <HiOutlineMagnifyingGlass className="h-4 w-4 mr-1.5" />
                        Search
                    </Button>
                </div>
            </div>

            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <p className="text-sm font-black text-slate-900">POS Bills</p>
                    <span className="text-xs font-bold text-slate-400">{data.total} bill(s)</span>
                </div>

                {isLoading ? (
                    <p className="text-xs text-slate-400 p-6 text-center">Loading…</p>
                ) : data.items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-14 text-slate-400">
                        <HiOutlineReceiptPercent className="h-10 w-10 mb-2" />
                        <p className="text-sm font-semibold">No bills found</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="text-left text-slate-500 border-b border-slate-100">
                                    <th className="px-4 py-2 font-bold">Bill</th>
                                    <th className="px-4 py-2 font-bold">Date</th>
                                    <th className="px-4 py-2 font-bold">Customer</th>
                                    <th className="px-4 py-2 font-bold">Payment</th>
                                    <th className="px-4 py-2 font-bold text-right">Total</th>
                                    <th className="px-4 py-2 font-bold text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.items.map((o) => (
                                    <tr key={o._id} className="border-b border-slate-50 hover:bg-slate-50/60">
                                        <td className="px-4 py-2.5 font-bold text-slate-900">
                                            #{o.orderId}
                                            {Array.isArray(o.posEdits) && o.posEdits.length > 0 && (
                                                <span className="ml-1.5 text-[9px] font-black uppercase text-amber-600">edited</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                                            {new Date(o.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                                        </td>
                                        <td className="px-4 py-2.5 text-slate-700">
                                            {o.walkInCustomer?.name || "Walk-in"}
                                            {o.walkInCustomer?.phone ? ` · ${o.walkInCustomer.phone}` : ""}
                                        </td>
                                        <td className="px-4 py-2.5 text-slate-700">
                                            {METHOD_LABELS[o.posPaymentMethod] || o.posPaymentMethod || "-"}
                                        </td>
                                        <td className="px-4 py-2.5 text-right font-black text-slate-900">
                                            {inr(o.paymentBreakdown?.grandTotal)}
                                        </td>
                                        <td className="px-4 py-2.5">
                                            <div className="flex items-center justify-end gap-3">
                                                <button
                                                    type="button"
                                                    onClick={() => setReprint(o)}
                                                    className="flex items-center gap-1 font-bold text-slate-600 hover:text-primary"
                                                >
                                                    <HiOutlinePrinter className="h-4 w-4" /> Reprint
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        navigate(`/seller/pos/returns?order=${encodeURIComponent(o.orderId)}`)
                                                    }
                                                    className="flex items-center gap-1 font-bold text-slate-600 hover:text-primary"
                                                >
                                                    <HiOutlineArrowUturnLeft className="h-4 w-4" /> Return / Edit
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {data.totalPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
                        <Button variant="secondary" size="sm" disabled={page <= 1 || isLoading} onClick={() => load(page - 1)}>
                            Previous
                        </Button>
                        <span className="text-xs font-bold text-slate-500">
                            Page {page} of {data.totalPages}
                        </span>
                        <Button
                            variant="secondary"
                            size="sm"
                            disabled={page >= data.totalPages || isLoading}
                            onClick={() => load(page + 1)}
                        >
                            Next
                        </Button>
                    </div>
                )}
            </div>

            {reprint && (
                <ReceiptPrint
                    order={reprint}
                    shopName={shopName}
                    seller={seller}
                    heading="Bill Copy"
                    onClose={() => setReprint(null)}
                />
            )}
        </div>
    );
};

export default SalesHistory;
