import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Package, ChevronRight, Clock, CheckCircle, Loader2, ChevronLeft, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { useCart } from '../context/CartContext';
import { customerApi } from '../services/customerApi';
import { getOrderStatusLabel, getLegacyStatusFromOrder } from '@/shared/utils/orderStatus';
import { applyCloudinaryTransform } from '@/core/utils/imageUtils';
import { formatCurrencyInteger } from "@shared/utils/currency";
import ProductRatingModal from '../components/order/ProductRatingModal';

const OrdersPage = () => {
    const navigate = useNavigate();
    const { reorderOrder } = useCart();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isRatingModalOpen, setIsRatingModalOpen] = useState(false);
    const [selectedRatingOrderId, setSelectedRatingOrderId] = useState(null);
    const [reorderingMap, setReorderingMap] = useState({});

    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const response = await customerApi.getMyOrders();
                // Backend uses handleResponse():
                // - arrays => { results: [...] }
                // - objects => { result: { items: [...] } }
                const payload = response?.data;
                const items =
                    payload?.result?.items ||
                    payload?.results ||
                    [];
                setOrders(Array.isArray(items) ? items : []);
            } catch (error) {
                console.error("Failed to fetch orders:", error);
                const apiMessage = error?.response?.data?.message;
                // Orders page is a primary screen; surface failures instead of silently showing empty state.
                if (apiMessage) {
                    console.warn("[OrdersPage] API error:", apiMessage);
                }
            } finally {
                setLoading(false);
            }
        };

        fetchOrders();
    }, []);

    const handleReorder = async (e, order) => {
        e.preventDefault();
        e.stopPropagation();
        const orderKey = order._id || order.orderId;
        if (!orderKey || reorderingMap[orderKey]) return;

        setReorderingMap((prev) => ({ ...prev, [orderKey]: true }));

        const handleSuccessNotification = (result) => {
            const addedCount = Number(
                result?.addedCount ?? result?.summary?.addedItemCount ?? 0
            );
            const status = result?.status || (addedCount > 0 ? "FULL" : "NONE");

            if (status === "NONE" || addedCount === 0) {
                toast.error(
                    result?.message || "Items from this order are currently unavailable or out of stock."
                );
                return;
            }

            if (status === "PARTIAL") {
                const itemWord = addedCount === 1 ? "item" : "items";
                toast.warning(
                    `${addedCount} ${itemWord} added to cart. Some items were unavailable or adjusted for stock.`
                );
            } else {
                const itemWord = addedCount === 1 ? "item" : "items";
                toast.success(`${addedCount} ${itemWord} added to your cart!`);
            }

            navigate("/cart");
        };

        try {
            const res = await reorderOrder(orderKey, {
                onConfirmSuccess: (result) => handleSuccessNotification(result),
            });

            if (res?.conflict) {
                return;
            }

            if (res?.success) {
                handleSuccessNotification(res.result);
            }
        } catch (error) {
            console.error("Reorder failed:", error);
            const msg = error?.response?.data?.message || "Unable to reorder. Please try again.";
            toast.error(msg);
        } finally {
            setReorderingMap((prev) => ({ ...prev, [orderKey]: false }));
        }
    };

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50">
                <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white shadow-sm border border-slate-100">
                    <Loader2 className="animate-spin text-brand-600" size={22} />
                    <span className="text-sm font-medium text-slate-600">Loading your orders…</span>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-slate-50 pb-24">
            <div className="sticky top-0 z-30 bg-slate-50/95 backdrop-blur-sm px-4 pt-4 pb-3 border-b border-slate-200/60 mb-4 flex items-center gap-2">
                <button
                    onClick={() => navigate(-1)}
                    className="w-10 h-10 flex items-center justify-center hover:bg-slate-200/70 rounded-full transition-colors -ml-1"
                >
                    <ChevronLeft size={22} className="text-slate-800" />
                </button>
                <h1 className="text-xl font-semibold text-slate-900 tracking-tight">My Orders</h1>
            </div>

            <div className="space-y-4 px-4 pb-2">
                {orders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <Package size={56} className="text-slate-300 mb-4" />
                        <h3 className="text-base font-semibold text-slate-900 mb-1">No orders yet</h3>
                        <p className="text-slate-500 text-sm mb-6 max-w-[260px]">
                            When you place an order, it will appear here so you can track it easily.
                        </p>
                        <Link to="/" className="bg-primary hover:bg-[#0a6d19] text-white px-7 py-2.5 rounded-full font-semibold text-sm shadow-sm transition-colors">
                            Start Shopping
                        </Link>
                    </div>
                ) : (
                    orders.map((order) => {
                        const legacy = getLegacyStatusFromOrder(order);
                        return (
                        <Link
                            to={`/orders/${order.orderId}`}
                            key={order._id}
                            className="flex flex-col justify-between bg-white rounded-2xl px-4 py-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.06)] border border-slate-100/80 active:scale-[0.985] transition-transform cursor-pointer hover:shadow-[0_10px_30px_rgba(15,23,42,0.08)] min-h-[160px]"
                        >
                            <div className="flex justify-between items-start gap-3 h-12">
                                <div className="flex gap-3.5 flex-1 min-w-0 items-center">
                                    <div className="h-12 w-12 rounded-xl overflow-hidden flex items-center justify-center bg-slate-50 ring-1 ring-slate-200/90 shrink-0">
                                        {order.items[0]?.image ? (
                                            <img
                                                src={applyCloudinaryTransform(order.items[0].image)}
                                                alt={order.items[0]?.name || 'Order thumbnail'}
                                                loading="lazy"
                                                className="w-full h-full object-cover"
                                            />
                                        ) : (
                                            <Package size={22} className="text-slate-400" />
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <h3 className="font-semibold text-slate-900 text-sm tracking-tight leading-snug truncate">
                                            Order #{order.orderId.slice(-6)}
                                        </h3>
                                        <p className="mt-0.5 text-[11px] text-slate-500 font-medium leading-tight truncate">
                                            {new Date(order.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}{' '}
                                            <span className="mx-1 text-slate-400">•</span>
                                            {new Date(order.createdAt).toLocaleTimeString('en-IN', {
                                                hour: '2-digit',
                                                minute: '2-digit',
                                            })}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex flex-col items-end justify-center gap-1 shrink-0 text-right">
                                    <span
                                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                                            legacy === 'delivered'
                                                ? 'bg-brand-50 text-brand-700 border-brand-100'
                                                : legacy === 'cancelled'
                                                    ? 'bg-rose-50 text-rose-700 border-rose-100'
                                                    : 'bg-brand-50 text-brand-700 border-brand-100'
                                        }`}
                                    >
                                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/80">
                                            <CheckCircle
                                                size={9}
                                                className={`${
                                                    legacy === 'delivered'
                                                        ? 'text-brand-600'
                                                        : legacy === 'cancelled'
                                                            ? 'text-rose-500'
                                                            : 'text-brand-500'
                                                }`}
                                            />
                                        </span>
                                        <span>{getOrderStatusLabel(order).toUpperCase()}</span>
                                    </span>
                                    <span className="inline-flex items-center text-[10px] font-medium text-slate-400">
                                        <span className="h-1 w-1 rounded-full bg-slate-300 mr-1" />
                                        Tap to view details
                                    </span>
                                </div>
                            </div>

                            <div className="border-t border-slate-100 pt-2.5 mt-2.5">
                                <div className="text-[11px] text-slate-500 font-medium truncate h-4 leading-4 mb-2.5">
                                    {order.items?.length > 0 ? order.items.map((i) => i.name).join(', ') : '\u00A0'}
                                </div>
                                <div className="flex justify-between items-center gap-1.5 h-7">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <button
                                            type="button"
                                            id={`buy-again-btn-${order.orderId}`}
                                            onClick={(e) => handleReorder(e, order)}
                                            disabled={Boolean(reorderingMap[order._id || order.orderId])}
                                            className="px-2.5 py-1 bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-100 rounded-full text-[10.5px] font-bold flex items-center gap-1 transition-colors shadow-xs disabled:opacity-60 cursor-pointer shrink-0"
                                        >
                                            {reorderingMap[order._id || order.orderId] ? (
                                                <Loader2 size={12} className="animate-spin text-emerald-600" />
                                            ) : (
                                                <RotateCcw size={12} className="text-emerald-600" />
                                            )}
                                            <span>Buy Again</span>
                                        </button>
                                        {legacy === 'delivered' && (
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setSelectedRatingOrderId(order._id || order.orderId);
                                                    setIsRatingModalOpen(true);
                                                }}
                                                className="px-2.5 py-1 bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 rounded-full text-[10.5px] font-bold flex items-center gap-1 transition-colors shadow-xs shrink-0"
                                            >
                                                ⭐ Rate Products
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                        <span className="text-[10px] font-medium text-slate-400">Total</span>
                                        <span className="text-xs font-semibold text-slate-900">
                                            {formatCurrencyInteger(order.pricing?.total || order.total || 0)}
                                        </span>
                                        <ChevronRight size={14} className="text-slate-300" />
                                    </div>
                                </div>
                            </div>
                        </Link>
                    );
                    })
                )}
            </div>

            {/* Product Rating Modal */}
            <ProductRatingModal
                isOpen={isRatingModalOpen}
                onClose={() => {
                    setIsRatingModalOpen(false);
                    setSelectedRatingOrderId(null);
                }}
                orderId={selectedRatingOrderId}
            />
        </div>
    );
};

export default OrdersPage;

