import React, { useState, useEffect, useMemo } from 'react';
import Card from '@shared/components/ui/Card';
import Badge from '@shared/components/ui/Badge';
import PageHeader from '@shared/components/ui/PageHeader';
import StatCard from '@shared/components/ui/StatCard';
import {
    TrendingUp,
    DollarSign,
    Building2,
    Clock,
    CreditCard,
    ArrowUpRight,
    ArrowDownLeft,
    Wallet,
    Download,
    Filter,
    Search,
    ChevronRight,
    ArrowRight,
    History,
    PieChart,
    BarChart3,
    ArrowDownCircle,
    ArrowUpCircle,
    RotateCw
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Modal from '@shared/components/ui/Modal';
import Pagination from '@shared/components/ui/Pagination';
import { adminApi } from "../services/adminApi";
import { toast } from "sonner";
import { exportToCSV } from "@/lib/exportUtils";

const AdminWallet = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [walletData, setWalletData] = useState({ stats: {}, transactions: {} });
    const [txnPage, setTxnPage] = useState(1);
    const [txnPageSize, setTxnPageSize] = useState(25);
    const [sellerRequests, setSellerRequests] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeTab, setActiveTab] = useState('all'); // all, earnings, payouts, seller_requests
    const [selectedTransaction, setSelectedTransaction] = useState(null);
    const [isExporting, setIsExporting] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [loadingId, setLoadingId] = useState(null);

    const fetchData = async (page = 1) => {
        try {
            setLoading(true);
            const params = { page, limit: txnPageSize };
            if (searchTerm.trim()) params.search = searchTerm.trim();

            const [summaryRes, ledgerRes, requestsRes] = await Promise.all([
                adminApi.getFinanceSummary(),
                adminApi.getFinanceLedger(params),
                adminApi.getFinancePayouts({ seller: true, status: "PENDING", page: 1, limit: 100 })
            ]);

            if (summaryRes.data.success || ledgerRes.data.success) {
                const summary = summaryRes.data.result || {};
                const ledger = ledgerRes.data.result || {};
                const formatActor = (actor, defaultVal) => {
                    if (!actor || actor === 'SYSTEM') return 'System Float';
                    if (actor === 'DELIVERY_PARTNER' || actor === 'RIDER') return 'Delivery Partner';
                    if (actor === 'SELLER' || actor === 'MERCHANT') return 'Seller';
                    if (actor === 'CUSTOMER' || actor === 'USER') return 'Customer';
                    if (actor === 'PLATFORM_WALLET') return 'Platform Admin Wallet';
                    return actor.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
                };

                const formatType = (typeStr) => {
                    if (!typeStr) return 'Transaction';
                    return typeStr.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase());
                };

                const mappedTransactions = (ledger.items || []).map((entry) => {
                    const rawRef = (entry.reference || entry.transactionId || entry._id || '').toString();
                    const cleanRef = rawRef.startsWith('ORD-') ? rawRef : (rawRef.length > 12 ? `REF-${rawRef.slice(-8).toUpperCase()}` : rawRef.toUpperCase());

                    return {
                        id: cleanRef,
                        rawType: entry.type || "UNKNOWN",
                        type: formatType(entry.type),
                        amount: entry.direction === "DEBIT" ? -Math.abs(entry.amount || 0) : Math.abs(entry.amount || 0),
                        status: entry.status || "COMPLETED",
                        sender: entry.direction === "DEBIT" ? formatActor(entry.actorType, "System Float") : "System Float",
                        recipient: entry.direction === "CREDIT" ? formatActor(entry.actorType, "Platform Admin Wallet") : "Platform Admin Wallet",
                        date: entry.createdAt ? new Date(entry.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : "-",
                        time: entry.createdAt ? new Date(entry.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "-",
                        notes: entry.description || formatType(entry.type),
                        method: entry.paymentMode || "N/A",
                        rawEntry: entry
                    };
                });

                setWalletData({
                    stats: {
                        totalPlatformEarning: summary.totalPlatformEarning || 0,
                        totalAdminEarning: summary.totalAdminEarning || 0,
                        availableBalance: summary.availableBalance || 0,
                        systemFloat: summary.systemFloatCOD || 0,
                        sellerPendingPayouts: summary.sellerPendingPayouts || 0,
                        deliveryPendingPayouts: summary.deliveryPendingPayouts || 0,
                    },
                    transactions: {
                        items: mappedTransactions,
                        page: ledger.page || page,
                        limit: ledger.limit || txnPageSize,
                        total: ledger.total || mappedTransactions.length,
                        totalPages: ledger.totalPages || 1,
                    },
                });
                if (ledger && typeof ledger.page === "number") setTxnPage(ledger.page);
            }
            if (requestsRes.data.success) {
                const payload = requestsRes.data.result || {};
                const list = Array.isArray(payload.items) ? payload.items : (requestsRes.data.results || []);
                setSellerRequests(list);
            }
        } catch (error) {
            console.error("Admin Wallet Fetch Error:", error);
            toast.error("Failed to load finance data");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchData(1);
        }, 500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [txnPageSize, searchTerm]);

    // Track the actual page change separately (no debounce needed for clicking next)
    useEffect(() => {
        fetchData(txnPage);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [txnPage]);

    const handleUpdateStatus = async (id, status, reason = "") => {
        try {
            if (status !== "COMPLETED") {
                toast.error("Only payout completion is supported in this view");
                return;
            }
            setLoadingId(id);
            const res = await adminApi.processFinancePayouts({
                payoutIds: [id],
                remarks: reason || "",
            });
            if (res.data.success) {
                toast.success(`Request processed successfully`);
                fetchData(txnPage);
            }
        } catch (error) {
            toast.error(error.response?.data?.message || "Action failed");
        } finally {
            setLoadingId(null);
        }
    };

    const stats = [
        {
            label: 'Total Platform Earning',
            value: `₹${(walletData.stats?.totalPlatformEarning || 0).toLocaleString()}`,
            description: 'Total money collected',
            icon: TrendingUp,
            color: 'blue',
            bg: 'bg-brand-50',
            iconColor: 'text-brand-500'
        },
        {
            label: 'Total Admin Earning',
            value: `₹${(walletData.stats?.totalAdminEarning || 0).toLocaleString()}`,
            description: 'Net profit for platform',
            icon: DollarSign,
            color: 'purple',
            bg: 'bg-purple-50',
            iconColor: 'text-purple-500'
        },
        {
            label: 'Available Balance',
            value: `₹${(walletData.stats?.availableBalance || 0).toLocaleString()}`,
            description: 'Available in business wallet',
            icon: Building2,
            color: 'emerald',
            bg: 'bg-brand-50',
            iconColor: 'text-brand-500'
        },
        {
            label: 'System Float (COD)',
            value: `₹${(walletData.stats?.systemFloat || 0).toLocaleString()}`,
            description: 'Cash with delivery partners',
            icon: Clock,
            color: 'amber',
            bg: 'bg-orange-50',
            iconColor: 'text-orange-500'
        },
        {
            label: 'Seller Pending Payouts',
            value: `₹${(walletData.stats?.sellerPendingPayouts || 0).toLocaleString()}`,
            description: 'Owed to sellers',
            icon: CreditCard,
            color: 'blue',
            bg: 'bg-brand-50',
            iconColor: 'text-brand-500'
        },
        {
            label: 'Delivery Pending Payouts',
            value: `₹${(walletData.stats?.deliveryPendingPayouts || 0).toLocaleString()}`,
            description: 'Owed to delivery partners',
            icon: CreditCard,
            color: 'purple',
            bg: 'bg-purple-50',
            iconColor: 'text-purple-500'
        }
    ];

    const transactionsList = useMemo(() =>
        Array.isArray(walletData.transactions?.items) ? walletData.transactions.items : (Array.isArray(walletData.transactions) ? walletData.transactions : []),
        [walletData.transactions]);

    const txnTotal = useMemo(() =>
        typeof walletData.transactions?.total === 'number' ? walletData.transactions.total : transactionsList.length,
        [walletData.transactions, transactionsList]);

    const filteredTransactions = useMemo(() => {
        const query = searchTerm.toLowerCase().trim();
        return transactionsList.filter(txn => {
            const matchesSearch =
                (txn.id || '').toLowerCase().includes(query) ||
                (txn.type || '').toLowerCase().includes(query) ||
                (txn.sender || '').toLowerCase().includes(query) ||
                (txn.recipient || '').toLowerCase().includes(query) ||
                (txn.notes || '').toLowerCase().includes(query) ||
                String(txn.amount || '').includes(query);

            const matchesTab = activeTab === 'all' ||
                (activeTab === 'earnings' && txn.amount > 0) ||
                (activeTab === 'payouts' && txn.amount < 0);

            return matchesSearch && matchesTab;
        });
    }, [transactionsList, searchTerm, activeTab]);

    const requestsList = useMemo(() => {
        const list = Array.isArray(sellerRequests) ? sellerRequests : [];
        if (!searchTerm) return list;

        const query = searchTerm.toLowerCase().trim();
        return list.filter(req => {
            const shopName = (req.beneficiary?.shopName || '').toLowerCase();
            const ownerName = (req.beneficiary?.name || '').toLowerCase();
            const phone = (req.beneficiary?.phone || '').toLowerCase();
            const type = (req.payoutType || '').toLowerCase();
            const id = (req.beneficiaryId || '').toLowerCase();
            const amount = String(req.amount || '');

            return shopName.includes(query) ||
                ownerName.includes(query) ||
                phone.includes(query) ||
                type.includes(query) ||
                amount.includes(query) ||
                id.includes(query);
        });
    }, [sellerRequests, searchTerm]);

    const pendingRequests = useMemo(() =>
        (Array.isArray(sellerRequests) ? sellerRequests : []).filter(req =>
            (req.status || '').toUpperCase() === 'PENDING' || (req.status || '').toUpperCase() === 'PROCESSING'
        ),
        [sellerRequests]);

    const handleExport = async () => {
        try {
            setIsExporting(true);
            try {
                const res = await adminApi.exportFinanceStatement();
                if (res?.data) {
                    const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
                    const link = document.createElement("a");
                    const url = URL.createObjectURL(blob);
                    link.setAttribute("href", url);
                    link.setAttribute("download", `finance_statement_${new Date().toISOString().slice(0, 10)}.csv`);
                    link.style.visibility = "hidden";
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    toast.success("Statement exported successfully");
                    return;
                }
            } catch (err) {
                console.warn("Direct finance statement export failed, attempting local fallback", err);
            }

            const currentTxns = walletData?.transactions?.items || [];
            if (currentTxns.length > 0) {
                const formatted = currentTxns.map(t => ({
                    "ID": t.id || t._id || '',
                    "Reference": t.reference || '',
                    "Entity": t.entity || '',
                    "Type": t.type || '',
                    "Amount (INR)": t.amount || 0,
                    "Status": (t.status || '').toUpperCase(),
                    "Date": t.date || ''
                }));
                exportToCSV(formatted, 'finance_statement');
                toast.success("Statement exported successfully");
            } else {
                toast.error("No transactions available to export");
            }
        } catch (error) {
            console.error("Export error:", error);
            toast.error(error.response?.data?.message || "Failed to export statement");
        } finally {
            setIsExporting(false);
        }
    };

    const handleProcessPayouts = async () => {
        try {
            setIsProcessing(true);
            const res = await adminApi.processFinancePayouts({
                limit: 100,
                remarks: "Bulk payout processing from admin panel",
            });
            if (res.data.success) {
                const result = res.data.result || {};
                toast.success(`Processed ${result.completed || 0} payouts`);
                fetchData(txnPage);
            }
        } catch (error) {
            toast.error(error.response?.data?.message || "Failed to process payouts");
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="ds-section-spacing animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="ds-h1">Admin Wallet & Finance</h1>
                    <p className="ds-description mt-1">Manage transactions, track earnings, and process withdrawals.</p>
                </div>
                <div className="flex items-center space-x-3">
                    <button
                        onClick={handleExport}
                        disabled={isExporting}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white ring-1 ring-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
                    >
                        {isExporting ? <RotateCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        {isExporting ? 'EXPORTING...' : 'EXPORT STATEMENT'}
                    </button>
                    <button
                        onClick={handleProcessPayouts}
                        disabled={isProcessing}
                        className="flex items-center gap-2 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all shadow-lg active:scale-95 disabled:opacity-50"
                    >
                        {isProcessing ? <RotateCw className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
                        {isProcessing ? 'PROCESSING...' : 'PROCESS PAYOUTS'}
                    </button>
                </div>
            </div>

            {/* Top Stats & Settlements Layout */}
            <div className="flex flex-col xl:flex-row gap-6 items-start">
                {/* Stats Grid - 3x2 narrow cards layout */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full xl:max-w-2xl shrink-0">
                    {stats.map((stat, idx) => (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ delay: idx * 0.05 }}
                            key={idx}
                        >
                            <Card className="p-2.5 px-3.5 border-none shadow-sm ring-1 ring-slate-100 hover:ring-primary/20 transition-all hover:shadow-md bg-white group relative overflow-hidden">
                                <div className="flex flex-col h-full relative z-10">
                                    {/* Top Row: Icon and Live Status */}
                                    <div className="flex justify-between items-center mb-0.5">
                                        <div className={cn("p-1 rounded-md transition-all duration-500 group-hover:rotate-6", stat.bg)}>
                                            <stat.icon className={cn("h-4 w-4", stat.iconColor)} strokeWidth={2.5} />
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest leading-none">Live</span>
                                            <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
                                        </div>
                                    </div>

                                    {/* Middle Row: Label and Value */}
                                    <div className="my-0.5">
                                        <p className="text-[10px] font-semibold text-slate-500 capitalize tracking-normal mb-0.5">{stat.label}</p>
                                        <h3 className="text-base font-bold text-slate-800 leading-tight">{stat.value}</h3>
                                    </div>

                                    {/* Bottom Row: Description */}
                                    <div className="pt-1 border-t border-slate-100 mt-1">
                                        <p className="text-[10px] font-bold text-slate-400 flex items-center gap-1.5">
                                            <span className="w-0.5 h-2.5 rounded-full bg-slate-300" />
                                            {stat.description}
                                        </p>
                                    </div>
                                </div>

                                {/* Background ghost icon */}
                                <div className="absolute -bottom-2 -right-2 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity duration-500 group-hover:scale-110">
                                    <stat.icon className="h-16 w-16" strokeWidth={1} />
                                </div>
                            </Card>
                        </motion.div>
                    ))}
                </div>

                {/* Settlements & Analytics Overview Column */}
                <div className="w-full xl:w-[340px] shrink-0 space-y-4">
                    {/* Settlements Card - Ultra Compact Height */}
                    <Card className="p-2.5 px-3.5 border-none shadow-xl ring-1 ring-slate-100 bg-gradient-to-br from-slate-900 to-slate-800 text-white overflow-hidden relative rounded-2xl">
                        <div className="relative z-10 space-y-1.5">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                    <PieChart className="h-3 w-3 text-emerald-400" />
                                    <h2 className="text-[11px] font-black uppercase tracking-wider text-slate-200">Settlements</h2>
                                </div>
                                <span className="text-[8px] font-black text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded-full border border-emerald-500/30">Active</span>
                            </div>

                            <div className="flex items-baseline justify-between py-0.5">
                                <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none">Ready for Settlement</span>
                                <h3 className="text-lg font-black text-white leading-none">₹{((walletData.stats?.sellerPendingPayouts || 0) + (walletData.stats?.deliveryPendingPayouts || 0)).toLocaleString()}</h3>
                            </div>

                            <div className="grid grid-cols-2 gap-1.5">
                                <div className="flex justify-between items-center bg-slate-800/60 p-1 px-2 rounded-md border border-white/5 text-xs">
                                    <div className="flex items-center gap-1">
                                        <div className="h-1.5 w-1.5 rounded-full bg-brand-400" />
                                        <span className="font-bold text-slate-300 text-[9px]">Sellers</span>
                                    </div>
                                    <span className="font-black text-white text-[10px]">₹{(walletData.stats?.sellerPendingPayouts || 0).toLocaleString()}</span>
                                </div>
                                <div className="flex justify-between items-center bg-slate-800/60 p-1 px-2 rounded-md border border-white/5 text-xs">
                                    <div className="flex items-center gap-1">
                                        <div className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                                        <span className="font-bold text-slate-300 text-[9px]">Riders</span>
                                    </div>
                                    <span className="font-black text-white text-[10px]">₹{(walletData.stats?.deliveryPendingPayouts || 0).toLocaleString()}</span>
                                </div>
                            </div>

                            <button
                                onClick={handleProcessPayouts}
                                disabled={isProcessing}
                                className="w-full py-1.5 bg-white hover:bg-slate-100 text-slate-900 rounded-lg font-black text-[9px] uppercase tracking-widest transition-all shadow-md active:scale-[0.98] flex items-center justify-center gap-1 group disabled:opacity-50"
                            >
                                {isProcessing ? <RotateCw className="h-3 w-3 animate-spin" /> : <Wallet className="h-3 w-3 group-hover:rotate-12 transition-transform" />}
                                {isProcessing ? 'SETTLING...' : 'Bulk Settlement'}
                            </button>
                        </div>
                        <div className="absolute -bottom-6 -right-6 opacity-10">
                            <Wallet className="h-20 w-20" />
                        </div>
                    </Card>

                    {/* Analytics Section - Compact Size */}
                    <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                            <div className="p-1 bg-brand-50 text-brand-600 rounded-md">
                                <BarChart3 className="h-3 w-3" />
                            </div>
                            <h2 className="text-xs font-black text-slate-800 uppercase tracking-wide">Analytics</h2>
                        </div>
                        <div className="space-y-1.5">
                            {[
                                { label: 'Platform Revenue Report', icon: TrendingUp, path: '/admin' },
                                { label: 'Settlement History', icon: History, path: '/admin/delivery-funds' },
                                { label: 'Tax Statements', icon: DollarSign, path: '#' },
                            ].map((link, i) => (
                                <button
                                    key={i}
                                    onClick={() => link.path !== '#' ? navigate(link.path) : alert('Tax Statements generation is coming soon!')}
                                    className="w-full p-1.5 px-2.5 bg-white ring-1 ring-slate-100 rounded-lg flex items-center justify-between group hover:ring-primary/20 hover:shadow-sm transition-all"
                                >
                                    <div className="flex items-center gap-2">
                                        <div className="p-1 bg-slate-50 text-slate-400 rounded-md group-hover:bg-primary/10 group-hover:text-primary transition-all">
                                            <link.icon className="h-3 w-3" />
                                        </div>
                                        <span className="text-[11px] font-semibold text-slate-700">{link.label}</span>
                                    </div>
                                    <ArrowRight className="h-3 w-3 text-slate-300 group-hover:translate-x-1 transition-transform" />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Transaction History Section */}
            <div className="space-y-6 mt-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-brand-50 text-brand-600 rounded-lg">
                                <History className="h-5 w-5" />
                            </div>
                            <h2 className="ds-h2">Recent Transactions</h2>
                        </div>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-3 w-full sm:w-auto">
                            <div className="flex bg-slate-100 p-1 rounded-xl overflow-x-auto">
                                {['all', 'earnings', 'payouts', 'seller_requests'].map((tab) => (
                                    <button
                                        key={tab}
                                        onClick={() => setActiveTab(tab)}
                                        className={cn(
                                            "px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-tight transition-all relative",
                                            activeTab === tab ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                                        )}
                                    >
                                        {tab.replace('_', ' ')}
                                        {tab === 'seller_requests' && pendingRequests.length > 0 && (
                                            <span className="absolute -top-1 -right-1 flex h-4 w-4">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-4 w-4 bg-rose-500 text-[8px] items-center justify-center text-white border-2 border-white">{pendingRequests.length}</span>
                                            </span>
                                        )}
                                    </button>
                                ))}
                            </div>
                            <div className="relative group w-full sm:w-auto">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 group-focus-within:text-primary transition-colors" />
                                <input
                                    type="text"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Search details..."
                                    className="pl-9 pr-4 py-2 bg-white ring-1 ring-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/10 w-full sm:w-48 transition-all"
                                />
                            </div>
                        </div>
                    </div>

                    <Card className="border-none shadow-2xl ring-1 ring-slate-100/50 overflow-hidden bg-white rounded-[32px]">
                        <div className="overflow-x-auto">
                            <table className="min-w-full text-left border-collapse">
                                {activeTab === 'seller_requests' ? (
                                    <>
                                        <thead>
                                            <tr className="bg-slate-50/50 border-b border-slate-100">
                                                <th className="ds-table-header-cell pl-8">Seller Detail</th>
                                                <th className="ds-table-header-cell text-center">Amount</th>
                                                <th className="ds-table-header-cell">Status</th>
                                                <th className="ds-table-header-cell text-right pr-8">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {requestsList.map((req) => (
                                                <tr key={req._id} className="group hover:bg-slate-50/50 transition-all">
                                                    <td className="px-6 py-5 pl-8">
                                                        <div className="flex items-center gap-3">
                                                            <div className="h-10 w-10 rounded-xl bg-brand-50 flex items-center justify-center">
                                                                <Building2 className="h-5 w-5 text-brand-500" />
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-bold text-slate-900">{req.beneficiary?.shopName || req.beneficiary?.name || req.beneficiaryId}</p>
                                                                <div className="flex items-center gap-2 mt-1">
                                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{req.beneficiary?.phone || req.payoutType}</p>
                                                                    <span className="text-[9px] font-black text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md border border-brand-200/60 uppercase">
                                                                        {req.metadata?.destinationDetails || (req.metadata?.payoutMethod === 'UPI' ? 'UPI Transfer' : 'Bank Transfer')}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5 text-center">
                                                        <p className="text-sm font-black text-slate-900">₹{Math.abs(req.amount).toLocaleString()}</p>
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        <Badge variant={req.status === 'COMPLETED' ? 'success' : (req.status === 'PENDING' || req.status === 'PROCESSING') ? 'warning' : 'danger'} className="text-[8px] font-black px-2.5 py-1">
                                                            {req.status.toUpperCase()}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-6 py-5 text-right pr-8">
                                                        {(req.status || '').toUpperCase() === 'PENDING' ? (
                                                            <div className="flex items-center justify-end gap-2">
                                                                <button
                                                                    disabled={isProcessing || loadingId === req._id}
                                                                    onClick={() => handleUpdateStatus(req._id, 'COMPLETED')}
                                                                    className="px-4 py-2 bg-black  text-primary-foreground rounded-xl text-[10px] font-black uppercase hover:bg-brand-700 transition-all shadow-md active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed min-w-[100px] flex items-center justify-center"
                                                                >
                                                                    {loadingId === req._id ? (
                                                                        <RotateCw className="h-3 w-3 animate-spin" />
                                                                    ) : (
                                                                        'Approve'
                                                                    )}
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-[10px] font-bold text-slate-400 italic">No Actions</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </>
                                ) : (
                                    <>
                                        <thead>
                                            <tr className="bg-slate-50/50 border-b border-slate-100">
                                                <th className="ds-table-header-cell pl-8">Transaction Details</th>
                                                <th className="ds-table-header-cell">Entities</th>
                                                <th className="ds-table-header-cell text-center">Amount</th>
                                                <th className="ds-table-header-cell">Status</th>
                                                <th className="ds-table-header-cell text-right pr-8">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-50">
                                            {filteredTransactions.map((txn, i) => (
                                                <tr
                                                    key={txn.id}
                                                    onClick={() => setSelectedTransaction(txn)}
                                                    className="group hover:bg-slate-50/50 transition-all cursor-pointer"
                                                >
                                                    <td className="px-6 py-5 pl-8">
                                                        <div className="flex items-center gap-3">
                                                            <div className={cn(
                                                                "h-10 w-10 rounded-xl flex items-center justify-center shadow-sm",
                                                                txn.amount > 0 ? "bg-brand-50 text-brand-600" : "bg-rose-50 text-rose-600"
                                                            )}>
                                                                {txn.amount > 0 ? <ArrowDownCircle className="h-5 w-5" /> : <ArrowUpCircle className="h-5 w-5" />}
                                                            </div>
                                                            <div>
                                                                <p className="text-sm font-bold text-slate-900 group-hover:text-primary transition-colors">{txn.type}</p>
                                                                <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tighter">{txn.id} • {txn.date}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5">
                                                        <div className="flex flex-col gap-1">
                                                            <div className="flex items-center gap-1.5">
                                                                <ArrowDownLeft className="h-3 w-3 text-brand-500" />
                                                                <span className="text-[11px] font-bold text-slate-600">{txn.recipient}</span>
                                                            </div>
                                                            <div className="flex items-center gap-1.5 opacity-50">
                                                                <ArrowUpRight className="h-3 w-3 text-rose-500" />
                                                                <span className="text-[10px] font-semibold text-slate-400">{txn.sender}</span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-5 text-center">
                                                        <p className={cn(
                                                            "text-sm font-black",
                                                            txn.amount > 0 ? "text-brand-600" : "text-rose-600"
                                                        )}>
                                                            {txn.amount > 0 ? '+' : ''}₹{Math.abs(txn.amount).toLocaleString()}
                                                        </p>
                                                    </td>
                                                    <td className="px-6 py-5 text-center">
                                                        <Badge variant={txn.status === 'COMPLETED' || txn.status === 'Settled' ? 'success' : 'warning'} className="text-[8px] font-black px-2.5 py-1">
                                                            {txn.status.toUpperCase()}
                                                        </Badge>
                                                    </td>
                                                    <td className="px-6 py-5 text-right pr-8">
                                                        <button className="p-2 hover:bg-white hover:shadow-md rounded-lg transition-all text-slate-400 hover:text-primary active:scale-90">
                                                            <ChevronRight className="h-4 w-4" />
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                            {(activeTab === 'seller_requests' ? requestsList.length === 0 : filteredTransactions.length === 0) && (
                                                <tr>
                                                    <td colSpan="5" className="px-6 py-20 text-center">
                                                        <div className="flex flex-col items-center">
                                                            <div className="p-4 bg-slate-50 rounded-full mb-4">
                                                                <Search className="h-8 w-8 text-slate-200" />
                                                            </div>
                                                            <p className="text-slate-400 font-bold text-sm">No items found matching your criteria.</p>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </tbody>
                                    </>
                                )}
                            </table>
                        </div>
                        {activeTab !== 'seller_requests' && txnTotal > 0 && (
                            <div className="px-6 py-3 border-t border-slate-100">
                                <Pagination
                                    page={txnPage}
                                    totalPages={Math.ceil(txnTotal / txnPageSize) || 1}
                                    total={txnTotal}
                                    pageSize={txnPageSize}
                                    onPageChange={(p) => { setTxnPage(p); fetchData(p); }}
                                    onPageSizeChange={(newSize) => {
                                        setTxnPageSize(newSize);
                                        setTxnPage(1);
                                    }}
                                    loading={loading}
                                />
                            </div>
                        )}
                    </Card>
            </div>

            {/* Transaction Detail Modal */}
            <Modal
                isOpen={!!selectedTransaction}
                onClose={() => setSelectedTransaction(null)}
                title="Transaction Details"
                size="md"
            >
                {selectedTransaction && (
                    <div className="space-y-6">
                        <div className="text-center pb-6 border-b border-slate-100">
                            <div className={cn(
                                "h-16 w-16 rounded-2xl flex items-center justify-center mx-auto mb-4",
                                selectedTransaction.amount > 0 ? "bg-brand-50 text-brand-600" : "bg-rose-50 text-rose-600"
                            )}>
                                {selectedTransaction.amount > 0 ? <ArrowDownCircle className="h-8 w-8" /> : <ArrowUpCircle className="h-8 w-8" />}
                            </div>
                            <h4 className="text-3xl font-black text-slate-900">₹{Math.abs(selectedTransaction.amount)}</h4>
                            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">{selectedTransaction.status}</p>
                        </div>

                        <div className="grid grid-cols-2 gap-6">
                            <div className="space-y-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Type</p>
                                <p className="text-sm font-bold text-slate-900">{selectedTransaction.type}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date & Time</p>
                                <p className="text-sm font-bold text-slate-900">{selectedTransaction.date} {selectedTransaction.time && `• ${selectedTransaction.time}`}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">From</p>
                                <p className="text-sm font-bold text-slate-700">{selectedTransaction.sender}</p>
                            </div>
                            <div className="space-y-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">To</p>
                                <p className="text-sm font-bold text-slate-700">{selectedTransaction.recipient}</p>
                            </div>
                            <div className="col-span-2 space-y-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Reference ID</p>
                                <p className="text-sm font-mono font-bold text-slate-900">{selectedTransaction.id}</p>
                            </div>
                            <div className="col-span-2 space-y-1">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Payment Method</p>
                                <p className="text-sm font-bold text-slate-700">{selectedTransaction.method}</p>
                            </div>
                            <div className="col-span-2 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Notes / Breakdown</p>
                                <p className="text-xs font-medium text-slate-600 italic">"{selectedTransaction.notes}"</p>
                            </div>
                        </div>

                        <div className="pt-4 flex gap-3">
                            <button
                                onClick={() => setSelectedTransaction(null)}
                                className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all"
                            >
                                CLOSE
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default AdminWallet;
