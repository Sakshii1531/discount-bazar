import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
    HiOutlineTruck,
    HiOutlineCheck,
    HiOutlineArrowTopRightOnSquare,
    HiOutlineClock,
    HiOutlineCheckCircle,
    HiOutlineArchiveBox,
    HiOutlineUser,
    HiOutlineArrowDownTray,
} from "react-icons/hi2";
import Button from "@shared/components/ui/Button";
import { cn } from "@/lib/utils";
import { sellerApi } from "../../services/sellerApi";
import { formatAmount } from "@shared/utils/currency";
import { downloadPosOnlineOrdersPDF } from "@/lib/posPdfExport";

/**
 * Clean & minimal online orders queue for POS counter.
 * Shows customer app orders awaiting packing or delivery handover.
 */
const FILTER_LABELS = { all: "All", needs_packing: "To Pack", packed: "Packed" };

const OnlineOrdersPanel = ({ orders = [], onChanged, shopName }) => {
    const navigate = useNavigate();
    const [busyId, setBusyId] = useState(null);
    const [filter, setFilter] = useState("all");

    const updateStatus = async (order, status, label) => {
        setBusyId(order.orderId);
        try {
            await sellerApi.updateOrderStatus(order.orderId, { status });
            toast.success(`Order #${order.orderId} ${label}`);
            onChanged?.();
        } catch (e) {
            toast.error(e?.response?.data?.message || "Could not update the order");
        } finally {
            setBusyId(null);
        }
    };

    const needsPackingCount = useMemo(
        () => orders.filter((o) => String(o.status || "").toLowerCase() !== "packed").length,
        [orders],
    );

    const packedCount = useMemo(
        () => orders.filter((o) => String(o.status || "").toLowerCase() === "packed").length,
        [orders],
    );

    const filteredOrders = useMemo(() => {
        if (filter === "needs_packing") {
            return orders.filter((o) => String(o.status || "").toLowerCase() !== "packed");
        }
        if (filter === "packed") {
            return orders.filter((o) => String(o.status || "").toLowerCase() === "packed");
        }
        return orders;
    }, [orders, filter]);

    if (orders.length === 0) {
        return (
            <div className="bg-white rounded-2xl border border-slate-200/80 p-12 text-center max-w-lg mx-auto shadow-xs space-y-3.5 my-8">
                <div className="h-14 w-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto border border-emerald-100 shadow-2xs">
                    <HiOutlineTruck className="h-7 w-7 stroke-1.5" />
                </div>
                <div className="space-y-1">
                    <h3 className="text-sm font-black text-slate-900">No Orders in Queue</h3>
                    <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                        New orders from the customer app will show up here automatically for quick counter packing.
                    </p>
                </div>
                <div className="pt-1">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate("/seller/orders")}
                        className="text-xs font-semibold"
                    >
                        <HiOutlineArrowTopRightOnSquare className="h-4 w-4 mr-1.5" />
                        View All Orders
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4 w-full pb-8">
            {/* Minimal & Clean Header */}
            <div className="bg-white rounded-2xl border border-slate-200/80 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                        <h1 className="text-base font-black text-slate-900 tracking-tight">Online Orders</h1>
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-full">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                            Live Queue ({orders.length})
                        </span>
                    </div>
                    <p className="text-xs text-slate-500">
                        App delivery orders ready for store packaging & rider pickup
                    </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                {/* Minimal Segmented Filter Tabs */}
                <div className="flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200/60 text-xs">
                    <button
                        type="button"
                        onClick={() => setFilter("all")}
                        className={cn(
                            "px-3 py-1 rounded-lg font-bold transition-all",
                            filter === "all"
                                ? "bg-white text-slate-900 shadow-xs"
                                : "text-slate-500 hover:text-slate-800",
                        )}
                    >
                        All ({orders.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilter("needs_packing")}
                        className={cn(
                            "px-3 py-1 rounded-lg font-bold transition-all",
                            filter === "needs_packing"
                                ? "bg-white text-slate-900 shadow-xs"
                                : "text-slate-500 hover:text-slate-800",
                        )}
                    >
                        To Pack ({needsPackingCount})
                    </button>
                    <button
                        type="button"
                        onClick={() => setFilter("packed")}
                        className={cn(
                            "px-3 py-1 rounded-lg font-bold transition-all",
                            filter === "packed"
                                ? "bg-white text-slate-900 shadow-xs"
                                : "text-slate-500 hover:text-slate-800",
                        )}
                    >
                        Packed ({packedCount})
                    </button>
                </div>
                <Button
                    variant="secondary"
                    size="sm"
                    disabled={filteredOrders.length === 0}
                    onClick={() =>
                        downloadPosOnlineOrdersPDF({
                            orders: filteredOrders,
                            filterLabel: FILTER_LABELS[filter],
                            shopName,
                        }).catch(() => toast.error("Failed to download orders"))
                    }
                    className="text-xs font-semibold"
                >
                    <HiOutlineArrowDownTray className="h-4 w-4 mr-1.5" />
                    Download PDF
                </Button>
                </div>
            </div>

            {/* Orders Cards List */}
            <div className="space-y-3">
                {filteredOrders.map((order) => {
                    const ws = String(order.workflowStatus || "").toUpperCase();
                    const status = String(order.status || "").toLowerCase();
                    const isNew = ws === "SELLER_PENDING" || (!ws && status === "pending");
                    const isPacked = status === "packed";
                    const isDeliveryAssigned = ws === "DELIVERY_ASSIGNED";
                    const busy = busyId === order.orderId;
                    const items = Array.isArray(order.items) ? order.items : [];
                    const customerName =
                        order.shippingAddress?.fullName ||
                        order.customer?.name ||
                        order.user?.name ||
                        "";
                    const grandTotal = Math.round(
                        Number(order.paymentBreakdown?.grandTotal || order.pricing?.total || 0),
                    );

                    return (
                        <div
                            key={order.orderId}
                            className="bg-white rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-xs hover:border-slate-300 transition-all space-y-3.5"
                        >
                            {/* Card Header */}
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100">
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-black text-slate-900 tracking-tight">
                                        #{order.orderId}
                                    </span>

                                    {/* Status Badge */}
                                    {isNew ? (
                                        <span className="text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200/70 px-2 py-0.5 rounded-md flex items-center gap-1">
                                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                            Needs Acceptance
                                        </span>
                                    ) : isPacked ? (
                                        <span className="text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/70 px-2 py-0.5 rounded-md flex items-center gap-1">
                                            <HiOutlineCheckCircle className="h-3 w-3 text-emerald-600" />
                                            Packed
                                        </span>
                                    ) : (
                                        <span className="text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200/70 px-2 py-0.5 rounded-md flex items-center gap-1">
                                            <HiOutlineArchiveBox className="h-3 w-3 text-blue-600" />
                                            Needs Packing
                                        </span>
                                    )}

                                    {isDeliveryAssigned && (
                                        <span className="text-[10px] font-bold bg-purple-50 text-purple-800 border border-purple-200/70 px-2 py-0.5 rounded-md">
                                            Rider Assigned
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                                    <HiOutlineClock className="h-3.5 w-3.5" />
                                    <span>
                                        {new Date(order.createdAt).toLocaleTimeString("en-IN", {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </span>
                                </div>
                            </div>

                            {/* Items & Customer Row */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                                <div className="space-y-1 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        {items.map((it, idx) => (
                                            <span
                                                key={idx}
                                                className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200/80 px-2.5 py-1 rounded-lg text-slate-800 font-semibold"
                                            >
                                                <span className="text-emerald-700 font-bold">{it.quantity}x</span>
                                                <span>{it.name || "Item"}</span>
                                                {it.variantSlot && (
                                                    <span className="text-[10px] text-slate-500 font-normal">
                                                        ({it.variantSlot})
                                                    </span>
                                                )}
                                            </span>
                                        ))}
                                    </div>

                                    {customerName && (
                                        <p className="text-[11px] text-slate-500 flex items-center gap-1 pt-0.5">
                                            <HiOutlineUser className="h-3 w-3 text-slate-400" />
                                            <span>Customer: <strong className="text-slate-700">{customerName}</strong></span>
                                        </p>
                                    )}
                                </div>

                                <div className="text-right shrink-0">
                                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Amount</p>
                                    <p className="text-base font-black text-slate-900">
                                        ₹{formatAmount(grandTotal)}
                                    </p>
                                </div>
                            </div>

                            {/* Card Footer: Action Buttons */}
                            <div className="flex items-center justify-end gap-2 pt-2.5 border-t border-slate-100">
                                {isNew ? (
                                    <Button
                                        size="sm"
                                        isLoading={busy}
                                        onClick={() => updateStatus(order, "confirmed", "accepted")}
                                        className="h-8 px-3 text-xs font-bold shadow-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                    >
                                        <HiOutlineCheck className="h-3.5 w-3.5 mr-1 stroke-2" /> Accept Order
                                    </Button>
                                ) : !isPacked ? (
                                    <Button
                                        size="sm"
                                        isLoading={busy}
                                        onClick={() => updateStatus(order, "packed", "marked packed")}
                                        className="h-8 px-3 text-xs font-bold shadow-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                                    >
                                        <HiOutlineCheck className="h-3.5 w-3.5 mr-1 stroke-2" /> Mark Packed
                                    </Button>
                                ) : (
                                    <div className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg">
                                        <HiOutlineCheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                                        Packed & Ready
                                    </div>
                                )}

                                <button
                                    type="button"
                                    onClick={() => navigate(`/seller/orders?search=${encodeURIComponent(order.orderId)}`)}
                                    className="h-8 inline-flex items-center gap-1 px-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-lg transition-colors"
                                >
                                    <HiOutlineArrowTopRightOnSquare className="h-3.5 w-3.5 text-slate-400" />
                                    <span>Orders</span>
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default OnlineOrdersPanel;
