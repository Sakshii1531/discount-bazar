// Comprehensive Order Management System
import React, { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Card from '@shared/components/ui/Card';
import Badge from '@shared/components/ui/Badge';
import Pagination from '@shared/components/ui/Pagination';
import { adminApi } from '../services/adminApi';
import {
    Search,
    Filter,
    Truck,
    Eye,
    Download,
    Calendar,
    ArrowUpRight,
    Package,
    IndianRupee,
    ChevronDown,
    ShoppingBag,
    Clock,
    CheckCircle2,
    XCircle,
    RotateCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@shared/components/ui/Toast';
import { motion, AnimatePresence } from 'framer-motion';
import {
    getLegacyStatusFromOrder,
    adminRouteMatchesOrder,
} from '@/shared/utils/orderStatus';
import { exportToCSV } from '@/lib/exportUtils';

const OrdersList = () => {
    const { status = 'all' } = useParams();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState('All Time');
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
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [isExporting, setIsExporting] = useState(false);
    const [isDateMenuOpen, setIsDateMenuOpen] = useState(false);
    const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
    const [paymentFilter, setPaymentFilter] = useState('All');

    const handleCSVExport = () => {
        setIsExporting(true);
        try {
            if (!orders || orders.length === 0) {
                showToast("No data to export", "warning");
                return;
            }
            const formatted = orders.map(o => ({
                "Order ID": o.id || '',
                "Customer": o.customer || '',
                "Seller": o.seller || '',
                "Status": (o.status || '').toUpperCase(),
                "Amount (INR)": o.amount || 0,
                "Date": o.date || '',
                "Payment": o.payment || ''
            }));
            exportToCSV(formatted, `Orders_${status}`);
            showToast("CSV Exported successfully", "success");
        } catch (error) {
            console.error("Export error:", error);
            showToast("Export failed", "error");
        } finally {
            setIsExporting(false);
        }
    };

    const fetchOrders = async (requestedPage = 1) => {
        setIsLoading(true);
        try {
            const params = { page: requestedPage, limit: pageSize };
            if (status !== 'all') params.status = status;
            if (searchTerm.trim()) params.search = searchTerm.trim();
            if (dateRange !== 'All Time') {
                params.dateFilter = dateRange.toLowerCase().replace(/ /g, '_');
            }
            const response = await adminApi.getOrders(params);
            if (response.data.success) {
                const payload = response.data.result || {};
                const dbOrders = Array.isArray(payload.items) ? payload.items : (response.data.results || []);
                const formatted = dbOrders.map(o => ({
                    id: o.orderId || 'UNSET',
                    _id: o._id,
                    customer: o.customer?.name || 'Unknown',
                    seller: o.seller?.shopName || 'Unknown',
                    items: o.items?.length || 0,
                    amount: Math.ceil(o.pricing?.total || o.total || 0),
                    status: getLegacyStatusFromOrder(o),
                    workflowStatus: o.workflowStatus,
                    workflowVersion: o.workflowVersion,
                    returnStatus: o.returnStatus,
                    date: new Date(o.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                    payment: o.payment?.method === 'cod' ? 'COD' : 'Digital',
                }));
                setOrders(formatted);
                setSummary({
                    totalOrders: Number(payload.summary?.totalOrders || payload.total || formatted.length || 0),
                    totalAmount: Number(payload.summary?.totalAmount || 0),
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
                    setTotal(formatted.length);
                }
                if (typeof payload.page === 'number') {
                    setPage(payload.page);
                } else {
                    setPage(requestedPage);
                }
            }
        } catch (error) {
            console.error("Fetch orders error:", error);
            showToast("Failed to load orders", "error");
        } finally {
            setIsLoading(false);
        }
    };

    const handleStatusUpdate = async (orderId, newStatus) => {
        try {
            await adminApi.updateOrderStatus(orderId, { status: newStatus });
            showToast(`Order status updated to ${newStatus}`, "success");
            fetchOrders(); // Refresh table
        } catch (error) {
            console.error("Failed to update status:", error);
            showToast("Failed to update status", "error");
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchOrders(1);
        }, 500);
        return () => clearTimeout(timer);
    }, [pageSize, status, searchTerm, dateRange]);

    const safeOrders = useMemo(
        () => (Array.isArray(orders) ? orders : []),
        [orders]
    );

    const stats = useMemo(() => {
        const totalEarnings = summary.totalAmount;
        const activeOrders = summary.activeOrders;

        return [
            { label: 'Total Earnings', value: `₹${totalEarnings.toLocaleString('en-IN')}`, trend: '+12.5%', icon: IndianRupee, color: 'emerald' },
            { label: 'Active Orders', value: activeOrders, trend: '+5', icon: ShoppingBag, color: 'blue' },
            { label: 'Average Prep Time', value: '18m', trend: '-2m', icon: Clock, color: 'amber' },
            { label: 'Delivery Rate', value: '98.2%', trend: '+0.4%', icon: CheckCircle2, color: 'fuchsia' },
        ];
    }, [summary]);

    const filteredOrders = useMemo(() => {
        return safeOrders.filter(order => {
            const safeLower = (value) => String(value || '').toLowerCase();
            const query = safeLower(searchTerm);
            const matchesSearch =
                safeLower(order.id).includes(query) ||
                safeLower(order.customer).includes(query) ||
                safeLower(order.seller).includes(query);

            const matchesStatus = adminRouteMatchesOrder(status, order);
            const matchesPayment = paymentFilter === 'All' || order.payment === paymentFilter;

            return matchesSearch && matchesStatus && matchesPayment;
        });
    }, [safeOrders, searchTerm, status, paymentFilter]);

    const getStatusStyles = (status) => {
        switch (String(status || '').toLowerCase()) {
            case 'pending': return 'bg-amber-100 text-amber-600 border-amber-200';
            case 'confirmed': return 'bg-brand-100 text-brand-600 border-brand-200';
            case 'packed': return 'bg-brand-100 text-brand-600 border-brand-200';
            case 'out_for_delivery': return 'bg-purple-100 text-purple-600 border-purple-200';
            case 'delivered': return 'bg-brand-100 text-brand-600 border-brand-200';
            case 'cancelled': return 'bg-rose-100 text-rose-600 border-rose-200';
            case 'returned': return 'bg-slate-100 text-slate-600 border-slate-200';
            default: return 'bg-gray-100 text-gray-600 border-gray-200';
        }
    };

    const handleExport = async () => {
        if (safeOrders.length === 0) {
            showToast('No data to export', 'warning');
            return;
        }

        try {
            setIsExporting(true);
            let exportData = safeOrders;
            try {
                const params = { page: 1, limit: 5000 };
                if (status !== 'all') params.status = status;
                if (searchTerm.trim()) params.search = searchTerm.trim();
                if (dateRange !== 'All Time') {
                    params.dateFilter = dateRange.toLowerCase().replace(/ /g, '_');
                }
                const response = await adminApi.getOrders(params);
                if (response?.data?.success) {
                    const payload = response.data.result || {};
                    const dbOrders = Array.isArray(payload.items) ? payload.items : (response.data.results || []);
                    if (dbOrders.length > 0) {
                        exportData = dbOrders.map(o => ({
                            id: o.orderId || 'UNSET',
                            customer: o.customer?.name || 'Unknown',
                            seller: o.seller?.shopName || 'Unknown',
                            items: o.items?.length || 0,
                            amount: o.pricing?.total || 0,
                            status: getLegacyStatusFromOrder(o),
                            date: new Date(o.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
                            payment: o.payment?.method === 'cod' ? 'COD' : 'Digital',
                        }));
                    }
                }
            } catch (err) {
                console.warn("Falling back to loaded orders for export", err);
            }

            const formatted = exportData.map(o => ({
                "Order ID": o.id || '',
                "Date": (o.date || '').replace(/,/g, ''),
                "Customer": (o.customer || '').replace(/,/g, ''),
                "Seller": (o.seller || '').replace(/,/g, ''),
                "Items": o.items || 0,
                "Amount (INR)": o.amount || 0,
                "Status": (o.status || '').toUpperCase(),
                "Payment": o.payment || ''
            }));

            exportToCSV(formatted, `Orders_${status}`);
            showToast('Order ledger exported successfully', 'success');
        } catch (error) {
            console.error("Export error:", error);
            showToast('Export failed', 'error');
        } finally {
            setIsExporting(false);
        }
    };

    const pageTitle = status === 'all' ? 'All Orders' : status.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

    return (
        <div className="ds-section-spacing animate-in fade-in slide-in-from-bottom-4 duration-700 pb-12">
            {/* Header Section */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 px-1">
                <div>
                    <h1 className="ds-h1 flex items-center gap-3">
                        {pageTitle}
                        <div className="p-2 bg-fuchsia-100 rounded-xl">
                            <ShoppingBag className="h-5 w-5 text-fuchsia-600" />
                        </div>
                    </h1>
                    <p className="ds-description mt-1">View and manage all orders.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="flex items-center gap-2 px-5 py-3 bg-white ring-1 ring-slate-200 text-slate-700 rounded-2xl text-xs font-bold hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
                    >
                        {isExporting ? <RotateCw className="h-4 w-4 animate-spin text-brand-500" /> : <Download className="h-4 w-4 text-brand-500" />}
                        {isExporting ? 'EXPORTING...' : 'EXPORT'}
                    </button>
                    <div className="h-10 w-px bg-slate-200 mx-1 hidden lg:block" />
                    <div className="relative">
                        <button
                            onClick={() => setIsDateMenuOpen(!isDateMenuOpen)}
                            className="flex items-center gap-2 px-5 py-3 bg-white ring-1 ring-slate-200 text-slate-700 rounded-2xl text-xs font-bold hover:bg-slate-50 transition-all shadow-sm active:scale-95"
                        >
                            <Calendar className="h-4 w-4 text-brand-500" />
                            {dateRange}
                        </button>

                        <AnimatePresence>
                            {isDateMenuOpen && (
                                <>
                                    <div className="fixed inset-0 z-10" onClick={() => setIsDateMenuOpen(false)} />
                                    <motion.div
                                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                        className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl ring-1 ring-slate-100 p-2 z-20"
                                    >
                                        {['All Time', 'Today', 'Yesterday', 'Last 7 Days', 'This Month'].map((range) => (
                                            <button
                                                key={range}
                                                onClick={() => {
                                                    setDateRange(range);
                                                    setIsDateMenuOpen(false);
                                                }}
                                                className={cn(
                                                    "w-full text-left px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all",
                                                    dateRange === range ? "bg-brand-50 text-brand-600" : "text-slate-500 hover:bg-slate-50"
                                                )}
                                            >
                                                {range}
                                            </button>
                                        ))}
                                    </motion.div>
                                </>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </div>

            {/* Stats Overview */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat, i) => (
                    <Card key={i} className="p-5 border-none shadow-sm ring-1 ring-slate-100 bg-white group hover:ring-fuchsia-200 transition-all text-left">
                        <div className="flex items-center justify-between mb-4">
                            <div className={cn("p-2 rounded-xl", `bg-${stat.color}-50`)}>
                                <stat.icon className={cn("h-5 w-5", `text-${stat.color}-600`)} />
                            </div>
                            {stat.trend && (
                                <Badge variant="success" className="bg-brand-50 text-brand-600 border-none font-bold text-[10px]">
                                    {stat.trend}
                                </Badge>
                            )}
                        </div>
                        <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{stat.label}</p>
                            <h3 className="text-2xl font-black text-slate-900">{stat.value}</h3>
                        </div>
                    </Card>
                ))}
            </div>

            {/* Orders Table Section */}
            <Card className="border-none shadow-2xl ring-1 ring-slate-100/50 bg-white rounded-xl overflow-hidden">
                <div className="p-6 border-b border-slate-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="relative group flex-1 max-w-md">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-300 group-focus-within:text-fuchsia-500 transition-colors" />
                        <input
                            type="text"
                            placeholder="Search by Order ID, Customer, or Shop..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-11 pr-4 py-3 bg-slate-50 border-none rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-fuchsia-500/10 transition-all"
                        />
                    </div>
                    <div className="flex items-center gap-3">
                        {status === 'processed' && (
                            <button
                                onClick={handleCSVExport}
                                disabled={isExporting}
                                className="flex items-center gap-2 px-4 py-2.5 bg-fuchsia-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-fuchsia-700 transition-all shadow-lg shadow-fuchsia-100 disabled:opacity-50"
                            >
                                <Download className={cn("h-3.5 w-3.5", isExporting && "animate-bounce")} />
                                {isExporting ? 'Exporting...' : 'Export CSV'}
                            </button>
                        )}
                        <div className="relative">
                            <button 
                                onClick={() => setIsFilterMenuOpen(!isFilterMenuOpen)}
                                className="p-3 bg-slate-50 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all active:scale-95">
                                <Filter className="h-4 w-4" />
                            </button>
                            <AnimatePresence>
                                {isFilterMenuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setIsFilterMenuOpen(false)} />
                                        <motion.div
                                            initial={{ opacity: 0, y: 10, scale: 0.95 }}
                                            animate={{ opacity: 1, y: 0, scale: 1 }}
                                            exit={{ opacity: 0, y: 10, scale: 0.95 }}
                                            className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-2xl ring-1 ring-slate-100 p-2 z-20"
                                        >
                                            <p className="px-4 py-2 text-[9px] font-black text-slate-400 uppercase tracking-widest">Payment Method</p>
                                            {['All', 'COD', 'Digital'].map((method) => (
                                                <button
                                                    key={method}
                                                    onClick={() => {
                                                        setPaymentFilter(method);
                                                        setIsFilterMenuOpen(false);
                                                    }}
                                                    className={cn(
                                                        "w-full text-left px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all",
                                                        paymentFilter === method ? "bg-fuchsia-50 text-fuchsia-600" : "text-slate-500 hover:bg-slate-50"
                                                    )}
                                                >
                                                    {method}
                                                </button>
                                            ))}
                                        </motion.div>
                                    </>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-50/50">
                                <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Order Details</th>
                                <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Customer</th>
                                <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Seller</th>
                                <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                                <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Amount</th>
                                <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {isLoading ? (
                                <tr>
                                    <td colSpan="6" className="px-4 py-20 text-center">
                                        <div className="flex justify-center flex-col items-center gap-2">
                                            <div className="h-8 w-8 border-4 border-fuchsia-600 border-t-transparent rounded-full animate-spin"></div>
                                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading Orders...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : filteredOrders.length > 0 ? filteredOrders.map((order) => (
                                <tr key={order.id} className="group hover:bg-slate-50/30 transition-all cursor-pointer" onClick={() => navigate(`/admin/orders/view/${order.id}`)}>
                                    <td className="px-4 py-5">
                                        <div className="flex items-center gap-4">
                                            <div className="p-3 bg-slate-50 rounded-2xl group-hover:bg-white group-hover:shadow-sm transition-all text-slate-400 group-hover:text-fuchsia-500 font-bold text-xs">
                                                <Package className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-black text-slate-900 flex items-center gap-2">
                                                    #{order.id}
                                                    <ArrowUpRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-all text-slate-400" />
                                                </h4>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <Badge variant="outline" className="text-[9px] font-bold border-slate-200 text-slate-400 py-0.5">
                                                        {order.items} {order.items > 1 ? 'Items' : 'Item'}
                                                    </Badge>
                                                    <span className="text-[10px] font-bold text-slate-300">•</span>
                                                    <span className="text-[10px] font-bold text-slate-400">{order.date}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-5">
                                        <div className="flex items-center gap-2">
                                            <div className="h-2 w-2 rounded-full bg-brand-500" />
                                            <span className="text-xs font-black text-slate-700">{order.customer}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-5">
                                        <div className="flex items-center gap-2">
                                            <div className="h-2 w-2 rounded-full bg-brand-500" />
                                            <span className="text-xs font-black text-slate-700">{order.seller}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-5" onClick={(e) => e.stopPropagation()}>
                                        {['delivered', 'cancelled'].includes(String(order.status || '').toLowerCase()) ? (
                                            <span className={cn(
                                                "inline-block text-[10px] px-3 py-1.5 rounded-xl font-black uppercase tracking-wider border shadow-sm",
                                                getStatusStyles(order.status)
                                            )}>
                                                {order.status.replace(/_/g, ' ')}
                                            </span>
                                        ) : (
                                            <div className="relative inline-block w-40">
                                                <select
                                                    value={order.status}
                                                    onChange={(e) => handleStatusUpdate(order._id, e.target.value)}
                                                    className={cn(
                                                        "w-full text-[10px] pl-3 pr-8 py-2 rounded-xl font-black uppercase tracking-wider border appearance-none cursor-pointer focus:ring-2 focus:ring-offset-1 transition-all outline-none shadow-sm",
                                                        getStatusStyles(order.status)
                                                    )}
                                                >
                                                    <option value="pending" disabled={['confirmed','packed','out_for_delivery','delivered','cancelled'].includes(String(order.status || '').toLowerCase())}>Pending</option>
                                                    <option value="confirmed" disabled={['packed','out_for_delivery','delivered','cancelled'].includes(String(order.status || '').toLowerCase())}>Confirmed</option>
                                                    <option value="packed" disabled={['out_for_delivery','delivered','cancelled'].includes(String(order.status || '').toLowerCase())}>Packed</option>
                                                    <option value="out_for_delivery" disabled={['delivered','cancelled'].includes(String(order.status || '').toLowerCase())}>Out for Delivery</option>
                                                    <option value="delivered">Delivered</option>
                                                    <option value="cancelled">Cancelled</option>
                                                </select>
                                                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 pointer-events-none opacity-60" />
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-4 py-5 text-right">
                                        <div className="flex flex-col items-end">
                                            <span className="text-sm font-black text-slate-900">₹{Math.ceil(order.amount || 0).toLocaleString('en-IN')}</span>
                                            <span className="text-[10px] font-bold text-slate-400 mt-0.5">{order.payment}</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-5 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {status === 'processed' && order.status === 'confirmed' && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleStatusUpdate(order._id, 'packed');
                                                    }}
                                                    className="flex items-center gap-2 px-4 py-2 bg-black  text-primary-foreground rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-brand-700 transition-all shadow-lg shadow-brand-100"
                                                >
                                                    <Package className="h-3.5 w-3.5" />
                                                    MARK PACKED
                                                </button>
                                            )}
                                            {status === 'processed' && order.status === 'packed' && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleStatusUpdate(order._id, 'out_for_delivery');
                                                    }}
                                                    className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-purple-700 transition-all shadow-lg shadow-purple-100"
                                                >
                                                    <Truck className="h-3.5 w-3.5" />
                                                    DISPATCH
                                                </button>
                                            )}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigate(`/admin/orders/view/${order.id}`);
                                                }}
                                                className="p-2.5 bg-slate-50 text-slate-400 hover:text-fuchsia-600 hover:bg-fuchsia-100 rounded-xl transition-all"
                                                title="View Details"
                                            >
                                                <Eye className="h-4 w-4" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="6" className="px-4 py-20 text-center">
                                        <div className="flex flex-col items-center gap-4">
                                            <div className="h-20 w-20 bg-slate-50 rounded-full flex items-center justify-center">
                                                <Search className="h-10 w-10 text-slate-200" />
                                            </div>
                                            <div>
                                                <h4 className="text-lg font-black text-slate-300 uppercase tracking-tight">No Orders Found</h4>
                                                <p className="text-sm font-bold text-slate-300 mt-1">We couldn't find any orders matching your search.</p>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="p-4 border-t border-slate-50">
                    <Pagination
                        page={page}
                        totalPages={Math.ceil(total / pageSize) || 1}
                        total={total}
                        pageSize={pageSize}
                        onPageChange={(p) => fetchOrders(p)}
                        onPageSizeChange={(newSize) => {
                            setPageSize(newSize);
                            setPage(1);
                        }}
                        loading={isLoading}
                    />
                </div>
            </Card>
        </div>
    );
};

export default OrdersList;
