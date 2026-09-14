import React, { useState, useMemo, useEffect, useRef } from 'react';
import Card from '@shared/components/ui/Card';
import Button from '@shared/components/ui/Button';
import Badge from '@shared/components/ui/Badge';
import { formatCurrencyInteger } from "@shared/utils/currency";
import Input from '@shared/components/ui/Input';
import {
    HiOutlineMagnifyingGlass,
    HiOutlineEye,
    HiOutlinePrinter,
    HiOutlineCheck,
    HiOutlineXMark,
    HiOutlineTruck,
    HiOutlineBanknotes,
    HiOutlineClock,
    HiOutlineArchiveBoxXMark,
    HiOutlineChartBar,
    HiOutlineChevronDown,
    HiOutlineChevronRight,
    HiOutlineInboxStack,
    HiOutlineMapPin,
    HiOutlinePhone,
    HiOutlineCalendarDays,
    HiOutlineArrowUturnLeft
} from 'react-icons/hi2';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

// Helper to format return status into clean, human-readable labels
const getReturnStatusLabel = (status) => {
    const s = String(status || '').toLowerCase();
    switch (s) {
        case 'return_requested':
            return 'Return Requested';
        case 'return_approved':
            return 'Return Approved';
        case 'return_rejected':
            return 'Return Rejected';
        case 'return_pickup_assigned':
        case 'return_in_transit':
            return 'Return In-Transit';
        case 'return_drop_pending':
            return 'Return at Store';
        case 'returned':
            return 'Returned to Store';
        case 'qc_passed':
            return 'QC Passed';
        case 'qc_failed':
            return 'QC Failed';
        case 'refund_completed':
            return 'Returned & Refunded';
        default:
            return s ? s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Returned';
    }
};

// Orders Page

import { MagicCard } from '@/components/ui/magic-card';
import { BlurFade } from '@/components/ui/blur-fade';
import ShimmerButton from '@/components/ui/shimmer-button';
import { sellerApi } from '../services/sellerApi';
import { useToast } from '@shared/components/ui/Toast';
import { downloadBlob } from '@/lib/exportUtils';
import { generateOrdersPDF } from '@/lib/pdfExport';
import { getLegacyStatusFromOrder } from '@/shared/utils/orderStatus';
import { Loader2 } from 'lucide-react';
import Pagination from '@shared/components/ui/Pagination';
import { DatePicker } from "@/components/ui/date-picker";
import { getOrderStatusVariant } from '../components/orders';
import { useSellerOrders } from '../context/SellerOrdersContext';

// Helper to minimize order ID length while guaranteeing 100% uniqueness
const formatMinOrderId = (rawId, index = 0, allOrders = []) => {
    if (!rawId) return `ORD-${String(index + 1).padStart(4, '0')}`;
    const str = String(rawId).trim();
    if (str.length <= 10 && !str.toLowerCase().startsWith('ord-')) {
        return `ORD-${str}`;
    }
    const cleanStr = str.replace(/^ORD-?/i, '');
    let shortCode = cleanStr.slice(-6).toUpperCase();

    if (Array.isArray(allOrders) && allOrders.length > 0) {
        const collisions = allOrders.filter(o => {
            const oId = String(o.orderId || o.id || o._id || '').replace(/^ORD-?/i, '');
            return oId.slice(-6).toUpperCase() === shortCode;
        });
        if (collisions.length > 1) {
            shortCode = cleanStr.slice(-8).toUpperCase();
        }
    }

    return `ORD-${shortCode}`;
};

// Strict status progression hierarchy - sellers only manage acceptance & packaging
const STATUS_RANK = {
    pending: 0,
    confirmed: 1,
    packed: 2,
    cancelled: 5,
};

const isStatusOptionDisabled = (currentStatus, targetStatus) => {
    const current = String(currentStatus || 'pending').toLowerCase();
    const target = String(targetStatus || '').toLowerCase();

    // Already packed or at terminal stage: seller cannot change fulfillment status
    if (['packed', 'out_for_delivery', 'delivered', 'cancelled'].includes(current)) return true;
    if (current === target) return false;

    // Sellers cannot mark out for delivery or delivered (handled strictly by delivery partner)
    if (target === 'out_for_delivery' || target === 'delivered') return true;

    // Cancellation is allowed only from pending or confirmed
    if (target === 'cancelled') return !['pending', 'confirmed'].includes(current);

    const currentRank = STATUS_RANK[current] ?? 0;
    const targetRank = STATUS_RANK[target] ?? 0;

    return targetRank < currentRank;
};

