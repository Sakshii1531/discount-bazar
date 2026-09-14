import React, { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Card from '@shared/components/ui/Card';
import Badge from '@shared/components/ui/Badge';
import Modal from '@shared/components/ui/Modal';
import {
    Banknote,
    Clock,
    CheckCircle2,
    XCircle,
    Search,
    Filter,
    ChevronRight,
    Building2,
    Truck,
    ArrowUpRight,
    CreditCard,
    MoreVertical,
    Download,
    Eye,
    CheckCircle,
    FileText,
    AlertCircle,
    RotateCw,
    Copy,
    Check
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import Pagination from '@shared/components/ui/Pagination';
import { adminApi } from "../services/adminApi";
import { toast } from "sonner";
import { exportToCSV } from "@/lib/exportUtils";
import { getOrderSocket, onAdminWithdrawalNew } from '@/core/services/orderSocket';
import { createSocketTokenReader } from '@core/utils/authStorage';
import { STORAGE_KEYS } from '@core/utils/storage';

const IFSC_BANK_MAP = {
    SBIN: "State Bank of India",
    HDFC: "HDFC Bank",
    ICIC: "ICICI Bank",
    UTIB: "Axis Bank",
    PUNB: "Punjab National Bank",
    BARB: "Bank of Baroda",
    CNRB: "Canara Bank",
    UBIN: "Union Bank of India",
    IDIB: "Indian Bank",
    IOBA: "Indian Overseas Bank",
    KKBK: "Kotak Mahindra Bank",
    YESB: "Yes Bank",
    INDB: "IndusInd Bank",
    BKID: "Bank of India",
    CBIN: "Central Bank of India",
    ANDB: "Andhra Bank",
    CORP: "Corporation Bank",
    ALLA: "Allahabad Bank",
    SYNB: "Syndicate Bank",
    VIJB: "Vijaya Bank",
    MAHB: "Bank of Maharashtra",
    PSIB: "Punjab & Sind Bank",
    UCOB: "UCO Bank",
    IDFB: "IDFC FIRST Bank",
    FDRL: "Federal Bank",
    AUBL: "AU Small Finance Bank",
    AIRP: "Airtel Payments Bank",
    PYTM: "Paytm Payments Bank",
    IPOS: "India Post Payments Bank"
};

const resolveBankNameFromIfsc = (ifsc) => {
    if (!ifsc || typeof ifsc !== 'string') return null;
    const prefix = ifsc.trim().substring(0, 4).toUpperCase();
    return IFSC_BANK_MAP[prefix] || (prefix ? `${prefix} Bank` : null);
};

const getBankInfo = (req) => {
    if (!req) return null;
    const user = req.user || {};
    const metaBank = req.metadata?.bankDetails || req.meta?.bankDetails || {};
    const sellerBank = user.bankDetails || {};

    const accountHolder = metaBank.accountHolder || metaBank.accountHolderName || 
                          user.accountHolder || sellerBank.accountHolder || sellerBank.accountHolderName || 
                          user.name || null;

    const accountNumber = metaBank.accountNumber || user.accountNumber || sellerBank.accountNumber || null;
    const ifsc = metaBank.ifsc || metaBank.ifscCode || user.ifsc || sellerBank.ifscCode || sellerBank.ifsc || null;
    const rawBankName = metaBank.bankName || user.bankName || sellerBank.bankName || null;
    const bankName = rawBankName || resolveBankNameFromIfsc(ifsc) || null;
    const accountType = metaBank.accountType || sellerBank.accountType || null;
    const branch = metaBank.branch || sellerBank.branch || null;
    const upiId = metaBank.upiId || sellerBank.upiId || req.metadata?.upiId || null;
    const payoutMethod = req.metadata?.payoutMethod || (upiId ? 'UPI' : 'Bank Transfer');
    const destinationDetails = req.metadata?.destinationDetails;

    const hasBank = Boolean(accountNumber || ifsc || bankName);

    return {
        accountHolder,
        accountNumber,
        ifsc,
        bankName,
        accountType,
        branch,
        upiId,
        payoutMethod,
        destinationDetails,
        hasBank
    };
};

const WithdrawalRequests = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const [activeTab, setActiveTab] = useState(
        tabParam === 'delivery' || tabParam === 'sellers' ? tabParam : 'sellers'
    );
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [selectedRequest, setSelectedRequest] = useState(null);
    const [copiedField, setCopiedField] = useState(null);

    const handleCopy = (text, fieldKey) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopiedField(fieldKey);
        toast.success("Copied to clipboard");
        setTimeout(() => setCopiedField(null), 2000);
    };
    const [loading, setLoading] = useState(true);
    const [actionModal, setActionModal] = useState({ isOpen: false, type: null, request: null });

    const [sellerRequests, setSellerRequests] = useState([]);
    const [deliveryRequests, setDeliveryRequests] = useState([]);
    const [sellerPage, setSellerPage] = useState(1);
    const [deliveryPage, setDeliveryPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [sellerTotal, setSellerTotal] = useState(0);
    const [deliveryTotal, setDeliveryTotal] = useState(0);

    const fetchData = async (sellerPageNum = 1, deliveryPageNum = 1) => {
        try {
            setLoading(true);
            const commonParams = { page: 1, limit: pageSize };
            if (searchTerm.trim()) commonParams.search = searchTerm.trim();
            if (filterStatus !== 'all') commonParams.status = filterStatus;

            const [sellerRes, deliveryRes] = await Promise.all([
                adminApi.getSellerWithdrawals({ ...commonParams, page: sellerPageNum }).catch(err => ({ data: { success: false, result: {} } })),
                adminApi.getDeliveryWithdrawals({ ...commonParams, page: deliveryPageNum }).catch(err => ({ data: { success: false, result: {} } }))
            ]);

            if (sellerRes.data.success) {
                const payload = sellerRes.data.result || {};
                const items = Array.isArray(payload.items) ? payload.items : (sellerRes.data.results || []);
                setSellerRequests(items);
                setSellerTotal(typeof payload.total === 'number' ? payload.total : items.length);
                setSellerPage(typeof payload.page === 'number' ? payload.page : sellerPageNum);
            }
            if (deliveryRes.data.success) {
                const payload = deliveryRes.data.result || {};
                const items = Array.isArray(payload.items) ? payload.items : (deliveryRes.data.results || []);
                setDeliveryRequests(items);
                setDeliveryTotal(typeof payload.total === 'number' ? payload.total : items.length);
                setDeliveryPage(typeof payload.page === 'number' ? payload.page : deliveryPageNum);
            }
        } catch (error) {
            console.error("Fetch error:", error);
            toast.error("Failed to fetch requests");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchData(1, 1);
        }, 500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageSize, searchTerm, filterStatus]);

    // Sync tab when ?tab= query parameter changes
    useEffect(() => {
        if (tabParam === 'delivery' || tabParam === 'sellers') {
            setActiveTab(tabParam);
        }
    }, [tabParam]);

    // Real-time table refresh on admin:withdrawal:new
    useEffect(() => {
        const getToken = createSocketTokenReader(STORAGE_KEYS.AUTH_ADMIN);
        getOrderSocket(getToken);

        const unsubscribe = onAdminWithdrawalNew(getToken, (payload) => {
            fetchData(sellerPage, deliveryPage);
            if (payload?.tab && (payload.tab === 'sellers' || payload.tab === 'delivery')) {
                setActiveTab(payload.tab);
                setSearchParams({ tab: payload.tab });
            }
        });

        return () => {
            unsubscribe();
        };
    }, [sellerPage, deliveryPage, setSearchParams]);

    const fetchSellerPage = (p) => {
        fetchData(p, deliveryPage);
        setSellerPage(p);
    };
    const fetchDeliveryPage = (p) => {
        fetchData(sellerPage, p);
        setDeliveryPage(p);
    };

    const stats = useMemo(() => {
        const sData = Array.isArray(sellerRequests) ? sellerRequests : [];
        const dData = Array.isArray(deliveryRequests) ? deliveryRequests : [];

        return {
            sellers: {
                pending: sData.filter(r => r.status === 'Pending' || r.status === 'Processing').length,
                amount: Math.abs(sData.filter(r => r.status === 'Pending' || r.status === 'Processing').reduce((acc, r) => acc + (Number(r.amount) || 0), 0)),
                processed: sData.filter(r => r.status === 'Settled').length
            },
            delivery: {
                pending: dData.filter(r => r.status === 'Pending' || r.status === 'Processing').length,
                amount: Math.abs(dData.filter(r => r.status === 'Pending' || r.status === 'Processing').reduce((acc, r) => acc + (Number(r.amount) || 0), 0)),
                processed: dData.filter(r => r.status === 'Settled').length
            }
        };
    }, [sellerRequests, deliveryRequests]);

    const currentData = useMemo(() => {
        const data = activeTab === 'sellers' ? (sellerRequests || []) : (deliveryRequests || []);
        return data.filter(r => {
            const name = r.user?.shopName || r.user?.name || "";
            const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                r._id?.toLowerCase().includes(searchTerm.toLowerCase());
            const matchesStatus = filterStatus === 'all' || r.status?.toLowerCase() === filterStatus.toLowerCase();
            return matchesSearch && matchesStatus;
        });
    }, [activeTab, sellerRequests, deliveryRequests, searchTerm, filterStatus]);

    const handleAction = (type, request) => {
        setActionModal({ isOpen: true, type, request });
    };

    const confirmAction = async () => {
        try {
            setLoading(true);
            const status = actionModal.type === 'approve' ? 'Settled' : 'Failed';
            const res = await adminApi.updateWithdrawalStatus(actionModal.request._id, { status });
            if (res.data.success) {
                toast.success(`Request ${status} successfully`);
                fetchData(sellerPage, deliveryPage);
                setActionModal({ isOpen: false, type: null, request: null });
            }
        } catch (error) {
            toast.error("Action failed");
        } finally {
            setLoading(false);
        }
    };

    const handleExport = async () => {
        try {
            toast.loading(`Exporting ${activeTab} data...`, { id: "export" });
            const apiMethod = activeTab === 'sellers' ? adminApi.getSellerWithdrawals : adminApi.getDeliveryWithdrawals;
            
            const params = { page: 1, limit: 5000 };
            if (searchTerm.trim()) params.search = searchTerm.trim();
            if (filterStatus !== 'all') params.status = filterStatus;

            let items = [];
            try {
                const res = await apiMethod(params);
                if (res?.data?.success) {
                    const payload = res.data.result || {};
                    items = Array.isArray(payload.items) ? payload.items : (res.data.results || []);
                }
            } catch (apiErr) {
                console.warn("API query failed, using local list", apiErr);
            }

            if (!items.length) {
                items = activeTab === 'sellers' ? sellerRequests : deliveryRequests;
            }
            
            if (!items || !items.length) {
                toast.error("No data to export", { id: "export" });
                return;
            }

            const formatted = items.map(req => {
                const dt = new Date(req.createdAt);
                return {
                    "Date": dt.toLocaleDateString('en-IN'),
                    "Time": dt.toLocaleTimeString('en-IN'),
                    "Requester Name": req.user?.shopName || req.user?.name || 'Unknown',
                    "Requester Phone": req.user?.phone || 'N/A',
                    "Amount (INR)": Math.abs(req.amount || 0),
                    "Status": (req.status || 'Unknown').toUpperCase(),
                    "Reference ID": req.reference || req._id || 'N/A'
                };
            });

            exportToCSV(formatted, `${activeTab}_withdrawals`);
            toast.success("Export successful", { id: "export" });
        } catch (error) {
            console.error("Export error:", error);
            toast.error("Export failed", { id: "export" });
        }
    };

    return (
        <div className="ds-section-spacing animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 px-1">
                <div>
                    <h1 className="ds-h1 flex items-center gap-3">
                        Withdrawal Requests
                        <Badge variant="primary" className="text-[10px] px-2 py-0.5 font-bold uppercase tracking-wider">Financial Hub</Badge>
                    </h1>
                    <p className="ds-description mt-1">Review and process fund disbursement requests from sellers and delivery partners.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => fetchData(sellerPage, deliveryPage)}
                        className="p-2.5 bg-white ring-1 ring-slate-200 text-slate-600 rounded-2xl hover:bg-slate-50 transition-all shadow-sm"
                    >
                        <RotateCw className={cn("h-4 w-4", loading && "animate-spin")} />
                    </button>
                    <button 
                        onClick={handleExport}
                        className="flex items-center gap-2 px-4 py-2.5 bg-white ring-1 ring-slate-200 text-slate-600 rounded-2xl text-xs font-bold hover:bg-slate-50 transition-all shadow-sm">
                        <Download className="h-4 w-4" />
                        EXPORT ALL
                    </button>
                </div>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { label: 'Total Pending', value: stats.sellers.pending + stats.delivery.pending, icon: Clock, color: 'amber', bg: 'bg-amber-50', iconColor: 'text-amber-500' },
                    { label: 'Pending Volume', value: `₹${(stats.sellers.amount + stats.delivery.amount).toLocaleString()}`, icon: Banknote, color: 'blue', bg: 'bg-brand-50', iconColor: 'text-brand-500' },
                    { label: 'Settled Today', value: stats.sellers.processed + stats.delivery.processed, icon: CheckCircle2, color: 'emerald', bg: 'bg-brand-50', iconColor: 'text-brand-500' },
                ].map((stat, i) => (
                    <Card key={i} className="p-6 border-none shadow-sm ring-1 ring-slate-100 bg-white">
                        <div className="flex items-center gap-4">
                            <div className={cn("p-3 rounded-2xl", stat.bg)}>
                                <stat.icon className={cn("h-6 w-6", stat.iconColor)} />
                            </div>
                            <div>
                                <p className="ds-label mb-1">{stat.label}</p>
                                <h3 className="ds-stat-medium">{stat.value}</h3>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>

            {/* Main Interface Tab Structure */}
            <div className="space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex bg-slate-100 p-1.5 rounded-2xl w-fit">
                        <button
                            onClick={() => {
                                setActiveTab('sellers');
                                setSearchParams({ tab: 'sellers' });
                            }}
                            className={cn(
                                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold transition-all",
                                activeTab === 'sellers' ? "bg-white text-slate-900 shadow-md" : "text-slate-500 hover:text-slate-700"
                            )}
                        >
                            <Building2 className="h-4 w-4" />
                            SELLER REQUESTS
                            <span className={cn(
                                "ml-1 px-2 py-0.5 rounded-full text-[10px]",
                                activeTab === 'sellers' ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600"
                            )}>{sellerRequests.length}</span>
                        </button>
                        <button
                            onClick={() => {
                                setActiveTab('delivery');
                                setSearchParams({ tab: 'delivery' });
                            }}
                            className={cn(
                                "flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold transition-all",
                                activeTab === 'delivery' ? "bg-white text-slate-900 shadow-md" : "text-slate-500 hover:text-slate-700"
                            )}
                        >
                            <Truck className="h-4 w-4" />
                            DELIVERY PARTNERS
                            <span className={cn(
                                "ml-1 px-2 py-0.5 rounded-full text-[10px]",
                                activeTab === 'delivery' ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-600"
                            )}>{deliveryRequests.length}</span>
                        </button>
                    </div>

                    <div className="flex items-center gap-3">
                        <div className="relative group">
                            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                            <input
                                type="text"
                                placeholder="Search by ID or Name..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-10 pr-4 py-2.5 bg-white ring-1 ring-slate-200 rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/10 w-64 transition-all"
                            />
                        </div>
                        <div className="flex bg-slate-100 p-1 rounded-xl">
                            {['all', 'pending', 'settled'].map((status) => (
                                <button
                                    key={status}
                                    onClick={() => setFilterStatus(status)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-all",
                                        filterStatus === status ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                                    )}
                                >
                                    {status}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Content Area */}
                <Card className="border-none shadow-2xl ring-1 ring-slate-100 overflow-hidden bg-white rounded-xl">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50/50 border-b border-slate-100">
                                    <th className="ds-table-header-cell pl-8">Requester Details</th>
                                    <th className="ds-table-header-cell">Request ID</th>
                                    <th className="ds-table-header-cell text-center">Amount Requested</th>
                                    <th className="ds-table-header-cell">Gateway Status</th>
                                    <th className="ds-table-header-cell text-right pr-8">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {currentData.map((req, i) => (
                                    <tr key={req._id} className="group hover:bg-slate-50/30 transition-all">
                                        <td className="px-6 py-5 pl-8">
                                            <div className="flex items-center gap-4">
                                                <div className={cn(
                                                    "h-12 w-12 rounded-2xl flex items-center justify-center shadow-inner",
                                                    activeTab === 'sellers' ? "bg-brand-50 text-brand-600" : "bg-brand-50 text-brand-600"
                                                )}>
                                                    {activeTab === 'sellers' ? <Building2 className="h-6 w-6" /> : <Truck className="h-6 w-6" />}
                                                </div>
                                                <div>
                                                    <p className="text-sm font-bold text-slate-900 group-hover:text-primary transition-colors cursor-pointer" onClick={() => setSelectedRequest(req)}>
                                                        {req.user?.shopName || req.user?.name || "Unknown"}
                                                    </p>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{req.user?.phone}</span>
                                                        <span className="h-1 w-1 rounded-full bg-slate-300" />
                                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">{new Date(req.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                                                    </div>
                                                    {req.metadata?.destinationDetails && (
                                                        <div className="mt-1">
                                                            <span className="text-[9px] font-black text-brand-700 bg-brand-50 px-2 py-0.5 rounded-md border border-brand-200/60">
                                                                {req.metadata.destinationDetails}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-6 py-5">
                                            <span className="text-[10px] font-mono font-bold text-slate-500">{req.reference || req._id}</span>
                                        </td>
                                        <td className="px-6 py-5 text-center">
                                            <p className="text-sm font-black text-slate-900">₹{Math.abs(req.amount).toLocaleString()}</p>
                                        </td>
                                        <td className="px-6 py-5">
                                            <Badge
                                                variant={req.status === 'Pending' ? 'warning' : req.status === 'Settled' ? 'success' : req.status === 'Processing' ? 'primary' : 'danger'}
                                                className="text-[9px] font-black px-3 py-1 uppercase tracking-wider"
                                            >
                                                {req.status}
                                            </Badge>
                                        </td>
                                        <td className="px-6 py-5 text-right pr-8">
                                            <div className="flex items-center justify-end gap-2">
                                                {req.status === 'Pending' && (
                                                    <>
                                                        <button
                                                            onClick={() => handleAction('approve', req)}
                                                            className="p-2 bg-brand-50 text-brand-600 rounded-xl hover:bg-black  hover:text-white transition-all active:scale-90"
                                                        >
                                                            <CheckCircle className="h-4 w-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => handleAction('reject', req)}
                                                            className="p-2 bg-rose-50 text-rose-600 rounded-xl hover:bg-rose-600 hover:text-white transition-all active:scale-90"
                                                        >
                                                            <XCircle className="h-4 w-4" />
                                                        </button>
                                                    </>
                                                )}
                                                <button
                                                    onClick={() => setSelectedRequest(req)}
                                                    className="p-2 bg-slate-50 text-slate-400 rounded-xl hover:bg-slate-900 hover:text-white transition-all active:scale-90"
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {currentData.length === 0 && (
                                    <tr>
                                        <td colSpan="5" className="px-6 py-20 text-center">
                                            <div className="flex flex-col items-center">
                                                <div className="p-4 bg-slate-50 rounded-full mb-4">
                                                    <FileText className="h-8 w-8 text-slate-200" />
                                                </div>
                                                <p className="text-slate-400 font-bold text-sm">No withdrawal requests found for this category.</p>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                    <div className="px-6 py-3 border-t border-slate-100">
                        <Pagination
                            page={activeTab === 'sellers' ? sellerPage : deliveryPage}
                            totalPages={Math.ceil((activeTab === 'sellers' ? sellerTotal : deliveryTotal) / pageSize) || 1}
                            total={activeTab === 'sellers' ? sellerTotal : deliveryTotal}
                            pageSize={pageSize}
                            onPageChange={activeTab === 'sellers' ? fetchSellerPage : fetchDeliveryPage}
                            onPageSizeChange={(newSize) => {
                                setPageSize(newSize);
                                setSellerPage(1);
                                setDeliveryPage(1);
                            }}
                            loading={loading}
                        />
                    </div>
                </Card>
            </div>

            {/* Request Detail Modal */}
            <Modal
                isOpen={!!selectedRequest}
                onClose={() => setSelectedRequest(null)}
                title="Withdrawal Intel"
                size="md"
            >
                {selectedRequest && (
                    <div className="ds-section-spacing">
                        <div className="flex items-center gap-6 p-6 bg-slate-50 rounded-xl border border-slate-100">
                            <div className={cn(
                                "h-20 w-20 rounded-xl flex items-center justify-center shadow-xl",
                                activeTab === 'sellers' ? "bg-black  text-primary-foreground" : "bg-black  text-primary-foreground"
                            )}>
                                {activeTab === 'sellers' ? <Building2 className="h-10 w-10" /> : <Truck className="h-10 w-10" />}
                            </div>
                            <div>
                                <h3 className="text-2xl font-black text-slate-900 tracking-tight">{selectedRequest.user?.shopName || selectedRequest.user?.name || "Unknown"}</h3>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mt-1">{selectedRequest._id}</p>
                                <div className="flex items-center gap-2 mt-3">
                                    <Badge variant={selectedRequest.status === 'Pending' ? 'warning' : 'success'}>
                                        {selectedRequest.status.toUpperCase()}
                                    </Badge>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Requested on {new Date(selectedRequest.createdAt).toLocaleString()}</span>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4">
                            <Card className="p-5 border-none bg-slate-50 ring-1 ring-slate-100 rounded-xl">
                                <p className="ds-label mb-2">Request Amount</p>
                                <h4 className="text-2xl font-black text-slate-900">₹{Math.abs(selectedRequest.amount).toLocaleString()}</h4>
                                <p className="text-[10px] font-semibold text-slate-400 mt-1">Reference: {selectedRequest.reference}</p>
                            </Card>
                            {(() => {
                                const bank = getBankInfo(selectedRequest);
                                return (
                                    <Card className="p-5 border border-brand-100/80 bg-gradient-to-br from-brand-50/50 via-white to-slate-50/80 rounded-2xl shadow-sm space-y-3.5">
                                        <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                                            <div className="flex items-center gap-2">
                                                <div className="p-1.5 bg-brand-50 text-brand-600 rounded-lg">
                                                    <CreditCard className="h-4 w-4" />
                                                </div>
                                                <div>
                                                    <p className="text-[11px] font-black text-slate-900 uppercase tracking-wider">
                                                        {activeTab === 'sellers' ? 'Seller Bank Details' : 'Driver Bank Details'}
                                                    </p>
                                                    <p className="text-[9px] font-bold text-slate-400">
                                                        {bank.bankName || (activeTab === 'sellers' ? 'Verified Partner Account' : 'Registered Payout Account')}
                                                    </p>
                                                </div>
                                            </div>
                                            <span className="text-[10px] font-black px-2.5 py-1 rounded-full bg-slate-900 text-white tracking-wide uppercase shadow-sm">
                                                {bank.payoutMethod}
                                            </span>
                                        </div>

                                        {bank.hasBank ? (
                                            <div className="space-y-2.5">
                                                <div className="grid grid-cols-2 gap-2.5 bg-white p-3 rounded-xl border border-slate-100 shadow-xs">
                                                    <div>
                                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Account Holder</p>
                                                        <p className="text-xs font-black text-slate-900 break-words mt-0.5">
                                                            {bank.accountHolder || selectedRequest.user?.shopName || selectedRequest.user?.name || "N/A"}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Bank Name</p>
                                                        <p className="text-xs font-black text-slate-900 mt-0.5">
                                                            {bank.bankName || "Standard Bank Transfer"}
                                                        </p>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                                                    <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-xs flex items-center justify-between group">
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Account Number</p>
                                                            <p className="text-xs font-black font-mono text-slate-900 tracking-wider mt-0.5 select-all truncate">
                                                                {bank.accountNumber || "Not Provided"}
                                                            </p>
                                                        </div>
                                                        {bank.accountNumber && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCopy(bank.accountNumber, 'acc')}
                                                                className="ml-2 p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                                                                title="Copy Account Number"
                                                            >
                                                                {copiedField === 'acc' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                                                            </button>
                                                        )}
                                                    </div>

                                                    <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-xs flex items-center justify-between group">
                                                        <div className="min-w-0 flex-1">
                                                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">IFSC Code</p>
                                                            <p className="text-xs font-black font-mono text-slate-900 uppercase tracking-wider mt-0.5 select-all truncate">
                                                                {bank.ifsc || "Not Provided"}
                                                            </p>
                                                        </div>
                                                        {bank.ifsc && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCopy(bank.ifsc, 'ifsc')}
                                                                className="ml-2 p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                                                                title="Copy IFSC"
                                                            >
                                                                {copiedField === 'ifsc' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {(bank.accountType || bank.branch) && (
                                                    <div className="grid grid-cols-2 gap-2.5 bg-white p-3 rounded-xl border border-slate-100 shadow-xs">
                                                        {bank.accountType && (
                                                            <div>
                                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Account Type</p>
                                                                <p className="text-xs font-bold text-slate-800 mt-0.5">{bank.accountType}</p>
                                                            </div>
                                                        )}
                                                        {bank.branch && (
                                                            <div>
                                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Branch</p>
                                                                <p className="text-xs font-bold text-slate-800 mt-0.5">{bank.branch}</p>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        ) : bank.upiId ? (
                                            <div className="bg-white p-3.5 rounded-xl border border-slate-100 shadow-xs flex items-center justify-between">
                                                <div>
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">UPI ID</p>
                                                    <p className="text-xs font-black font-mono text-slate-900 mt-0.5 select-all">{bank.upiId}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => handleCopy(bank.upiId, 'upi')}
                                                    className="p-1.5 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                                                >
                                                    {copiedField === 'upi' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="bg-amber-50/80 border border-amber-200/80 rounded-xl p-3.5 text-amber-800">
                                                <p className="text-xs font-bold flex items-center gap-1.5">
                                                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                                                    No registered bank details found for this {activeTab === 'sellers' ? 'seller' : 'driver'}.
                                                </p>
                                                {bank.destinationDetails && bank.destinationDetails !== 'Bank Transfer' && (
                                                    <p className="text-[11px] font-semibold text-amber-700 mt-1 pl-5">
                                                        Specified destination: {bank.destinationDetails}
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {bank.destinationDetails && bank.hasBank && bank.destinationDetails !== 'Bank Transfer' && (
                                            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px]">
                                                <span className="text-slate-400 font-bold uppercase tracking-wider">Destination Note:</span>
                                                <span className="font-black text-slate-700">{bank.destinationDetails}</span>
                                            </div>
                                        )}
                                    </Card>
                                );
                            })()}
                        </div>

                        <div className="flex gap-3 pt-2">
                            {selectedRequest.status === 'Pending' ? (
                                <>
                                    <button
                                        onClick={() => { setSelectedRequest(null); handleAction('approve', selectedRequest); }}
                                        className="flex-1 py-4 bg-black  hover:bg-brand-700 text-primary-foreground rounded-2xl font-black text-[11px] uppercase tracking-widest shadow-xl shadow-brand-200 transition-all active:scale-[0.98]"
                                    >
                                        Authorize Transfer
                                    </button>
                                    <button
                                        onClick={() => { setSelectedRequest(null); handleAction('reject', selectedRequest); }}
                                        className="flex-1 py-4 bg-white ring-1 ring-slate-200 text-slate-600 rounded-2xl font-black text-[11px] uppercase tracking-widest hover:bg-slate-50 transition-all"
                                    >
                                        Deny Request
                                    </button>
                                </>
                            ) : (
                                <button
                                    onClick={() => setSelectedRequest(null)}
                                    className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-[11px] uppercase tracking-widest"
                                >
                                    Close Intelligence
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </Modal>

            {/* Action Confirmation Modal */}
            <Modal
                isOpen={actionModal.isOpen}
                onClose={() => !loading && setActionModal({ isOpen: false, type: null, request: null })}
                title="Confirm Financial Action"
                size="sm"
            >
                {actionModal.request && (
                    <div className="text-center space-y-6">
                        <div className={cn(
                            "h-16 w-16 rounded-xl flex items-center justify-center mx-auto",
                            actionModal.type === 'approve' ? "bg-brand-50 text-brand-600" : "bg-rose-50 text-rose-600"
                        )}>
                            {actionModal.type === 'approve' ? <CheckCircle className="h-8 w-8" /> : <XCircle className="h-8 w-8" />}
                        </div>
                        <div>
                            <h3 className="text-xl font-black text-slate-900">Are you sure?</h3>
                            <p className="text-sm font-medium text-slate-500 mt-2 px-6">
                                You are about to {actionModal.type === 'approve' ? 'approve' : 'reject'} the withdrawal request for <b className="text-slate-900">₹{Math.abs(actionModal.request.amount).toLocaleString()}</b>.
                            </p>
                        </div>
                        <div className="space-y-3">
                            <button
                                onClick={confirmAction}
                                disabled={loading}
                                className={cn(
                                    "w-full py-4 rounded-2xl font-black text-[11px] uppercase tracking-widest transition-all shadow-xl flex items-center justify-center gap-2",
                                    actionModal.type === 'approve' ? "bg-black  hover:bg-brand-700 text-primary-foreground shadow-brand-100" : "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-100"
                                )}
                            >
                                {loading && <RotateCw className="h-4 w-4 animate-spin" />}
                                {loading ? 'PROCESSING...' : `YES, ${actionModal.type.toUpperCase()}`}
                            </button>
                            <button
                                onClick={() => setActionModal({ isOpen: false, type: null, request: null })}
                                disabled={loading}
                                className="w-full py-4 bg-slate-50 text-slate-400 font-black text-[11px] uppercase tracking-widest rounded-2xl hover:bg-slate-100 transition-all"
                            >
                                CANCEL
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default WithdrawalRequests;
