import React, { useState, useMemo, useEffect } from 'react';
import Card from '@shared/components/ui/Card';
import Badge from '@shared/components/ui/Badge';
import {
    Search,
    Filter,
    CheckCircle,
    XCircle,
    FileSearch,
    Phone,
    Mail,
    Truck,
    MapPin,
    Calendar,
    IdCard,
    RotateCw,
    Check,
    X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { adminApi } from '../services/adminApi';
import { usePendingReview } from '@core/context/PendingReviewContext';

const resolveUrl = (path) => {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    const backendHost = import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace(/\/api\/?$/, '') : 'http://localhost:5000';
    return `${backendHost}${path.startsWith('/') ? '' : '/'}${path}`;
};

const PendingDeliveryBoys = () => {
    const { refreshPendingCounts } = usePendingReview();
    const [pendingRiders, setPendingRiders] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [viewingRider, setViewingRider] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);

    // Lock body scroll when modal is viewing details
    useEffect(() => {
        if (viewingRider) {
            document.body.style.overflow = 'hidden';
            document.documentElement.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
            document.documentElement.style.overflow = '';
        };
    }, [viewingRider]);

    // Fetch Pending Riders
    const fetchPendingRiders = async () => {
        setIsLoading(true);
        try {
            // verified=false fetches riders waiting for review
            const params = { verified: 'false' };
            if (searchTerm.trim()) params.search = searchTerm.trim();
            const response = await adminApi.getDeliveryPartners(params);
            const payload = response.data.result || {};
            const list = Array.isArray(payload.items) ? payload.items : (response.data.results || []);

            // Map backend data to frontend format
            const mappedRiders = list.map(r => {
                const docsObj = r.documents || {};
                const docItems = [];
                if (docsObj.aadhar) docItems.push({ name: 'Aadhar Card', key: 'aadhar', url: docsObj.aadhar });
                if (docsObj.pan) docItems.push({ name: 'PAN Card', key: 'pan', url: docsObj.pan });
                if (docsObj.drivingLicense) docItems.push({ name: 'Driving License', key: 'drivingLicense', url: docsObj.drivingLicense });

                return {
                    id: r._id,
                    name: r.name,
                    phone: r.phone,
                    email: r.email || 'Not Provided',
                    avatar: r.profileImage || r.avatar || '',
                    appliedDate: new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                    location: r.currentArea || 'Unknown',
                    preferredArea: r.currentArea || 'Not Specified',
                    vehicle: r.vehicleType ? r.vehicleType.toUpperCase() : 'BIKE',
                    vehicleNumber: r.vehicleNumber || 'Not Specified',
                    drivingLicenseNumber: r.drivingLicenseNumber || 'Not Specified',
                    documents: docItems,
                    status: r.isVerified ? 'approved' : 'pending_review',
                    dob: r.dob || 'Not Specified',
                    bloodGroup: r.bloodGroup || 'Not Specified',
                    address: r.address || 'Not Specified'
                };
            });

            setPendingRiders(mappedRiders);
        } catch (error) {
            console.error('Fetch Pending Riders Error:', error);
            toast.error('Failed to load applications');
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchPendingRiders();
        }, 500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm, filterStatus]);

    const filteredRiders = useMemo(() => {
        return pendingRiders.filter(r => {
            const matchesSearch = r.name.toLowerCase().includes(searchTerm.toLowerCase()) || r.phone.includes(searchTerm);
            
            let matchesStatus = true;
            if (filterStatus === 'pending') {
                matchesStatus = r.status === 'pending_review';
            } else if (filterStatus === 'missing_info') {
                matchesStatus = !r.location || r.location === 'Unknown' || r.location === 'Not Specified';
            }

            return matchesSearch && matchesStatus;
        });
    }, [pendingRiders, searchTerm, filterStatus]);

    const handleApprove = async (id) => {
        setIsProcessing(true);
        try {
            await adminApi.approveDeliveryPartner(id);
            toast.success('Rider Approved & Activated!');
            setPendingRiders(pendingRiders.filter(r => r.id !== id));
            setViewingRider(null);
            refreshPendingCounts?.();
        } catch (error) {
            console.error('Approval Error:', error);
            toast.error('Failed to approve rider');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReject = async (id) => {
        if (window.confirm('Are you sure you want to reject this application?')) {
            setIsProcessing(true);
            try {
                await adminApi.rejectDeliveryPartner(id);
                toast.success('Application Rejected');
                setPendingRiders(pendingRiders.filter(r => r.id !== id));
                setViewingRider(null);
                refreshPendingCounts?.();
            } catch (error) {
                console.error('Rejection Error:', error);
                toast.error('Failed to reject rider');
            } finally {
                setIsProcessing(false);
            }
        }
    };

    return (
        <div className="ds-section-spacing animate-in fade-in duration-700">
            {/* Header Section */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div>
                    <h1 className="ds-h1 flex items-center gap-3">
                        Rider Applications
                        {pendingRiders.length > 0 && (
                            <span className="min-w-5 h-5 px-1.5 rounded-full bg-rose-500 text-white text-[11px] font-black inline-flex items-center justify-center shadow-lg shadow-rose-500/30">
                                {pendingRiders.length > 99 ? '99+' : pendingRiders.length}
                            </span>
                        )}
                        <Badge variant="primary" className="text-[10px] px-2 py-0.5 uppercase">Pending Review</Badge>
                    </h1>
                    <p className="ds-description mt-1">Review documents for new delivery partners.</p>
                </div>
                <div className="flex items-center gap-3">
                    <button 
                        onClick={fetchPendingRiders}
                        className="p-3 bg-white ring-1 ring-slate-200 rounded-2xl text-slate-400 hover:text-primary transition-all shadow-sm active:rotate-180 duration-500"
                    >
                        <RotateCw className="h-5 w-5" />
                    </button>
                    <div className="h-10 w-[1px] bg-slate-200 mx-2" />
                    <div className="flex flex-col items-end">
                        <p className="ds-label">Total Pending</p>
                        <h4 className="ds-h2">{pendingRiders.length}</h4>
                    </div>
                </div>
            </div>

            {/* Utility Bar */}
            <Card className="p-4 border-none shadow-sm ring-1 ring-slate-100 bg-white/50 backdrop-blur-xl">
                <div className="flex flex-col lg:flex-row gap-4">
                    <div className="flex-1 relative group">
                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400 group-focus-within:text-primary transition-colors" />
                        <input
                            type="text"
                            placeholder="Search by name or mobile..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-12 pr-4 py-3.5 bg-slate-100/50 border-none rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/10 transition-all"
                        />
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="bg-slate-100/50 p-1 rounded-2xl flex items-center">
                            {['all', 'pending', 'missing_info'].map((status) => (
                                <button
                                    key={status}
                                    onClick={() => setFilterStatus(status)}
                                    className={cn(
                                        "px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all",
                                        filterStatus === status
                                            ? "bg-white text-slate-900 shadow-sm"
                                            : "text-slate-400 hover:text-slate-600"
                                    )}
                                >
                                    {status === 'pending' ? 'PENDING' : status.replace('_', ' ')}
                                </button>
                            ))}
                        </div>
                        <button className="p-3.5 bg-white ring-1 ring-slate-200 rounded-2xl text-slate-600 hover:text-primary transition-all">
                            <Filter className="h-5 w-5" />
                        </button>
                    </div>
                </div>
            </Card>

            {/* Applications Table View */}
            <Card className="border-none shadow-2xl ring-1 ring-slate-100 overflow-hidden bg-white rounded-xl relative min-h-[400px]">
                {isLoading && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-3">
                            <div className="h-10 w-10 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Loading Applications...</p>
                        </div>
                    </div>
                )}
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-100">
                                <th className="ds-table-header-cell px-8 py-4">Applicant Details</th>
                                <th className="ds-table-header-cell px-8 py-4">Operational Intel</th>
                                <th className="ds-table-header-cell px-8 py-4">Submission Status</th>
                                <th className="ds-table-header-cell px-8 py-4 !text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {!isLoading && filteredRiders.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="py-20 text-center">
                                        <FileSearch className="h-10 w-10 text-slate-300 mx-auto mb-4" />
                                        <p className="text-sm font-bold text-slate-500">No pending applications found.</p>
                                    </td>
                                </tr>
                            ) : (
                                filteredRiders.map((rider) => (
                                    <tr key={rider.id} className="group hover:bg-slate-50/50 transition-colors">
                                        <td className="px-8 py-6">
                                            <div className="flex items-center gap-4">
                                                <img 
                                                   src={resolveUrl(rider.avatar) || "https://cdn-icons-png.flaticon.com/512/149/149071.png"} 
                                                   alt={rider.name} 
                                                   className="h-12 w-12 rounded-lg bg-gray-100 ring-2 ring-white shadow-sm object-cover group-hover:scale-105 transition-all"
                                                   onError={(e) => { e.target.src = "https://cdn-icons-png.flaticon.com/512/149/149071.png"; }}
                                                />
                                                <div>
                                                    <p className="text-sm font-black text-slate-900">{rider.name}</p>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <Phone className="h-3 w-3 text-slate-400" />
                                                        <span className="text-[10px] font-bold text-slate-500">{rider.phone}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6">
                                            <div className="space-y-1.5">
                                                <div className="flex items-center gap-2 text-slate-600">
                                                    <Truck className="h-3.5 w-3.5" />
                                                    <span className="text-[10px] font-bold">{rider.vehicle}</span>
                                                </div>
                                                <div className="flex items-center gap-2 text-slate-400">
                                                    <MapPin className="h-3.5 w-3.5" />
                                                    <span className="text-[10px] font-bold">{rider.preferredArea}</span>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6">
                                            <div className="flex flex-col gap-2">
                                                <Badge variant={rider.status === 'pending_review' ? 'primary' : 'warning'} className="w-fit text-[8px] font-black uppercase">
                                                    {rider.status.replace('_', ' ')}
                                                </Badge>
                                                <div className="flex gap-1 flex-wrap">
                                                    {rider.documents.map((doc, i) => (
                                                        <div key={i} className="h-5 px-2 bg-slate-100 rounded-md text-[8px] font-bold text-slate-600 flex items-center">
                                                            {doc.name}
                                                        </div>
                                                    ))}
                                                    {rider.documents.length === 0 && (
                                                        <span className="text-[9px] text-slate-400 italic">No Docs</span>
                                                    )}
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-8 py-6 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => handleApprove(rider.id)}
                                                    className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center transition-all shadow-sm"
                                                    title="Approve"
                                                >
                                                    <Check className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => handleReject(rider.id)}
                                                    className="h-8 w-8 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 flex items-center justify-center transition-all shadow-sm"
                                                    title="Reject"
                                                >
                                                    <X className="h-4 w-4" />
                                                </button>
                                                <button
                                                    onClick={() => setViewingRider(rider)}
                                                    className="px-4 py-2 bg-slate-900 text-white rounded-lg text-[10px] font-bold shadow-xl shadow-slate-200 hover:bg-slate-800 transition-all active:scale-95"
                                                >
                                                    VIEW APPLICATION
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* Application Review Modal */}
            <AnimatePresence>
                {viewingRider && (
                    <div
                        className="fixed inset-0 z-[100] flex items-center justify-center p-4 lg:p-6"
                        onWheel={(e) => e.stopPropagation()}
                        onTouchMove={(e) => e.stopPropagation()}
                    >
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="fixed inset-0 bg-slate-900/60 backdrop-blur-xl"
                            onClick={() => setViewingRider(null)}
                        />
                        <motion.div
                            initial={{ opacity: 0, scale: 0.9, y: 30 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: 30 }}
                            className="w-full max-w-4xl relative z-10 bg-white rounded-3xl shadow-3xl overflow-hidden flex flex-col lg:flex-row max-h-[90vh] my-auto"
                        >
                            {/* Left: Applicant Profile Info */}
                            <div className="lg:w-72 bg-slate-50 p-6 border-r border-slate-100 flex flex-col justify-between overflow-y-auto overscroll-contain shrink-0">
                                <div>
                                    <div className="flex flex-col items-center text-center mb-8">
                                        <img 
                                           src={resolveUrl(viewingRider.avatar) || "https://cdn-icons-png.flaticon.com/512/149/149071.png"} 
                                           alt={viewingRider.name} 
                                           className="h-24 w-24 rounded-2xl bg-white shadow-xl object-cover ring-4 ring-white mb-3 mx-auto" 
                                           onError={(e) => { e.target.src = "https://cdn-icons-png.flaticon.com/512/149/149071.png"; }}
                                        />
                                        <h3 className="ds-h2 text-slate-900 font-bold">{viewingRider.name}</h3>
                                        <p className="text-xs font-semibold text-primary mt-1">Delivery Partner</p>
                                    </div>

                                    <div className="space-y-5">
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Preferred Area</p>
                                            <div className="flex items-center gap-2 text-slate-700">
                                                <MapPin className="h-4 w-4 text-slate-400 shrink-0" />
                                                <span className="text-xs font-bold">{viewingRider.preferredArea}</span>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Permanent Address</p>
                                            <div className="flex items-start gap-2 text-slate-700">
                                                <MapPin className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                                                <span className="text-xs font-bold leading-relaxed">{viewingRider.address}</span>
                                            </div>
                                        </div>
                                        {viewingRider.dob !== 'Not Specified' && (
                                            <div className="space-y-1">
                                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date of Birth</p>
                                                <div className="flex items-center gap-2 text-slate-700">
                                                    <Calendar className="h-4 w-4 text-slate-400 shrink-0" />
                                                    <span className="text-xs font-bold">{viewingRider.dob}</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Right: Document & Action Section */}
                            <div className="flex-1 p-6 lg:p-10 bg-white overflow-y-auto overscroll-contain">
                                <div className="flex justify-between items-start mb-8">
                                    <div>
                                        <h2 className="ds-h1">Vetting Protocol</h2>
                                        <p className="ds-description mt-1">Check submitted legal documents for platform entry.</p>
                                    </div>
                                    <button onClick={() => setViewingRider(null)} className="p-2.5 hover:bg-slate-100 rounded-2xl transition-all">
                                        <X className="h-5 w-5 text-slate-400" />
                                    </button>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                                    <div className="space-y-3">
                                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Contact Records</h4>
                                        <div className="p-4 bg-slate-50 rounded-2xl space-y-3 border border-slate-100">
                                            <div className="flex items-center gap-3">
                                                <div className="h-9 w-9 rounded-xl bg-white shadow-sm flex items-center justify-center text-primary shrink-0">
                                                    <Phone className="h-4 w-4" />
                                                </div>
                                                <span className="text-xs font-bold text-slate-900 truncate">{viewingRider.phone}</span>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="h-9 w-9 rounded-xl bg-white shadow-sm flex items-center justify-center text-primary shrink-0">
                                                    <Mail className="h-4 w-4" />
                                                </div>
                                                <span className="text-xs font-bold text-slate-900 truncate">{viewingRider.email}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Vehicle Identification</h4>
                                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                                            <div className="flex items-center gap-3">
                                                <div className="h-9 w-9 rounded-xl bg-white shadow-sm flex items-center justify-center text-brand-600 shrink-0">
                                                    <Truck className="h-4 w-4" />
                                                </div>
                                                <div>
                                                    <p className="text-xs font-black text-slate-900">{viewingRider.vehicle}</p>
                                                    <p className="text-[10px] text-slate-500 font-semibold">{viewingRider.vehicleNumber}</p>
                                                </div>
                                            </div>
                                            {viewingRider.drivingLicenseNumber !== 'Not Specified' && (
                                                <div className="pt-2 border-t border-slate-200/60 text-[11px] font-semibold text-slate-600 flex justify-between">
                                                    <span>DL Number:</span>
                                                    <span className="font-bold text-slate-900">{viewingRider.drivingLicenseNumber}</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Submitted Documents Section */}
                                <div className="space-y-3 mb-8">
                                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">
                                        Submitted Documents ({viewingRider.documents.length})
                                    </h4>
                                    {viewingRider.documents.length === 0 ? (
                                        <div className="p-4 bg-slate-50 rounded-2xl text-center border border-slate-100">
                                            <p className="text-xs text-slate-400 font-semibold">No documents uploaded by applicant.</p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {viewingRider.documents.map((doc, idx) => {
                                                const docUrl = resolveUrl(doc.url);
                                                return (
                                                    <a
                                                        key={idx}
                                                        href={docUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="group relative bg-slate-50 border border-slate-200/80 hover:border-primary p-3 rounded-2xl flex items-center gap-3 transition-all hover:shadow-md cursor-pointer"
                                                    >
                                                        <div className="h-12 w-12 rounded-xl bg-white border border-slate-100 flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
                                                            {docUrl && (docUrl.endsWith('.jpg') || docUrl.endsWith('.jpeg') || docUrl.endsWith('.png') || docUrl.endsWith('.webp') || docUrl.includes('data:image')) ? (
                                                                <img src={docUrl} alt={doc.name} className="h-full w-full object-cover" />
                                                            ) : (
                                                                <FileSearch className="h-6 w-6 text-primary group-hover:scale-110 transition-transform" />
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <p className="text-xs font-black text-slate-800 uppercase tracking-tight truncate">{doc.name}</p>
                                                            <p className="text-[10px] text-primary font-bold mt-0.5 group-hover:underline flex items-center gap-1">
                                                                View Document <FileSearch className="w-3 h-3 inline" />
                                                            </p>
                                                        </div>
                                                    </a>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>

                                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                                    <button
                                        disabled={isProcessing}
                                        onClick={() => handleApprove(viewingRider.id)}
                                        className="flex-1 py-4 bg-slate-900 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                                    >
                                        {isProcessing ? (
                                            <>
                                                <div className="h-4 w-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                                Processing Vetting...
                                            </>
                                        ) : (
                                            <>
                                                <Check className="h-4 w-4" />
                                                APPROVE & ACTIVATE RIDER
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => handleReject(viewingRider.id)}
                                        className="py-4 px-5 bg-rose-50 text-rose-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-rose-100 transition-all active:scale-95"
                                    >
                                        REJECT APPLICATION
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default PendingDeliveryBoys;
