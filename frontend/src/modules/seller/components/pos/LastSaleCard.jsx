import React from "react";
import { HiOutlinePrinter, HiOutlinePencilSquare, HiOutlineXMark, HiOutlineCheckCircle } from "react-icons/hi2";
import { formatAmount } from "@shared/utils/currency";

const METHOD_LABELS = { CASH: "Cash", CARD: "Card", QR: "QR / UPI", CREDIT: "Credit", OTHER: "Other", SPLIT: "Split" };

/**
 * The bill just completed at this counter, kept on screen after the receipt
 * closes so a failed print can be reprinted or a wrong entry fixed without
 * leaving the terminal.
 */
const LastSaleCard = ({ order, onReprint, onEdit, onDismiss, isEditLoading = false }) => {
    if (!order) return null;
    const items = Array.isArray(order.items) ? order.items : [];
    const itemCount = items.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
    const isEdited = Array.isArray(order.posEdits) && order.posEdits.length > 0;

    return (
        <div className="bg-emerald-50/70 rounded-2xl border border-emerald-200 p-3">
            <div className="flex items-start gap-2">
                <HiOutlineCheckCircle className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black uppercase tracking-wider text-emerald-700">
                        Last sale (saved)
                        {isEdited && <span className="ml-1.5 text-amber-600">edited</span>}
                    </p>
                    <p className="text-sm font-black text-slate-900 truncate">
                        #{order.orderId} · ₹{formatAmount(order.paymentBreakdown?.grandTotal)}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">
                        {new Date(order.createdAt || Date.now()).toLocaleTimeString("en-IN", {
                            hour: "2-digit",
                            minute: "2-digit",
                        })}{" "}
                        · {itemCount} item(s) · {METHOD_LABELS[order.posPaymentMethod] || order.posPaymentMethod || "Cash"}
                        {order.walkInCustomer?.name ? ` · ${order.walkInCustomer.name}` : ""}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={onDismiss}
                    className="text-slate-400 hover:text-slate-600"
                    title="Hide last sale"
                >
                    <HiOutlineXMark className="h-4 w-4" />
                </button>
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2.5">
                <button
                    type="button"
                    onClick={onReprint}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-primary hover:text-primary"
                >
                    <HiOutlinePrinter className="h-4 w-4" /> Reprint
                </button>
                <button
                    type="button"
                    onClick={onEdit}
                    disabled={isEditLoading}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:border-primary hover:text-primary disabled:opacity-50"
                >
                    <HiOutlinePencilSquare className="h-4 w-4" /> {isEditLoading ? "Loading…" : "Edit bill"}
                </button>
            </div>
        </div>
    );
};

export default LastSaleCard;
