import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '@shared/components/ui/Card';
import Button from '@shared/components/ui/Button';
import Badge from '@shared/components/ui/Badge';
import Input from '@shared/components/ui/Input';
import Pagination from '@shared/components/ui/Pagination';
import {
    HiOutlineCube,
    HiOutlineExclamationTriangle,
    HiOutlineArchiveBoxXMark,
    HiOutlineArrowsUpDown,
    HiOutlineMagnifyingGlass,
    HiOutlineFunnel,
    HiOutlinePlus,
    HiOutlineMinus,
    HiOutlineArrowPath,
    HiOutlineClipboardDocumentList,
    HiOutlineCheck,
    HiOutlineCalendarDays,
    HiOutlinePencilSquare
} from 'react-icons/hi2';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { BlurFade } from '@/components/ui/blur-fade';
import { MagicCard } from '@/components/ui/magic-card';
import { sellerApi } from '../services/sellerApi';
import { toast } from 'sonner';
import { invalidateCache } from '@core/api/dedupe';
import { formatAmount } from "@shared/utils/currency";
import InventoryEditModal from '../components/stock/InventoryEditModal';

const StockManagement = () => {
    const navigate = useNavigate();
    const [activeView] = useState('inventory'); // 'inventory' or 'history'
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('All');
    const [inventory, setInventory] = useState([]);
    const [history, setHistory] = useState([]);
    const [historyRange, setHistoryRange] = useState({ from: '', to: '' });
    const [isLoading, setIsLoading] = useState(true);
    const [editItem, setEditItem] = useState(null);

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);

    const fetchInventory = async (silent = false, stockStatus) => {
        if (!silent) setIsLoading(true);
        try {
            const requestLimit = 100;
            const maxPages = 50;
            let requestedPage = 1;
            let totalPages = 1;
            const collected = [];

            while (requestedPage <= totalPages && requestedPage <= maxPages) {
                const params = { page: requestedPage, limit: requestLimit };
                if (stockStatus === 'in') params.stockStatus = 'in';
                if (stockStatus === 'out') params.stockStatus = 'out';

                const res = await sellerApi.getProducts(params);
                if (!res.data.success) break;

                // Backend returns handleResponse(..., { items, page, limit, total, totalPages })
                const payload = res.data.result || {};
                const rawProducts = Array.isArray(payload.items)
                    ? payload.items
                    : (res.data.results || []);

                collected.push(...rawProducts);
                totalPages = Number(payload.totalPages || 1);

                if (!rawProducts.length || requestedPage >= totalPages) {
                    break;
                }
                requestedPage += 1;
            }

            const safeProducts = Array.isArray(collected) ? collected : [];

            setInventory(
                safeProducts.map(p => ({
                    ...p,
                    id: p._id,
                    threshold: p.lowStockAlert || 5,
                    status:
                        p.stock === 0
                            ? 'Out of Stock'
                            : (p.stock <= (p.lowStockAlert || 5) ? 'Low Stock' : 'In Stock')
                }))
            );
        } catch {
            toast.error("Failed to load inventory");
        } finally {
            if (!silent) setIsLoading(false);
        }
    };

    const fetchHistory = async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { from, to } = historyRange;
            const res = await sellerApi.getStockHistory({ ...(from && { from }), ...(to && { to }) });
            if (res.data.success) {
                setHistory(res.data.result || []);
            }
        } catch {
            toast.error("Failed to load stock history");
        } finally {
            if (!silent) setIsLoading(false);
        }
    };

    useEffect(() => {
        if (activeView === 'inventory') {
            let stockStatusParam;
            if (filterStatus === 'In Stock') stockStatusParam = 'in';
            else if (filterStatus === 'Out of Stock') stockStatusParam = 'out';
            else stockStatusParam = undefined; // All / Low Stock -> no backend filter
            fetchInventory(false, stockStatusParam);
        } else {
            fetchHistory();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeView, filterStatus, historyRange]);

    const stats = useMemo(() => [
        { label: 'Total Inventory', value: inventory.reduce((acc, item) => acc + item.stock, 0), icon: HiOutlineCube, color: 'text-brand-600', bg: 'bg-brand-50', status: 'All' },
        { label: 'Low Stock Items', value: inventory.filter(i => i.stock > 0 && i.stock <= i.threshold).length, icon: HiOutlineExclamationTriangle, color: 'text-amber-600', bg: 'bg-amber-50', status: 'Low Stock' },
        { label: 'Out of Stock', value: inventory.filter(i => i.stock === 0).length, icon: HiOutlineArchiveBoxXMark, color: 'text-rose-600', bg: 'bg-rose-50', status: 'Out of Stock' },
        {
            label: 'Stock Valuation',
            value: `₹${formatAmount(inventory.reduce((acc, item) => {
                const mrp = Number(item.price || item.variants?.[0]?.price || 0);
                const sale = Number(item.salePrice !== undefined ? item.salePrice : (item.variants?.[0]?.salePrice || 0));
                const effective = sale > 0 && sale < mrp ? sale : mrp;
                return acc + (item.stock * effective);
            }, 0))}`,
            icon: HiOutlineArrowsUpDown,
            color: 'text-brand-600',
            bg: 'bg-brand-50',
            status: 'In Stock'
        }
    ], [inventory]);

    const filteredInventory = useMemo(() => {
        const term = searchTerm.trim().toLowerCase();
        return inventory.filter(item => {
            const variants = Array.isArray(item.variants) ? item.variants : [];
            const matchesSearch =
                !term ||
                String(item.name || '').toLowerCase().includes(term) ||
                (item.sku || '').toString().toLowerCase().includes(term) ||
                String(item.barcode || '').toLowerCase().includes(term) ||
                variants.some((v) =>
                    String(v?.sku || '').toLowerCase().includes(term) ||
                    String(v?.barcode || '').toLowerCase().includes(term) ||
                    String(v?.name || '').toLowerCase().includes(term));
            const matchesStatus = filterStatus === 'All' || item.status === filterStatus;
            return matchesSearch && matchesStatus;
        });
    }, [inventory, searchTerm, filterStatus]);

    if (isLoading && inventory.length === 0 && history.length === 0) {
        return <div className="flex items-center justify-center h-screen font-black text-slate-600">LOADING STOCK DATA...</div>;
    }

    return (
        <div className="space-y-6 pb-16">
            <BlurFade delay={0.1}>
                {/* Header */}
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
                            Stock Management
                            <Badge variant="warning" className="text-[9px] px-1.5 py-0 font-bold tracking-wider uppercase bg-amber-100 text-amber-700">
                                Inventory Control
                            </Badge>
                        </h1>
                        <p className="text-slate-600 text-sm mt-0.5 font-medium">
                            Monitor stock levels, manage restocks, and track movements.
                        </p>
                    </div>
                </div>
            </BlurFade>

            {activeView === 'inventory' ? (
                <>
                    {/* Quick Stats */}
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        {stats.map((stat, i) => (
                            <BlurFade key={i} delay={0.1 + (i * 0.05)}>
                                <div onClick={() => setFilterStatus(stat.status)} className="cursor-pointer">
                                    <MagicCard
                                        className="border-none shadow-sm ring-1 ring-slate-100 p-0 overflow-hidden group bg-white"
                                        gradientColor="#f8fafc"
                                    >
                                        <div className="flex items-center gap-3 p-4 relative z-10">
                                            <div className={cn("h-10 w-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110 duration-300 shadow-sm", stat.bg, stat.color)}>
                                                <stat.icon className="h-5 w-5" />
                                            </div>
                                            <div>
                                                <p className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest">{stat.label}</p>
                                                <h4 className="text-xl font-black text-slate-900 tracking-tight">{stat.value}</h4>
                                            </div>
                                        </div>
                                    </MagicCard>
                                </div>
                            </BlurFade>
                        ))}
                    </div>

                    <BlurFade delay={0.3}>
                        <Card className="border-none shadow-xl shadow-slate-200/50 overflow-hidden rounded-3xl">
                            {/* Toolbox */}
                            <div className="p-4 border-b border-slate-50 flex flex-col md:flex-row gap-4 items-center justify-between bg-slate-50/30">
                                <div className="flex flex-col md:flex-row gap-3 items-center w-full">
                                    <div className="relative w-full md:w-72">
                                        <HiOutlineMagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-600" />
                                        <Input
                                            placeholder="Search by product name or SKU..."
                                            className="pl-10 pr-4 py-2.5 rounded-2xl border-none ring-1 ring-slate-200 bg-white focus:ring-2 focus:ring-primary/20 transition-all text-xs font-semibold"
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-sm">
                                        {['All', 'In Stock', 'Out of Stock'].map((status) => (
                                            <button
                                                key={status}
                                                onClick={() => {
                                                    setFilterStatus(status);
                                                    setPage(1);
                                                }}
                                                className={cn(
                                                    "px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all",
                                                    filterStatus === status
                                                        ? "bg-white text-slate-900 shadow-md"
                                                        : "text-slate-600 hover:text-slate-700"
                                                )}
                                            >
                                                {status}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        onClick={() => navigate('/seller/products/add')}
                                        className="rounded-xl px-4 py-2 text-[10px] font-bold shadow-lg shadow-primary/20"
                                    >
                                        <HiOutlinePlus className="h-4 w-4 mr-2" />
                                        ADD NEW PRODUCT
                                    </Button>
                                </div>
                            </div>

                            {/* Stock Table */}
                            <div className="overflow-x-auto">
                                <table className="w-full text-left">
                                    <thead>
                                        <tr className="bg-slate-50/50 border-b border-slate-100">
                                            <th className="px-6 py-4 text-xs font-black text-slate-600 uppercase tracking-widest">Product Information</th>
                                            <th className="px-6 py-4 text-xs font-black text-slate-600 uppercase tracking-widest">Inventory Capacity</th>
                                            <th className="px-6 py-4 text-xs font-black text-slate-600 uppercase tracking-widest">Stock Health</th>
                                            <th className="px-6 py-4 text-xs font-black text-slate-600 uppercase tracking-widest">Price</th>
                                            <th className="px-6 py-4 text-xs font-black text-slate-600 uppercase tracking-widest text-right whitespace-nowrap">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-50">
                                        {filteredInventory.length === 0 ? (
                                            <tr>
                                                <td
                                                    colSpan={5}
                                                    className="px-6 py-10 text-center text-slate-600 text-xs font-black tracking-widest uppercase"
                                                >
                                                    No products found for this filter.
                                                </td>
                                            </tr>
                                        ) : (
                                            <AnimatePresence>
                                                {filteredInventory
                                                    .slice((page - 1) * pageSize, page * pageSize)
                                                    .map((item) => (
                                                        <motion.tr
                                                            key={item.id}
                                                            initial={{ opacity: 0 }}
                                                            animate={{ opacity: 1 }}
                                                            exit={{ opacity: 0 }}
                                                            className="group hover:bg-slate-50/80 transition-all cursor-default"
                                                        >
                                                            <td className="px-6 py-5">
                                                                <div className="flex items-center gap-4 group">
                                                                    <div className="h-12 w-12 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600 group-hover:scale-105 transition-transform overflow-hidden">
                                                                        {item.mainImage ? (
                                                                            <img src={item.mainImage} alt={item.name} className="h-full w-full object-cover" />
                                                                        ) : (
                                                                            <HiOutlineCube className="h-6 w-6" />
                                                                        )}
                                                                    </div>
                                                                    <div>
                                                                        <h4 className="text-sm font-black text-slate-900 group-hover:text-primary transition-colors">
                                                                            {item.name}
                                                                        </h4>
                                                                        <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest">
                                                                            Product Code: {item.sku || 'N/A'}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-5">
                                                                <div className="flex items-center gap-2">
                                                                    <div className="flex flex-col">
                                                                        <span
                                                                            className={cn(
                                                                                "text-sm font-black",
                                                                                item.stock <= item.threshold ? "text-rose-600" : "text-slate-900"
                                                                            )}
                                                                        >
                                                                            {item.stock} units
                                                                        </span>
                                                                        {item.stock <= item.threshold && (
                                                                            <span className="text-[9px] font-bold text-rose-500 bg-rose-50 px-1.5 py-0.5 rounded w-fit mt-0.5">
                                                                                Low Stock
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            </td>
                                                            <td className="px-6 py-5">
                                                                <Badge
                                                                    variant={item.status === 'In Stock' ? 'success' : 'destructive'}
                                                                    className="text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-lg"
                                                                >
                                                                    {item.status}
                                                                </Badge>
                                                            </td>
                                                            <td className="px-6 py-5">
                                                                {(() => {
                                                                    const mrp = Number(item.price || item.variants?.[0]?.price || 0);
                                                                    const sale = Number(item.salePrice !== undefined ? item.salePrice : (item.variants?.[0]?.salePrice || 0));
                                                                    const hasDiscount = sale > 0 && sale < mrp;
                                                                    return (
                                                                        <div className="flex flex-col">
                                                                            <span className="text-sm font-black text-slate-900">
                                                                                ₹{hasDiscount ? sale : mrp}
                                                                            </span>
                                                                            {hasDiscount && (
                                                                                <span className="text-[10px] font-bold text-slate-400 line-through">
                                                                                    ₹{mrp}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })()}
                                                            </td>
                                                            <td className="px-6 py-5 text-right">
                                                                <button
                                                                    onClick={() => setEditItem(item)}
                                                                    className="ml-auto px-4 py-2 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors flex items-center gap-1.5 whitespace-nowrap"
                                                                >
                                                                    <HiOutlinePencilSquare className="h-3.5 w-3.5" />
                                                                    Edit
                                                                </button>
                                                            </td>
                                                        </motion.tr>
                                                    ))}
                                            </AnimatePresence>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    </BlurFade>

                    <div className="mt-4">
                        <Pagination
                            page={page}
                            totalPages={Math.ceil(filteredInventory.length / pageSize) || 1}
                            total={filteredInventory.length}
                            pageSize={pageSize}
                            onPageChange={(p) => setPage(p)}
                            onPageSizeChange={(newSize) => {
                                setPageSize(newSize);
                                setPage(1);
                            }}
                            loading={isLoading}
                        />
                    </div>
                </>
            ) : (
                /* History View */
                <BlurFade delay={0.2}>
                    <Card className="border-none shadow-xl shadow-slate-200/50 rounded-3xl p-0 overflow-hidden">
                        <div className="p-6 border-b border-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/20">
                            <div>
                                <h3 className="text-base font-black text-slate-900">Inventory Movement Log</h3>
                                <p className="text-sm text-slate-600 font-medium">Audit trail for all stock adjustments and sales.</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <Input
                                    type="date"
                                    title="From date"
                                    value={historyRange.from}
                                    max={historyRange.to || undefined}
                                    onChange={(e) => setHistoryRange((r) => ({ ...r, from: e.target.value }))}
                                    className="py-2 rounded-lg text-xs font-semibold min-w-[140px]"
                                />
                                <span className="text-xs font-bold text-slate-500">to</span>
                                <Input
                                    type="date"
                                    title="To date"
                                    value={historyRange.to}
                                    min={historyRange.from || undefined}
                                    onChange={(e) => setHistoryRange((r) => ({ ...r, to: e.target.value }))}
                                    className="py-2 rounded-lg text-xs font-semibold min-w-[140px]"
                                />
                                {(historyRange.from || historyRange.to) && (
                                    <button
                                        type="button"
                                        onClick={() => setHistoryRange({ from: '', to: '' })}
                                        className="text-xs font-bold text-slate-600 hover:text-slate-900 px-1"
                                    >
                                        Clear
                                    </button>
                                )}
                            </div>
                        </div>
                        <div className="divide-y divide-slate-50">
                            {history.length === 0 ? (
                                <div className="p-10 text-center text-slate-600 font-black uppercase tracking-widest">
                                    {historyRange.from || historyRange.to ? 'No history in this date range' : 'No history found'}
                                </div>
                            ) : history.map((log) => (
                                <div key={log.id || log._id}className="p-6 hover:bg-slate-50/50 transition-colors flex items-center justify-between group">
                                    <div className="flex items-center gap-5">
                                        <div className={cn(
                                            "h-12 w-12 rounded-2xl flex items-center justify-center shadow-sm",
                                            log.type === 'Restock' ? "bg-brand-50 text-brand-600" :
                                                log.type === 'Sale' ? "bg-brand-50 text-brand-600" : "bg-rose-50 text-rose-600"
                                        )}>
                                            {log.type === 'Restock' ? <HiOutlinePlus className="h-6 w-6" /> :
                                                log.type === 'Sale' ? <HiOutlineCube className="h-6 w-6" /> : <HiOutlineMinus className="h-6 w-6" />}
                                        </div>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h4 className="text-sm font-black text-slate-900">{log.product?.name || 'Unknown Product'}</h4>
                                                <Badge className={cn(
                                                    "text-[9px] font-bold px-1.5 py-0",
                                                    log.type === 'Restock' ? "bg-brand-100 text-brand-700" :
                                                        log.type === 'Sale' ? "bg-brand-100 text-brand-700" : "bg-rose-100 text-rose-700"
                                                )}>
                                                    {log.type.toUpperCase()}
                                                </Badge>
                                            </div>
                                            <p className="text-[11px] text-slate-600 font-semibold mt-1">Note: {log.note || 'N/A'}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className={cn(
                                            "text-lg font-black tracking-tight mb-0.5",
                                            log.quantity > 0 ? "text-brand-600" : "text-rose-600"
                                        )}>
                                            {log.quantity > 0 ? `+${log.quantity}` : log.quantity}
                                        </div>
                                        <div className="flex items-center justify-end gap-1.5 text-[10px] font-bold text-slate-600">
                                            <HiOutlineCalendarDays className="h-3.5 w-3.5" />
                                            {new Date(log.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })} • {new Date(log.createdAt).toLocaleTimeString()}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </BlurFade>
            )}

            {editItem && (
                <InventoryEditModal
                    key={editItem.id}
                    product={editItem}
                    onClose={() => setEditItem(null)}
                    onSaved={async () => {
                        setEditItem(null);
                        invalidateCache('/products');
                        await fetchInventory(true);
                    }}
                />
            )}
        </div>
    );
};

export default StockManagement;