const Orders = () => {
    const { orders: ordersFromContext } = useSellerOrders();
    const [orders, setOrders] = useState([]);
    const [summary, setSummary] = useState({
        totalOrders: 0,
        totalAmount: 0,
        pending: 0,
        confirmed: 0,
        packed: 0,
        outForDelivery: 0,
        delivered: 0,
        cancelled: 0,
        returned: 0,
        activeOrders: 0,
    });
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('All');
    const [searchTerm, setSearchTerm] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
    const [isQuickViewModalOpen, setIsQuickViewModalOpen] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const { showToast } = useToast();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [total, setTotal] = useState(0);
    const hasMountedRef = useRef(false);

    // Prevent background screen scrolling when modals are open
    useEffect(() => {
        const isOpen = isDetailsModalOpen || isQuickViewModalOpen;
        if (!isOpen) return;

        // Store scroll position and lock the page
        const scrollY = window.scrollY;
        const scrollX = window.scrollX;

        document.body.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.top = `-${scrollY}px`;
        document.body.style.left = `-${scrollX}px`;
        document.body.style.width = '100%';

        return () => {
            document.body.style.overflow = '';
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.left = '';
            document.body.style.width = '';
            window.scrollTo(scrollX, scrollY);
        };
    }, [isDetailsModalOpen, isQuickViewModalOpen]);

    // Initial load: show full-page loader once
    useEffect(() => {
        fetchOrders(page, true).finally(() => {
            hasMountedRef.current = true;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Subsequent changes (page, date filters): update data without full page "refresh"
    useEffect(() => {
        if (!hasMountedRef.current) return;
        fetchOrders(page, false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [page, startDate, endDate]);

    // Real-time updates: when global context detects new orders, refresh current page silently
    useEffect(() => {
        if (!hasMountedRef.current) return;
        fetchOrders(page, false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ordersFromContext?.length, ordersFromContext?.[0]?.orderId]);

    const fetchOrders = async (requestedPage = 1, showPageLoader = false) => {
        try {
            if (showPageLoader) {
                setLoading(true);
            }
            const params = { page: requestedPage };
            if (startDate) params.startDate = startDate;
            if (endDate) params.endDate = endDate;

            const response = await sellerApi.getOrders(params);

            // Backend returns handleResponse(..., { items, page, limit, total, totalPages })
            const payload = response.data.result || {};
            const rawOrders = Array.isArray(payload.items)
                ? payload.items
                : (response.data.results || []);

            const formattedOrders = (rawOrders || []).map((order, orderIdx) => {
                const rawId = order.orderId || order._id || '';
                const shortId = formatMinOrderId(rawId, orderIdx, rawOrders);
                const discount = Math.ceil(
                    order.paymentBreakdown?.discountTotal ||
                    order.pricing?.discount ||
                    order.couponSnapshot?.discountAmountApplied ||
                    order.couponDiscount ||
                    order.discount ||
                    0
                );
                const couponCode = order.couponSnapshot?.code || order.couponCode || order.coupon?.code || (typeof order.coupon === 'string' ? order.coupon : '');

                return {
                    id: order.orderId || order._id,
                    displayId: shortId,
                    _id: order._id,
                    customer: {
                        name: order.customer?.name || 'Unknown',
                        phone: order.customer?.phone || '',
                        avatar: (order.customer?.name || 'U').charAt(0)
                    },
                    items: (order.items || []).map((item, itemIdx) => ({
                        id: item._id || `${rawId}-item-${itemIdx + 1}`,
                        itemCode: `${shortId}-P${itemIdx + 1}`,
                        name: item.name,
                        price: item.price,
                        qty: item.quantity,
                        image: item.image
                    })),
                    total: Math.ceil(order.pricing?.total || order.paymentBreakdown?.grandTotal || 0),
                    discount: discount,
                    couponCode: couponCode,
                    productSubtotal: Math.ceil(order.paymentBreakdown?.productSubtotal || order.pricing?.subtotal || (order.items || []).reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0)),
                    adminCommission: Math.ceil(order.paymentBreakdown?.adminProductCommissionTotal || 0),
                    sellerPayout: Math.ceil(order.paymentBreakdown?.sellerPayoutTotal || (order.pricing?.subtotal || (order.items || []).reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0)) - (order.paymentBreakdown?.adminProductCommissionTotal || 0)),
                    deliveryFee: Math.ceil(order.paymentBreakdown?.deliveryFeeCharged || order.pricing?.deliveryFee || 0),
                    taxTotal: Math.ceil(order.paymentBreakdown?.taxTotal || order.pricing?.gst || 0),
                    status: getLegacyStatusFromOrder(order),
                    workflowStatus: order.workflowStatus,
                    workflowVersion: order.workflowVersion,
                    returnStatus: order.returnStatus || null,
                    isReturned: Boolean(order.returnStatus && order.returnStatus !== 'none'),
                    returnReason: order.returnReason || '',
                    returnReasonDetail: order.returnReasonDetail || '',
                    returnRequestedAt: order.returnRequestedAt || null,
                    returnItems: order.returnItems || [],
                    date: order.createdAt
                        ? new Date(order.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
                        : '',
                    time: order.createdAt
                        ? new Date(order.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                        : '',
                    address: order.address
                        ? `${order.address.address || ''}, ${order.address.city || ''}`.trim()
                        : '',
                    location: order.address?.location || null,
                    payment: order.payment?.method === 'cash' || order.payment?.method === 'cod'
                        ? 'Cash on Delivery'
                        : 'Online Paid'
                };
            });

            setOrders(formattedOrders);

            const fallbackAmount = formattedOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
            setSummary({
                totalOrders: Number(payload.summary?.totalOrders || payload.total || formattedOrders.length || 0),
                totalAmount: Number(payload.summary?.totalAmount || fallbackAmount || 0),
                pending: Number(payload.summary?.pending || 0),
                confirmed: Number(payload.summary?.confirmed || 0),
                packed: Number(payload.summary?.packed || 0),
                outForDelivery: Number(payload.summary?.outForDelivery || 0),
                delivered: Number(payload.summary?.delivered || 0),
                cancelled: Number(payload.summary?.cancelled || 0),
                returned: Number(payload.summary?.returned || 0),
                activeOrders: Number(payload.summary?.activeOrders || 0),
            });
            if (typeof payload.total === 'number') {
                setTotal(payload.total);
            } else {
                setTotal(formattedOrders.length);
            }
        } catch (error) {
            console.error("Failed to fetch orders:", error);
            showToast("Failed to fetch orders", "error");
        } finally {
            if (showPageLoader) {
                setLoading(false);
            }
        }
    };

    const tabs = ['All', 'Pending', 'Confirmed', 'Packed', 'Out for Delivery', 'Delivered', 'Cancelled', 'Returned'];
    const todayStr = new Date().toISOString().split('T')[0];

    const safeOrders = useMemo(
        () => (Array.isArray(orders) ? orders : []),
        [orders]
    );

    const filteredOrders = useMemo(() => {
        return safeOrders.filter(order => {
            const query = (searchTerm || '').trim().toLowerCase();
            const orderIdStr = String(order.id || '').toLowerCase();
            const displayIdStr = String(order.displayId || '').toLowerCase();
            const customerNameStr = String(order.customer?.name || '').toLowerCase();
            const matchesSearch = !query ||
                orderIdStr.includes(query) ||
                displayIdStr.includes(query) ||
                customerNameStr.includes(query);
            const orderStatus = String(order.status || '').toLowerCase();
            const matchesTab = activeTab === 'All'
                ? true
                : activeTab === 'Returned'
                ? Boolean(order.isReturned)
                : activeTab === 'Out for Delivery'
                ? orderStatus === 'out_for_delivery'
                : orderStatus === activeTab.toLowerCase();
            return matchesSearch && matchesTab;
        });
    }, [safeOrders, searchTerm, activeTab]);

    const getTabCount = (tabName) => {
        switch (tabName) {
            case 'All': return summary.totalOrders;
            case 'Pending': return summary.pending;
            case 'Confirmed': return summary.confirmed;
            case 'Packed': return summary.packed;
            case 'Out for Delivery': return summary.outForDelivery;
            case 'Delivered': return summary.delivered;
            case 'Cancelled': return summary.cancelled;
            case 'Returned': return summary.returned;
            default: return null;
        }
    };

    const stats = useMemo(() => [
        {
            label: 'Total Orders',
            value: summary.totalOrders,
            tab: 'All',
            icon: HiOutlineArchiveBoxXMark,
            color: 'text-brand-600',
            bg: 'bg-brand-50'
        },
        {
            label: 'Pending',
            value: summary.pending,
            tab: 'Pending',
            icon: HiOutlineClock,
            color: 'text-amber-600',
            bg: 'bg-amber-50'
        },
        {
            label: 'Confirmed',
            value: summary.confirmed,
            tab: 'Confirmed',
            icon: HiOutlineCheck,
            color: 'text-brand-600',
            bg: 'bg-brand-50'
        },
        {
            label: 'Delivered',
            value: summary.delivered,
            tab: 'Delivered',
            icon: HiOutlineCheck,
            color: 'text-emerald-600',
            bg: 'bg-emerald-50'
        },
        {
            label: 'Returned',
            value: summary.returned,
            tab: 'Returned',
            icon: HiOutlineArrowUturnLeft,
            color: 'text-rose-600',
            bg: 'bg-rose-50'
        }
    ], [summary]);

    const getStatusColor = getOrderStatusVariant;

    const handleViewDetails = (order) => {
        setSelectedOrder(order);
        setIsDetailsModalOpen(true);
    };

    const handleStatusUpdate = async (orderId, newStatus) => {
        const normalized = newStatus.toLowerCase();
        if (normalized === 'out_for_delivery' || normalized === 'delivered') {
            showToast("Delivery steps are handled exclusively by the delivery partner upon OTP verification.", "error");
            return;
        }
        try {
            await sellerApi.updateOrderStatus(orderId, { status: normalized });
            showToast(`Order status updated to ${newStatus}`, "success");
            // Optimistically update the local orders list so the UI reflects
            // the new status immediately — no waiting for a full re-fetch.
            setOrders((prev) =>
                prev.map((o) =>
                    (o.id === orderId || o._id === orderId) ? { ...o, status: normalized } : o
                )
            );
            if (selectedOrder && (selectedOrder.id === orderId || selectedOrder._id === orderId)) {
                setSelectedOrder((prev) => (prev ? { ...prev, status: normalized } : null));
            }
            fetchOrders(page, false); // Sync with server in the background
        } catch (error) {
            console.error("Failed to update status:", error);
            showToast("Failed to update status", "error");
        }
    };

    const exportOrders = async () => {
        const data = filteredOrders;
        if (!data.length) {
            showToast("No orders to export", "warning");
            return;
        }
        const { blob, fileName } = await generateOrdersPDF(data);
        await downloadBlob(blob, fileName);
        showToast(`Exported ${data.length} order(s) as PDF`, "success");
    };

    return (
        <div className="space-y-4 sm:space-y-6 pb-28 sm:pb-16">
            <BlurFade delay={0.1}>
                {/* Page Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
                                Order Management
                            </h1>
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-brand-100 text-brand-700">
                                Real-time
                            </span>
                        </div>
                        <p className="text-slate-500 text-xs sm:text-sm mt-0.5 font-medium">Process and track your customer orders with ease.</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={exportOrders}
                            className="flex items-center gap-1.5 px-3 py-2 sm:px-4 sm:py-2.5 rounded-xl text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 shadow-sm transition-all active:scale-95 cursor-pointer"
                            title="Export Orders as PDF"
                        >
                            <HiOutlinePrinter className="h-4 w-4 text-slate-500" />
                            <span>Export PDF</span>
                        </button>
                        <ShimmerButton
                            onClick={() => setIsQuickViewModalOpen(true)}
                            className="px-3.5 py-2 sm:px-5 sm:py-2.5 rounded-xl text-xs font-bold text-white shadow-md flex items-center gap-1.5 active:scale-95 cursor-pointer"
                        >
                            <HiOutlineEye className="h-4 w-4 text-white" />
                            <span className="font-black">Snapshot</span>
                        </ShimmerButton>
                    </div>
                </div>
            </BlurFade>

            {/* Quick Stats */}
            {loading ? (
                <div className="min-h-[300px] sm:min-h-[400px] flex flex-col items-center justify-center bg-white rounded-3xl border border-slate-100 shadow-sm">
                    <Loader2 className="h-10 w-10 text-primary animate-spin" />
                    <p className="text-slate-600 font-bold mt-4 uppercase tracking-widest text-xs">Fetching Active Orders...</p>
                </div>
            ) : (
                <>                    {/* Stat Cards - Horizontal snap carousel on mobile, grid on desktop */}
                    <div className="flex sm:grid sm:grid-cols-3 lg:grid-cols-5 gap-2.5 overflow-x-auto scrollbar-hide py-1.5 px-1 sm:p-0 snap-x">
                        {stats.map((stat, i) => {
                            const isSelected = activeTab === stat.tab;
                            return (
                                <div
                                    key={i}
                                    onClick={() => {
                                        if (stat.tab) setActiveTab(stat.tab);
                                    }}
                                    className={cn(
                                        "snap-start shrink-0 min-w-[135px] sm:min-w-0 flex-1 bg-white rounded-2xl border transition-all duration-200 cursor-pointer p-3 sm:p-4 shadow-sm hover:shadow-md active:scale-95 group",
                                        isSelected
                                            ? "border-slate-900 ring-2 ring-slate-900/10 bg-slate-50/50 shadow-md"
                                            : "border-slate-200/80 hover:border-slate-300"
                                    )}
                                >
                                    <div className="flex items-center gap-2.5 sm:gap-3">
                                        <div className={cn("h-9 w-9 sm:h-11 sm:w-11 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 duration-200 shadow-xs shrink-0", stat.bg, stat.color)}>
                                            <stat.icon className="h-4 w-4 sm:h-5 sm:w-5" />
                                        </div>
                                        <div className="min-w-0">
                                            <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-tight whitespace-nowrap">
                                                {stat.label}
                                            </p>
                                            <h4 className="text-lg sm:text-2xl font-black text-slate-900 tracking-tight leading-tight mt-0.5">
                                                {stat.value}
                                            </h4>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Main Content Area */}
                    <BlurFade delay={0.3}>
                        <Card className="border-none shadow-xl ring-1 ring-slate-100 rounded-2xl bg-white overflow-visible" contentClassName="p-0 sm:p-5">
                            {/* Tabs with live count badges */}
                            <div className="border-b border-slate-100 bg-slate-50/50 overflow-x-auto scrollbar-hide">
                                <div className="flex px-3 sm:px-6 items-center min-w-max gap-1">
                                    {tabs.map((tab) => {
                                        const count = getTabCount(tab);
                                        const isActive = activeTab === tab;
                                        return (
                                            <button
                                                key={tab}
                                                onClick={() => setActiveTab(tab)}
                                                className={cn(
                                                    "relative py-3 sm:py-4 px-3 sm:px-4 text-xs sm:text-sm font-bold whitespace-nowrap transition-all duration-200 flex items-center gap-1.5 cursor-pointer",
                                                    isActive
                                                        ? "text-brand-600 font-black"
                                                        : "text-slate-500 hover:text-slate-700 font-semibold"
                                                )}
                                            >
                                                <span>{tab}</span>
                                                {count !== null && (
                                                    <span className={cn(
                                                        "text-[10px] px-1.5 py-0.5 rounded-full font-bold transition-all leading-none",
                                                        isActive
                                                            ? "bg-brand-100 text-brand-700"
                                                            : "bg-slate-200/80 text-slate-600"
                                                    )}>
                                                        {count}
                                                    </span>
                                                )}
                                                {isActive && (
                                                    <motion.div
                                                        layoutId="tab-underline"
                                                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600 rounded-full mx-2 sm:mx-3"
                                                    />
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Toolbox */}
                            <div className="p-3 sm:p-4 border-b border-slate-100 flex flex-col lg:flex-row gap-2.5 sm:gap-3 items-stretch lg:items-center justify-between">
                                <div className="relative flex-1 group w-full">
                                    <HiOutlineMagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-brand-600 transition-colors" />
                                    <input
                                        type="text"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        placeholder="Search orders or customer..."
                                        className="w-full pl-9 pr-8 py-2.5 bg-slate-100/70 border border-slate-200/60 rounded-xl text-xs sm:text-sm font-semibold text-slate-700 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-brand-500/10 focus:border-brand-500 transition-all outline-none"
                                    />
                                    {searchTerm && (
                                        <button
                                            type="button"
                                            onClick={() => setSearchTerm('')}
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full"
                                        >
                                            <HiOutlineXMark className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                                <div className="flex flex-col sm:flex-row gap-2 shrink-0 w-full lg:w-auto items-stretch sm:items-center justify-end">
                                    <div className="grid grid-cols-2 gap-2 w-full sm:w-auto items-center">
                                        <div className="w-full">
                                            <DatePicker
                                                value={startDate}
                                                max={todayStr}
                                                align="left"
                                                onChange={(value) => {
                                                    if (!value) {
                                                        setStartDate("");
                                                        setPage(1);
                                                        return;
                                                    }
                                                    const today = new Date().toISOString().split("T")[0];
                                                    if (value > today) {
                                                        showToast("Start date cannot be in the future", "error");
                                                        return;
                                                    }
                                                    if (endDate && value > endDate) {
                                                        showToast("Start date cannot be after end date", "error");
                                                        return;
                                                    }
                                                    setPage(1);
                                                    setStartDate(value);
                                                }}
                                                placeholder="From date"
                                            />
                                        </div>
                                        <div className="w-full">
                                            <DatePicker
                                                value={endDate}
                                                max={todayStr}
                                                min={startDate || undefined}
                                                align="right"
                                                popupClassName="mt-4"
                                                disabled={!startDate}
                                                onChange={(value) => {
                                                    if (!value) {
                                                        setEndDate("");
                                                        setPage(1);
                                                        return;
                                                    }
                                                    const today = new Date().toISOString().split("T")[0];
                                                    if (value > today) {
                                                        showToast("End date cannot be in the future", "error");
                                                        return;
                                                    }
                                                    if (startDate && value < startDate) {
                                                        showToast("End date cannot be before start date", "error");
                                                        return;
                                                    }
                                                    setPage(1);
                                                    setEndDate(value);
                                                }}
                                                placeholder="To date"
                                            />
                                        </div>
                                    </div>
                                    {(startDate || endDate) && (
                                        <button
                                            type="button"
                                            onClick={() => { setStartDate(''); setEndDate(''); setPage(1); }}
                                            className="text-xs font-bold text-rose-600 hover:text-rose-700 self-end sm:self-center px-1 py-1"
                                        >
                                            Clear dates
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Mobile: Enhanced Card list */}
                            <div className="md:hidden p-3 sm:p-4 space-y-3">
                                {filteredOrders.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12 px-4">
                                        <div className="h-14 w-14 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 mb-3">
                                            <HiOutlineInboxStack className="h-7 w-7" />
                                        </div>
                                        <h3 className="text-sm font-bold text-slate-900">No orders found</h3>
                                        <p className="text-xs text-slate-600 font-medium text-center mt-1">Adjust filters or search.</p>
                                        <Button variant="outline" className="mt-4 rounded-xl text-xs" onClick={() => { setActiveTab('All'); setSearchTerm(''); }}>CLEAR FILTERS</Button>
                                    </div>
                                ) : (
                                <AnimatePresence mode="popLayout">
                                    {filteredOrders.map((order) => {
                                        const isPending = order.status.toLowerCase() === 'pending';
                                        const isConfirmed = order.status.toLowerCase() === 'confirmed';

                                        return (
                                            <motion.div
                                                key={order.id}
                                                initial={{ opacity: 0, y: 6 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, scale: 0.96 }}
                                                className="bg-white border border-slate-200/90 rounded-2xl p-4 shadow-sm space-y-3 relative overflow-hidden"
                                            >
                                                {/* Top status accent stripe */}
                                                <div className={cn(
                                                    "absolute top-0 left-0 right-0 h-1",
                                                    order.isReturned ? "bg-rose-500" :
                                                    isPending ? "bg-amber-500" :
                                                    isConfirmed ? "bg-brand-500" :
                                                    order.status.toLowerCase() === 'packed' ? "bg-blue-500" :
                                                    order.status.toLowerCase() === 'out_for_delivery' ? "bg-purple-500" :
                                                    order.status.toLowerCase() === 'delivered' ? "bg-emerald-500" :
                                                    "bg-slate-300"
                                                )} />

                                                {/* Card Top Row: Order ID + Date & Status Dropdown / Badge */}
                                                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5 pt-0.5">
                                                    <div className="min-w-0">
                                                        <div className="flex items-center gap-1.5 flex-wrap">
                                                            <span className="font-mono bg-slate-100 text-slate-900 px-2 py-0.5 rounded-lg text-xs font-bold tracking-tight">
                                                                #{order.displayId || order.id}
                                                            </span>
                                                            {order.isReturned && (
                                                                <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-black px-2 py-0.5 rounded-full">
                                                                    <HiOutlineArrowUturnLeft className="h-3 w-3 shrink-0" />
                                                                    Return
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1 mt-1">
                                                            <HiOutlineCalendarDays className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                                            <span>{order.date} • {order.time}</span>
                                                        </span>
                                                    </div>
                                                    {order.isReturned ? (
                                                        <div className="flex flex-col items-end gap-0.5 shrink-0">
                                                            <span className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full font-black uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-200 shadow-xs">
                                                                <HiOutlineArrowUturnLeft className="h-3 w-3" />
                                                                {getReturnStatusLabel(order.returnStatus)}
                                                            </span>
                                                            {order.returnReason && (
                                                                <span className="text-[10px] text-slate-500 font-medium truncate max-w-[130px]" title={order.returnReason}>
                                                                    {order.returnReason}
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="relative shrink-0">
                                                            <select
                                                                value={order.status}
                                                                onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
                                                                onClick={(e) => e.stopPropagation()}
                                                                disabled={['packed', 'out_for_delivery', 'delivered', 'cancelled'].includes(order.status.toLowerCase())}
                                                                className={cn(
                                                                    "text-[10px] px-2.5 py-1 rounded-full font-black uppercase tracking-wider appearance-none border-none outline-none shadow-xs text-center",
                                                                    ['packed', 'out_for_delivery', 'delivered', 'cancelled'].includes(order.status.toLowerCase()) ? "cursor-not-allowed opacity-90" : "cursor-pointer",
                                                                    order.status === 'pending' ? "bg-amber-100 text-amber-800" :
                                                                        order.status === 'confirmed' ? "bg-brand-100 text-brand-700" :
                                                                            order.status === 'packed' ? "bg-brand-100 text-brand-700" :
                                                                                order.status === 'out_for_delivery' ? "bg-purple-100 text-purple-700" :
                                                                                    order.status === 'delivered' ? "bg-emerald-100 text-emerald-800" :
                                                                                        order.status === 'cancelled' ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-700"
                                                                )}
                                                            >
                                                                <option value="pending" disabled={isStatusOptionDisabled(order.status, 'pending')}>Pending</option>
                                                                <option value="confirmed" disabled={isStatusOptionDisabled(order.status, 'confirmed')}>Confirmed</option>
                                                                <option value="packed" disabled={isStatusOptionDisabled(order.status, 'packed')}>Packed</option>
                                                                <option value="out_for_delivery" disabled title="Handled by delivery partner">Out (Rider)</option>
                                                                <option value="delivered" disabled title="Handled by delivery partner with OTP">Delivered (OTP)</option>
                                                                <option value="cancelled" disabled={isStatusOptionDisabled(order.status, 'cancelled')}>Cancelled</option>
                                                            </select>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Customer & Price Row */}
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                                                        <div className="h-9 w-9 rounded-full bg-slate-900 flex items-center justify-center text-xs font-black text-white shrink-0 shadow-xs">
                                                            {order.customer.avatar}
                                                        </div>
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-bold text-slate-900 truncate leading-snug">{order.customer.name}</p>
                                                            <p className="text-xs text-slate-500 font-medium flex items-center gap-1 mt-0.5">
                                                                <HiOutlinePhone className="h-3 w-3 text-slate-400 shrink-0" />
                                                                <span className="font-mono text-slate-600">{order.customer.phone || 'No phone'}</span>
                                                            </p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right shrink-0">
                                                        <p className="text-lg font-black text-slate-900 leading-tight">₹{order.total.toLocaleString('en-IN')}</p>
                                                        <div className="flex items-center justify-end gap-1.5 mt-1">
                                                            <span className="text-[10px] font-bold text-slate-500">
                                                                {order.items.length} {order.items.length === 1 ? 'item' : 'items'}
                                                            </span>
                                                            <span className={cn(
                                                                "text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md tracking-wider border",
                                                                order.payment === 'Cash on Delivery'
                                                                    ? "bg-amber-50 text-amber-800 border-amber-200"
                                                                    : "bg-emerald-50 text-emerald-800 border-emerald-200"
                                                            )}>
                                                                {order.payment === 'Cash on Delivery' ? 'COD' : 'Online'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Order Items Preview */}
                                                {order.items && order.items.length > 0 && (
                                                    <div className="bg-slate-50/90 rounded-xl p-2.5 border border-slate-100 text-xs space-y-1">
                                                        <div className="space-y-1">
                                                            {order.items.slice(0, 3).map((it, idx) => (
                                                                <div key={it.id || idx} className="flex items-center justify-between text-slate-700 font-medium text-[11px]">
                                                                    <span className="truncate pr-2">{it.name}</span>
                                                                    <span className="font-bold text-slate-900 shrink-0">×{it.qty}</span>
                                                                </div>
                                                            ))}
                                                            {order.items.length > 3 && (
                                                                <p className="text-[10px] text-brand-600 font-bold pt-0.5">
                                                                    +{order.items.length - 3} more items
                                                                </p>
                                                            )}
                                                        </div>
                                                        {order.discount > 0 && (
                                                            <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 text-[10px] font-bold text-emerald-600">
                                                                <span>Coupon Discount {order.couponCode ? `(${order.couponCode})` : ''}</span>
                                                                <span>-₹{order.discount}</span>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Card Quick Actions */}
                                                <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                                                    <button
                                                        onClick={() => handleViewDetails(order)}
                                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                                                    >
                                                        <HiOutlineEye className="h-3.5 w-3.5 text-slate-500" />
                                                        <span>View Details</span>
                                                    </button>

                                                    <div className="flex items-center gap-1.5">
                                                        {isPending && (
                                                            <>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleStatusUpdate(order.id, 'cancelled');
                                                                    }}
                                                                    className="flex items-center gap-1 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 active:scale-95 text-rose-700 rounded-xl text-xs font-bold border border-rose-200/80 transition-all cursor-pointer"
                                                                    title="Reject Order"
                                                                >
                                                                    <HiOutlineXMark className="h-3.5 w-3.5" />
                                                                    <span>Reject</span>
                                                                </button>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleStatusUpdate(order.id, 'confirmed');
                                                                    }}
                                                                    className="flex items-center gap-1 px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                                                                    title="Accept & Confirm Order"
                                                                >
                                                                    <HiOutlineCheck className="h-3.5 w-3.5" />
                                                                    <span>Accept</span>
                                                                </button>
                                                            </>
                                                        )}

                                                        {isConfirmed && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleStatusUpdate(order.id, 'packed');
                                                                }}
                                                                className="flex items-center gap-1 px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-xs transition-all cursor-pointer"
                                                                title="Mark Packed"
                                                            >
                                                                <HiOutlineCheck className="h-3.5 w-3.5" />
                                                                <span>Mark Packed</span>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            </motion.div>
                                        );
                                    })}
                                </AnimatePresence>
                                )}
                            </div>

                            {/* Desktop: Table */}
                            <div className="hidden md:block overflow-x-auto">
                                <table className="w-full text-left border-collapse min-w-[640px] relative">
                                    <thead className="sticky top-0 z-20 bg-slate-50 shadow-sm">
                                        <tr className="border-b border-slate-200">
                                            <th className="px-4 lg:px-6 py-3 lg:py-4 text-xs font-bold text-slate-700 uppercase tracking-widest">Order Details</th>
                                            <th className="px-4 lg:px-6 py-3 lg:py-4 text-xs font-bold text-slate-600 uppercase tracking-widest">Customer</th>
                                            <th className="px-4 lg:px-6 py-3 lg:py-4 text-xs font-bold text-slate-600 uppercase tracking-widest">Total</th>
                                            <th className="px-4 lg:px-6 py-3 lg:py-4 text-xs font-bold text-slate-600 uppercase tracking-widest">Status</th>
                                            <th className="px-4 lg:px-6 py-3 lg:py-4 text-xs font-bold text-slate-600 uppercase tracking-widest text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        <AnimatePresence mode="popLayout">
                                            {filteredOrders
                                                .map((order) => (
                                                <motion.tr
                                                    layout
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, scale: 0.95 }}
                                                    key={order.id}
                                                    className="hover:bg-slate-50/50 transition-colors group"
                                                >
                                                    <td className="px-4 lg:px-6 py-3 lg:py-4">
                                                        <div>
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span className="text-xs font-bold text-slate-900 group-hover:text-primary transition-colors cursor-pointer" onClick={() => handleViewDetails(order)}>
                                                                    #{order.displayId || order.id}
                                                                </span>
                                                                {order.isReturned && (
                                                                    <span className="inline-flex items-center gap-1 bg-rose-50 text-rose-700 border border-rose-200 text-[9px] font-black px-1.5 py-0.5 rounded-full">
                                                                        <HiOutlineArrowUturnLeft className="h-2.5 w-2.5 shrink-0" />
                                                                        RETURN
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mt-1">
                                                                <HiOutlineCalendarDays className="h-3 w-3" />
                                                                {order.date} • {order.time}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 lg:px-6 py-3 lg:py-4">
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-8 w-8 rounded-full bg-slate-900 flex items-center justify-center text-[10px] font-black text-white shadow-sm ring-2 ring-white">
                                                                {order.customer.avatar}
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-bold text-slate-900">{order.customer.name}</p>
                                                                <p className="text-xs font-semibold text-slate-600">{order.customer.phone}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 lg:px-6 py-3 lg:py-4">
                                                        <div className="flex flex-col">
                                                            <span className="text-xs font-bold text-slate-900">₹{order.total.toLocaleString()}</span>
                                                            {order.discount > 0 && (
                                                                <span className="text-[10px] font-bold text-emerald-600">
                                                                    Coupon: -₹{order.discount} {order.couponCode ? `(${order.couponCode})` : ''}
                                                                </span>
                                                            )}
                                                            <span className="text-xs font-semibold text-slate-600">{order.items.length} items</span>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 lg:px-6 py-3 lg:py-4">
                                                        {order.isReturned ? (
                                                            <div className="flex flex-col items-start gap-1">
                                                                <span className="inline-flex items-center gap-1 text-[10px] px-3 py-1.5 rounded-full font-black uppercase tracking-wider bg-rose-100 text-rose-700 border border-rose-200 shadow-sm">
                                                                    <HiOutlineArrowUturnLeft className="h-3 w-3 shrink-0" />
                                                                    {getReturnStatusLabel(order.returnStatus)}
                                                                </span>
                                                                {order.returnReason && (
                                                                    <span className="text-[10px] text-slate-500 font-medium truncate max-w-[170px]" title={order.returnReason}>
                                                                        Reason: {order.returnReason}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <div className="relative inline-block w-36">
                                                                <select
                                                                    value={order.status}
                                                                    onChange={(e) => handleStatusUpdate(order.id, e.target.value)}
                                                                    disabled={['packed', 'out_for_delivery', 'delivered', 'cancelled'].includes(order.status.toLowerCase())}
                                                                    className={cn(
                                                                        "w-full text-[10px] px-3 py-1.5 rounded-full font-black uppercase tracking-widest appearance-none focus:ring-2 focus:ring-offset-1 transition-all border-none outline-none shadow-sm text-center",
                                                                        ['packed', 'out_for_delivery', 'delivered', 'cancelled'].includes(order.status.toLowerCase()) ? "cursor-not-allowed opacity-90" : "cursor-pointer",
                                                                        order.status === 'pending' ? "bg-amber-100 text-amber-700 focus:ring-amber-200" :
                                                                            order.status === 'confirmed' ? "bg-brand-100 text-brand-700 focus:ring-brand-200" :
                                                                                order.status === 'packed' ? "bg-brand-100 text-brand-700 focus:ring-brand-200" :
                                                                                    order.status === 'out_for_delivery' ? "bg-purple-100 text-purple-700 focus:ring-purple-200" :
                                                                                        order.status === 'delivered' ? "bg-brand-100 text-brand-700 focus:ring-brand-200" :
                                                                                            order.status === 'cancelled' ? "bg-rose-100 text-rose-700 focus:ring-rose-200" :
                                                                                                "bg-slate-100 text-slate-700 focus:ring-slate-200"
                                                                    )}
                                                                >
                                                                    <option value="pending" disabled={isStatusOptionDisabled(order.status, 'pending')}>Pending</option>
                                                                    <option value="confirmed" disabled={isStatusOptionDisabled(order.status, 'confirmed')}>Confirmed</option>
                                                                    <option value="packed" disabled={isStatusOptionDisabled(order.status, 'packed')}>Packed</option>
                                                                    <option value="out_for_delivery" disabled title="Handled by delivery partner">Out (Rider only)</option>
                                                                    <option value="delivered" disabled title="Handled by delivery partner with OTP">Delivered (OTP only)</option>
                                                                    <option value="cancelled" disabled={isStatusOptionDisabled(order.status, 'cancelled')}>Cancelled</option>
                                                                </select>
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td className="px-4 lg:px-6 py-3 lg:py-4 text-right">
                                                        <div className="flex items-center justify-end space-x-1.5">
                                                            <button
                                                                onClick={() => handleViewDetails(order)}
                                                                className="p-1.5 hover:bg-white hover:text-primary rounded-lg transition-all text-slate-600 shadow-sm ring-1 ring-slate-100"
                                                            >
                                                                <HiOutlineEye className="h-4 w-4" />
                                                            </button>
                                                            {order.status.toLowerCase() === 'pending' && (
                                                                <>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleStatusUpdate(order.id, 'confirmed');
                                                                        }}
                                                                        className="p-1.5 hover:bg-brand-50 hover:text-brand-600 rounded-lg transition-all text-slate-600 shadow-sm ring-1 ring-slate-100"
                                                                        title="Confirm Order"
                                                                    >
                                                                        <HiOutlineCheck className="h-4 w-4" />
                                                                    </button>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleStatusUpdate(order.id, 'cancelled');
                                                                        }}
                                                                        className="p-1.5 hover:bg-rose-50 hover:text-rose-600 rounded-lg transition-all text-slate-600 shadow-sm ring-1 ring-slate-100"
                                                                        title="Cancel Order"
                                                                    >
                                                                        <HiOutlineXMark className="h-4 w-4" />
                                                                    </button>
                                                                </>
                                                            )}
                                                        </div>
                                                    </td>
                                                </motion.tr>
                                            ))}
                                        </AnimatePresence>
                                    </tbody>
                                </table>
                                {filteredOrders.length === 0 && (
                                    <div className="flex flex-col items-center justify-center py-20 px-6">
                                        <div className="h-16 w-16 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-300 mb-4">
                                            <HiOutlineInboxStack className="h-8 w-8" />
                                        </div>
                                        <h3 className="text-sm font-bold text-slate-900">No orders found</h3>
                                        <p className="text-xs text-slate-600 font-medium max-w-xs text-center mt-1">We couldn't find any orders matching your current filters. Try adjusting your search.</p>
                                        <Button variant="outline" className="mt-6 rounded-xl text-xs" onClick={() => { setActiveTab('All'); setSearchTerm(''); }}>CLEAR ALL FILTERS</Button>
                                    </div>
                                )}
                            </div>

                            <div className="p-3 sm:p-4 border-t border-slate-50 bg-slate-50/30 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 px-3 sm:px-6">
                                <p className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest text-center sm:text-left">
                                    Showing {filteredOrders.length} of {total || summary.totalOrders || filteredOrders.length} Orders
                                </p>
                                <div className="flex gap-1 justify-center sm:justify-end">
                                    <button className="p-1.5 rounded-lg border border-slate-200 text-slate-600 opacity-50 cursor-not-allowed" aria-hidden><HiOutlineChevronRight className="h-3.5 w-3.5 rotate-180" /></button>
                                    <button className="p-1.5 rounded-lg border border-slate-200 text-slate-600 opacity-50 cursor-not-allowed" aria-hidden><HiOutlineChevronRight className="h-3.5 w-3.5" /></button>
                                </div>
                            </div>
                        </Card>
                    </BlurFade>

                    <div className="mt-3 sm:mt-4 px-2 sm:px-0">
                        <Pagination
                            page={page}
                            totalPages={Math.ceil((total || filteredOrders.length) / pageSize) || 1}
                            total={total || filteredOrders.length}
                            pageSize={pageSize}
                            onPageChange={(p) => setPage(p)}
                            onPageSizeChange={(newSize) => {
                                setPageSize(newSize);
                                setPage(1);
                                fetchOrders(1, false);
                            }}
                            loading={loading}
                        />
                    </div>

                    {/* Order Details Modal */}
                    {/* ... (existing details modal) */}

                    {/* Quick View Summary Modal */}
                    <AnimatePresence>
                        {isQuickViewModalOpen && (
                            <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 overscroll-contain">
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm"
                                    onClick={() => setIsQuickViewModalOpen(false)}
                                />
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                    className="w-full max-w-lg relative z-10 bg-white rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto overscroll-contain touch-pan-y"
                                >
                                    <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="h-10 w-10 bg-slate-900 text-white rounded-xl flex items-center justify-center shadow-md shrink-0">
                                                <HiOutlineChartBar className="h-5 w-5 text-white" />
                                            </div>
                                            <div className="min-w-0">
                                                <h3 className="text-sm sm:text-base font-black text-slate-900 truncate">Quick Snapshot</h3>
                                                <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest">Performance Overview</p>
                                            </div>
                                        </div>
                                        <button onClick={() => setIsQuickViewModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors text-slate-600 shrink-0">
                                            <HiOutlineXMark className="h-5 w-5" />
                                        </button>
                                    </div>

                                    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">
                                        {/* Summary Grid */}
                                        <div className="grid grid-cols-2 gap-3 sm:gap-4">
                                            <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-sm">
                                                <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Total Revenue</p>
                                                <p className="text-base sm:text-xl font-black text-slate-900 truncate">₹{Number(summary.totalAmount || 0).toLocaleString('en-IN')}</p>
                                            </div>
                                            <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-sm">
                                                <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Avg. Order Value</p>
                                                <p className="text-base sm:text-xl font-black text-slate-900">₹{summary.totalOrders ? (summary.totalAmount / summary.totalOrders).toFixed(0) : '0'}</p>
                                            </div>
                                            <div className="p-3.5 sm:p-4 rounded-2xl bg-slate-50 border border-slate-200/80 shadow-sm">
                                                <p className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Total Orders</p>
                                                <p className="text-base sm:text-xl font-black text-slate-900">{summary.totalOrders || 0}</p>
                                            </div>
                                            <div className="p-3.5 sm:p-4 rounded-2xl bg-amber-50/80 border border-amber-200/80 shadow-sm">
                                                <p className="text-[10px] sm:text-xs font-bold text-amber-700 uppercase tracking-widest mb-1">Pending Orders</p>
                                                <p className="text-base sm:text-xl font-black text-amber-900">{summary.pending || 0}</p>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-100">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setIsQuickViewModalOpen(false);
                                                setActiveTab('Pending');
                                            }}
                                            className="w-full py-3 px-4 rounded-xl text-xs font-black uppercase tracking-wider bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
                                        >
                                            VIEW ALL PENDING ORDERS ({summary.pending || 0})
                                        </button>
                                    </div>
                                </motion.div>
                            </div>
                        )}
                    </AnimatePresence>
                    <AnimatePresence>
                        {isDetailsModalOpen && selectedOrder && (
                            <div className="fixed inset-0 z-[100] flex items-stretch sm:items-center justify-center p-3 sm:p-6 lg:p-12 overscroll-contain">
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    className="fixed inset-0 bg-slate-900/40 backdrop-blur-md"
                                    onClick={() => setIsDetailsModalOpen(false)}
                                />
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                    className="w-full max-w-lg sm:max-w-2xl relative z-10 bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] overscroll-contain"
                                >
                                    {/* Modal Header */}
                                    <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100">
                                        <div className="flex items-center space-x-3">
                                            <div className="h-10 w-10 bg-slate-900 text-white rounded-xl flex items-center justify-center shadow-lg">
                                                <HiOutlineTruck className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <h3 className="text-base font-black text-slate-900">Order Details</h3>
                                                <div className="flex items-center space-x-2 mt-0.5 flex-wrap gap-y-1">
                                                    {selectedOrder.isReturned ? (
                                                        <span className="inline-flex items-center gap-1 bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full">
                                                            <HiOutlineArrowUturnLeft className="h-3 w-3 shrink-0" />
                                                            {getReturnStatusLabel(selectedOrder.returnStatus)}
                                                        </span>
                                                    ) : (
                                                        <Badge variant={getStatusColor(selectedOrder.status)} className="text-[10px] font-black uppercase tracking-widest px-1.5 py-0">{selectedOrder.status}</Badge>
                                                    )}
                                                    <span className="text-xs font-bold text-slate-600 uppercase tracking-widest">#{selectedOrder.displayId || selectedOrder.id}</span>
                                                </div>
                                                {(selectedOrder.date || selectedOrder.time) && (
                                                    <p className="text-[11px] font-bold text-slate-500 mt-1.5 flex items-center gap-1.5">
                                                        <HiOutlineCalendarDays className="h-3.5 w-3.5" />
                                                        {selectedOrder.date}
                                                        {selectedOrder.time && (
                                                            <>
                                                                <span className="text-slate-300">•</span>
                                                                <HiOutlineClock className="h-3.5 w-3.5" />
                                                                {selectedOrder.time}
                                                            </>
                                                        )}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <button onClick={() => setIsDetailsModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-600">
                                            <HiOutlineXMark className="h-5 w-5" />
                                        </button>
                                    </div>

                                    <div className="px-4 py-4 sm:px-6 sm:py-5 overflow-y-auto overscroll-contain touch-pan-y scrollbar-hide flex-1">
                                        {selectedOrder.isReturned && (
                                            <div className="bg-rose-50/90 border border-rose-200/90 p-3.5 sm:p-4 rounded-2xl mb-4 sm:mb-6 shadow-sm">
                                                <div className="flex items-center justify-between gap-2 mb-2">
                                                    <h4 className="text-xs font-black text-rose-900 uppercase tracking-widest flex items-center gap-1.5">
                                                        <HiOutlineArrowUturnLeft className="h-4 w-4 text-rose-600" />
                                                        Customer Return Details
                                                    </h4>
                                                    <span className="text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full bg-rose-200/80 text-rose-900">
                                                        {getReturnStatusLabel(selectedOrder.returnStatus)}
                                                    </span>
                                                </div>
                                                <div className="space-y-1 text-xs">
                                                    {selectedOrder.returnReason && (
                                                        <p className="text-slate-800">
                                                            <span className="font-bold text-slate-600">Return Reason: </span>
                                                            <span className="font-semibold text-rose-950">{selectedOrder.returnReason}</span>
                                                        </p>
                                                    )}
                                                    {selectedOrder.returnReasonDetail && (
                                                        <p className="text-slate-700">
                                                            <span className="font-bold text-slate-600">Customer Note: </span>
                                                            <span className="italic">{selectedOrder.returnReasonDetail}</span>
                                                        </p>
                                                    )}
                                                    {selectedOrder.returnRequestedAt && (
                                                        <p className="text-[11px] text-slate-500 pt-0.5">
                                                            Requested on: {new Date(selectedOrder.returnRequestedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
                                            <div className="space-y-3 sm:space-y-4">
                                                <div>
                                                    <div className="flex items-center justify-between gap-2 mb-2">
                                                        <h4 className="text-xs font-black text-slate-600 uppercase tracking-widest flex items-center gap-2">
                                                            <HiOutlineMapPin className="h-3 w-3 text-primary" /> Delivery Address
                                                        </h4>
                                                        {selectedOrder.location &&
                                                            typeof selectedOrder.location.lat === "number" &&
                                                            typeof selectedOrder.location.lng === "number" && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        const { lat, lng } = selectedOrder.location;
                                                                        window.open(
                                                                            `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
                                                                            "_blank",
                                                                        );
                                                                    }}
                                                                    className="text-[10px] font-bold text-primary hover:underline"
                                                                >
                                                                    View on map
                                                                </button>
                                                            )}
                                                    </div>
                                                    <p className="text-xs font-bold text-slate-800 leading-relaxed bg-slate-50 p-3 rounded-2xl border border-slate-100 shadow-sm">
                                                        {selectedOrder.address}
                                                    </p>
                                                </div>
                                                <div>
                                                    <h4 className="text-xs font-black text-slate-600 uppercase tracking-widest mb-2 flex items-center gap-2">
                                                        <HiOutlinePhone className="h-3 w-3 text-brand-500" /> Contact Info
                                                    </h4>
                                                    <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100 shadow-sm">
                                                        <p className="text-xs font-bold text-slate-800">{selectedOrder.customer.name}</p>
                                                        <p className="text-xs font-semibold text-slate-600 mt-0.5">{selectedOrder.customer.phone}</p>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="space-y-4">
                                                <div className="bg-slate-900 p-4 rounded-3xl text-white border border-slate-800 shadow-xl relative overflow-hidden">
                                                    <div className="flex items-center justify-between mb-3">
                                                        <h4 className="text-xs font-black text-emerald-400 uppercase tracking-widest">Earnings Breakdown</h4>
                                                        <span className="text-[10px] bg-emerald-500/20 text-emerald-300 font-bold px-2 py-0.5 rounded-full">Seller Share</span>
                                                    </div>
                                                    <div className="space-y-2 text-xs">
                                                        <div className="flex justify-between text-slate-300">
                                                            <span className="font-semibold">Item Subtotal</span>
                                                            <span className="font-bold text-white">{formatCurrencyInteger(selectedOrder.productSubtotal || selectedOrder.items.reduce((s, i) => s + i.price * i.qty, 0))}</span>
                                                        </div>
                                                        {selectedOrder.discount > 0 && (
                                                            <div className="flex justify-between text-emerald-400 font-bold">
                                                                <span className="font-semibold flex items-center gap-1">
                                                                    🏷️ Coupon Discount {selectedOrder.couponCode ? `(${selectedOrder.couponCode})` : ''}
                                                                </span>
                                                                <span>- {formatCurrencyInteger(selectedOrder.discount)}</span>
                                                            </div>
                                                        )}
                                                        {selectedOrder.adminCommission > 0 && (
                                                            <div className="flex justify-between text-rose-300">
                                                                <span className="font-semibold">Platform Commission</span>
                                                                <span className="font-bold">- {formatCurrencyInteger(selectedOrder.adminCommission)}</span>
                                                            </div>
                                                        )}
                                                        <div className="h-px bg-slate-800 my-2" />
                                                        <div className="flex justify-between items-center bg-emerald-500/10 p-2.5 rounded-2xl border border-emerald-500/20">
                                                            <div>
                                                                <p className="text-[10px] font-bold text-emerald-400 uppercase">Your Net Earning</p>
                                                                <p className="text-[10px] text-slate-400">Credited to Balance</p>
                                                            </div>
                                                            <span className="text-base font-black text-emerald-400">{formatCurrencyInteger(selectedOrder.sellerPayout || selectedOrder.productSubtotal)}</span>
                                                        </div>
                                                        <div className="pt-1 flex justify-between items-center text-[11px] text-slate-400">
                                                            <span>Customer Paid Total:</span>
                                                            <span className="text-slate-200 font-black">
                                                                {formatCurrencyInteger(selectedOrder.total)}
                                                                {selectedOrder.discount > 0 && (
                                                                    <span className="ml-1 text-[10px] font-semibold text-emerald-400">
                                                                        ({formatCurrencyInteger(selectedOrder.discount)} coupon off)
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                <div className="bg-slate-900 p-3 sm:p-4 rounded-3xl text-white shadow-xl shadow-slate-900/10">
                                                    <h4 className="text-xs font-black text-slate-600 uppercase tracking-widest mb-2">Payment Status</h4>
                                                    <div className="flex items-center gap-2">
                                                        <HiOutlineBanknotes className="h-5 w-5 text-brand-400" />
                                                        <span className="text-xs font-bold tracking-tight">{selectedOrder.payment}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <h4 className="text-xs font-black text-slate-600 uppercase tracking-widest mb-3 sm:mb-4">Items Ordered ({selectedOrder.items.length})</h4>
                                        <div className="space-y-3 max-h-52 sm:max-h-64 overflow-y-auto overscroll-contain touch-pan-y pr-1">
                                            {selectedOrder.items.map((item, idx) => (
                                                <div key={idx} className="flex items-center justify-between p-3 bg-white ring-1 ring-slate-100 rounded-2xl group hover:shadow-md transition-all">
                                                    <div className="flex items-center gap-4">
                                                        <div className="h-12 w-12 rounded-xl overflow-hidden bg-slate-50 ring-1 ring-slate-200">
                                                            <img src={item.image} alt={item.name} className="h-full w-full object-cover group-hover:scale-110 transition-transform duration-500" />
                                                        </div>
                                                        <div>
                                                            <p className="text-xs font-bold text-slate-900">{item.name}</p>
                                                            {item.itemCode && <p className="text-[10px] font-semibold text-slate-500 font-mono mt-0.5">Code: {item.itemCode}</p>}
                                                            <p className="text-xs font-semibold text-slate-600 mt-0.5">{formatCurrencyInteger(item.price)} × {item.qty}</p>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-xs font-black text-slate-900">{formatCurrencyInteger(item.price * item.qty)}</p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Modal Footer */}
                                    <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-slate-100 bg-slate-50 flex flex-col sm:flex-row gap-3 sm:gap-0 sm:items-center justify-end">
                                        <div className="flex gap-2 items-center">
                                            <button onClick={() => setIsDetailsModalOpen(false)} className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-600 hover:bg-slate-100 transition-all">CLOSE</button>
                                            <div className="relative inline-block w-40">
                                                <select
                                                    value={selectedOrder.status.toLowerCase()}
                                                    onChange={(e) => handleStatusUpdate(selectedOrder.id, e.target.value)}
                                                    disabled={['delivered', 'cancelled'].includes(selectedOrder.status.toLowerCase())}
                                                    className={cn(
                                                        "w-full text-xs px-3 py-2 rounded-xl font-black uppercase tracking-wider border appearance-none focus:ring-2 focus:ring-offset-1 transition-all outline-none shadow-sm text-center",
                                                        ['delivered', 'cancelled'].includes(selectedOrder.status.toLowerCase()) ? "cursor-not-allowed opacity-90" : "cursor-pointer",
                                                        getStatusColor(selectedOrder.status) === 'warning' ? "bg-amber-100 text-amber-700 focus:ring-amber-200" :
                                                            getStatusColor(selectedOrder.status) === 'info' ? "bg-brand-100 text-brand-700 focus:ring-brand-200" :
                                                                getStatusColor(selectedOrder.status) === 'primary' ? "bg-brand-100 text-brand-700 focus:ring-brand-200" :
                                                                    getStatusColor(selectedOrder.status) === 'secondary' ? "bg-purple-100 text-purple-700 focus:ring-purple-200" :
                                                                        getStatusColor(selectedOrder.status) === 'success' ? "bg-brand-100 text-brand-700 focus:ring-brand-200" :
                                                                            getStatusColor(selectedOrder.status) === 'error' ? "bg-rose-100 text-rose-700 focus:ring-rose-200" :
                                                                                "bg-slate-100 text-slate-700 focus:ring-slate-200"
                                                    )}
                                                >
                                                    <option value="pending" disabled={isStatusOptionDisabled(selectedOrder.status, 'pending')}>Pending</option>
                                                    <option value="confirmed" disabled={isStatusOptionDisabled(selectedOrder.status, 'confirmed')}>Confirmed</option>
                                                    <option value="packed" disabled={isStatusOptionDisabled(selectedOrder.status, 'packed')}>Packed</option>
                                                    <option value="out_for_delivery" disabled={isStatusOptionDisabled(selectedOrder.status, 'out_for_delivery')}>Out for Delivery</option>
                                                    <option value="delivered" disabled={isStatusOptionDisabled(selectedOrder.status, 'delivered')}>Delivered</option>
                                                    <option value="cancelled" disabled={isStatusOptionDisabled(selectedOrder.status, 'cancelled')}>Cancelled</option>
                                                </select>
                                            </div>
                                        </div>
                                    </div>
                                </motion.div>
                            </div>
                        )}
                    </AnimatePresence>
                </>
            )}
        </div>
    );
};

export default Orders;
