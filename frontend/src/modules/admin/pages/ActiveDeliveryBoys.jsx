import React, { useState, useMemo, useEffect } from 'react';
import Card from '@shared/components/ui/Card';
import Badge from '@shared/components/ui/Badge';
import {
    Users,
    UserCheck,
    Activity,
    Trophy,
    Search,
    Filter,
    Plus,
    MoreVertical,
    Phone,
    MapPin,
    Truck,
    User,
    Star,
    DollarSign,
    ShieldCheck,
    XCircle,
    Pencil,
    Trash2,
    Eye,
    X
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import Pagination from '@shared/components/ui/Pagination';
import { adminApi } from '../services/adminApi';

const formatRiderId = (id) => {
    if (!id) return 'RD-N/A';
    const str = String(id);
    return str.length > 8 ? `RD-${str.slice(-6).toUpperCase()}` : `RD-${str.toUpperCase()}`;
};

const ActiveDeliveryBoys = () => {
    const [riders, setRiders] = useState([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [isLoading, setIsLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedRider, setSelectedRider] = useState(null);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isOnboardModalOpen, setIsOnboardModalOpen] = useState(false);
    const [viewingRider, setViewingRider] = useState(null);

    // Lock body scroll (Lenis smooth scroll) when any modal is open
    useEffect(() => {
        const isAnyModalOpen = !!viewingRider || isEditModalOpen || isOnboardModalOpen;
        if (isAnyModalOpen) {
            window.lenis?.stop();
        } else {
            window.lenis?.start();
        }
        return () => { window.lenis?.start(); };
    }, [viewingRider, isEditModalOpen, isOnboardModalOpen]);

    // Form states
    const [formState, setFormState] = useState({
        name: '', phone: '', email: '', vehicle: '', vehicleNum: '', location: ''
    });

    // Fetch Riders
    const fetchRiders = async (requestedPage = 1) => {
        setIsLoading(true);
        try {
            const params = { page: requestedPage, limit: pageSize, verified: 'true' };
            if (searchTerm.trim()) params.search = searchTerm.trim();
            if (statusFilter !== 'all') params.status = statusFilter;

            const response = await adminApi.getDeliveryPartners(params);
            const payload = response.data.result || {};
            const data = Array.isArray(payload.items) ? payload.items : (response.data.results || response.data.result || []);

            const mappedRiders = data.map(r => {
                const totalOrders = r.totalDeliveredOrders ?? r.totalOrders ?? r.deliveredOrdersCount ?? 0;
                const walletCreds = r.walletBalance ?? r.wallet ?? r.earnings ?? 0;
                const todayEarnings = r.todayEarnings ?? 0;
                const location = r.currentArea || r.address || (r.location?.coordinates?.[0] ? `${r.location.coordinates[1]?.toFixed?.(4) ?? r.location.coordinates[1]}, ${r.location.coordinates[0]?.toFixed?.(4) ?? r.location.coordinates[0]}` : '') || 'Unassigned';

                return {
                    id: r._id,
                    name: r.name,
                    phone: r.phone,
                    email: r.email || 'N/A',
                    status: r.isOnline ? 'available' : 'offline',
                    vehicle: r.vehicleType || 'N/A',
                    vehicleNum: r.vehicleNumber || 'N/A',
                    drivingLicenseNumber: r.drivingLicenseNumber || 'N/A',
                    dob: r.dob || 'N/A',
                    bloodGroup: r.bloodGroup || 'N/A',
                    address: r.address || location,
                    accountHolder: r.accountHolder || 'N/A',
                    accountNumber: r.accountNumber || 'N/A',
                    ifsc: r.ifsc || 'N/A',
                    documents: r.documents || {},
                    rating: typeof r.ratingAverage === 'number' && r.ratingAverage > 0 ? Number(r.ratingAverage.toFixed(1)) : 0,
                    ratingCount: r.ratingCount || 0,
                    totalOrders,
                    walletCreds,
                    todayEarnings,
                    rank: r.rank || 0,
                    location,
                    lastSync: 'Now',
                    joinDate: new Date(r.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }),
                    avatar: r.profileImage
                };
            });

            setRiders(mappedRiders);
            setTotal(typeof payload.total === 'number' ? payload.total : mappedRiders.length);
            setPage(typeof payload.page === 'number' ? payload.page : requestedPage);
        } catch (error) {
            console.error('Fetch Riders Error:', error);
            toast.error('Failed to fetch delivery partners');
        } finally {
            setIsLoading(false);
        }
    };

React.useEffect(() => {
    const timer = setTimeout(() => {
        fetchRiders(1);
    }, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
}, [pageSize, searchTerm, statusFilter]);

// Filtering logic
const filteredRiders = useMemo(() => {
    return riders.filter(r => {
        const matchesSearch = r.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.phone.includes(searchTerm);
        const matchesStatus = statusFilter === 'all' || r.status === statusFilter;
        return matchesSearch && matchesStatus;
    });
}, [riders, searchTerm, statusFilter]);

const handleAction = async (type, rider) => {
    if (type === 'view') {
        setViewingRider(rider);
    } else if (type === 'edit') {
        setFormState(rider);
        setSelectedRider(rider);
        setIsEditModalOpen(true);
    } else if (type === 'delete') {
        if (window.confirm(`Are you sure you want to deactivate ${rider.name}?`)) {
            try {
                await adminApi.rejectDeliveryPartner(rider.id);
                toast.success("Rider deactivated successfully");
                fetchRiders(page);
            } catch (err) {
                console.error("Deactivate error:", err);
                setRiders(riders.filter(r => r.id !== rider.id));
                toast.success("Rider removed");
            }
        }
    }
};

const validateForm = () => {
    if (!/^[a-zA-Z\s]+$/.test(formState.name.trim())) {
        toast.error("Name should contain only alphabets and spaces (no special characters or numbers).");
        return false;
    }
    if (!/^[6-9][0-9]{9}$/.test(formState.phone.trim())) {
        toast.error("Mobile number must be exactly 10 digits and start with 6, 7, 8, or 9.");
        return false;
    }
    if (formState.vehicle && formState.vehicle !== 'Cycle' && formState.vehicleNum && formState.vehicleNum !== 'N/A') {
        const cleaned = formState.vehicleNum.trim();
        if (!/^[A-Za-z]{2}\s?[0-9]{2}\s?[A-Za-z]{1,2}\s?[0-9]{4}$/.test(cleaned)) {
            toast.error("Vehicle registration number must follow the format 'AA 00 AA 0000' (e.g., MH 12 AB 1234).");
            return false;
        }
    }
    if (formState.location.trim().length < 3) {
        toast.error("Please enter a valid operational area (min 3 chars).");
        return false;
    }
    return true;
};

const handleOnboardSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    try {
        await adminApi.createDeliveryPartner({
            name: formState.name,
            phone: formState.phone,
            email: formState.email,
            vehicle: formState.vehicle,
            vehicleNum: formState.vehicleNum,
            location: formState.location,
            currentArea: formState.location,
            address: formState.location,
        });
        setIsOnboardModalOpen(false);
        setFormState({ name: '', phone: '', email: '', vehicle: '', vehicleNum: '', location: '' });
        toast.success("New rider added successfully");
        fetchRiders(1);
    } catch (error) {
        console.error("Onboard Rider Error:", error);
        toast.error(error.response?.data?.message || "Failed to add new rider");
    }
};

const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    try {
        await adminApi.updateDeliveryPartner(selectedRider.id, {
            name: formState.name,
            phone: formState.phone,
            email: formState.email,
            vehicle: formState.vehicle,
            vehicleNum: formState.vehicleNum,
            location: formState.location,
            currentArea: formState.location,
            address: formState.location,
        });
        setRiders(riders.map(r => r.id === selectedRider.id ? { ...r, ...formState, location: formState.location } : r));
        setIsEditModalOpen(false);
        setSelectedRider(null);
        toast.success("Rider details updated successfully");
        fetchRiders(page);
    } catch (error) {
        console.error("Update Rider Error:", error);
        toast.error(error.response?.data?.message || "Failed to update rider");
    }
};

const stats = [
    { label: 'Total Riders', value: riders.length, color: 'indigo', icon: Users, description: 'Total fleet size' },
    { label: 'Available', value: riders.filter(r => r.status === 'available').length, color: 'emerald', icon: UserCheck, description: 'Ready for orders' },
    { label: 'Busy (On Task)', value: riders.filter(r => r.status === 'busy').length, color: 'amber', icon: Activity, description: 'Currently delivering' },
    { label: 'Top Earners', value: riders.filter(r => r.rating >= 4.5).length, color: 'rose', icon: Trophy, description: 'High performance' },
];

return (
    <div className="ds-section-spacing animate-in fade-in duration-700">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div>
                <h1 className="ds-h1 flex items-center gap-3">
                    Delivery Boys
                    <div className="h-2 w-2 rounded-full bg-brand-500 animate-pulse" />
                </h1>
                <p className="ds-description mt-1">Manage all your active delivery partners here.</p>
            </div>
            <button
                onClick={() => setIsOnboardModalOpen(true)}
                className="flex items-center space-x-2 bg-slate-900 text-white px-6 py-3.5 rounded-2xl text-xs font-bold hover:bg-slate-800 transition-all shadow-xl hover:shadow-slate-200 active:scale-95 group"
            >
                <Plus className="h-4 w-4 group-hover:rotate-90 transition-transform" />
                <span>ADD NEW RIDER</span>
            </button>
        </div>

        {/* Quick Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {stats.map((stat, idx) => (
                <Card key={idx} className="p-6 border-none shadow-xl ring-1 ring-slate-100 hover:ring-primary/20 transition-all group overflow-hidden relative">
                    <div className="flex justify-between items-start relative z-10">
                        <div>
                            <p className="ds-label mb-2">{stat.label}</p>
                            <h3 className="ds-stat-medium">{stat.value}</h3>
                        </div>
                        <div className={cn(
                            "p-3 rounded-2xl transition-all duration-300 group-hover:scale-110 group-hover:rotate-3 shadow-lg",
                            stat.color === 'indigo' ? "bg-brand-500/10 text-brand-600 shadow-brand-100" :
                                stat.color === 'emerald' ? "bg-brand-500/10 text-brand-600 shadow-brand-100" :
                                    stat.color === 'amber' ? "bg-amber-500/10 text-amber-600 shadow-amber-100" :
                                        "bg-rose-500/10 text-rose-600 shadow-rose-100"
                        )}>
                            <stat.icon className="h-5 w-5" strokeWidth={2.5} />
                        </div>
                    </div>
                    {/* Decorative background element */}
                    <div className="absolute -bottom-6 -right-6 h-24 w-24 bg-slate-50 rounded-full group-hover:scale-150 transition-transform duration-700" />
                </Card>
            ))}
        </div>

        {/* Filters & Search Section */}
        <Card className="p-4 border-none shadow-sm ring-1 ring-slate-100 bg-white/50 backdrop-blur-xl">
            <div className="flex flex-col lg:flex-row gap-4">
                <div className="flex-1 relative group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4.5 w-4.5 text-slate-400 group-focus-within:text-primary transition-colors" />
                    <input
                        type="text"
                        placeholder="Search by name or phone number..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-12 pr-4 py-3.5 bg-slate-100/50 border-none rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/10 transition-all"
                    />
                </div>
                <div className="flex items-center gap-3">
                    <div className="bg-slate-100/50 p-1 rounded-2xl flex items-center">
                        {['all', 'available', 'busy', 'offline'].map((status) => (
                            <button
                                key={status}
                                onClick={() => setStatusFilter(status)}
                                className={cn(
                                    "px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all",
                                    statusFilter === status
                                        ? "bg-white text-slate-900 shadow-sm"
                                        : "text-slate-400 hover:text-slate-600"
                                )}
                            >
                                {status}
                            </button>
                        ))}
                    </div>
                    <button className="p-3.5 bg-white ring-1 ring-slate-200 rounded-2xl text-slate-600 hover:text-primary hover:ring-primary/30 transition-all shadow-sm">
                        <Filter className="h-5 w-5" />
                    </button>
                </div>
            </div>
        </Card>

        {/* Riders Grid View */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 relative min-h-[300px]">
            {isLoading && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-sm rounded-3xl">
                    <div className="flex flex-col items-center gap-3">
                        <div className="h-10 w-10 border-4 border-slate-200 border-t-primary rounded-full animate-spin" />
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Fetching fleet...</p>
                    </div>
                </div>
            )}
            <AnimatePresence mode='popLayout'>
                {!isLoading && filteredRiders.length === 0 ?
                    <div className="col-span-full py-20 text-center bg-slate-50 rounded-3xl border-2 border-dashed border-slate-200">
                        <User className="h-10 w-10 text-slate-300 mx-auto mb-4" />
                        <p className="text-sm font-bold text-slate-500">No delivery partners found matching your filters.</p>
                    </div>
                    :
                    filteredRiders.map((rider) => (
                        <motion.div
                            layout
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            key={rider.id}
                        >
                            <Card className="group border-none shadow-xl ring-1 ring-slate-100 hover:ring-primary/20 transition-all overflow-hidden bg-white">
                                <div className="p-6 space-y-5">
                                    {/* Rider Top Header */}
                                    <div className="flex justify-between items-start">
                                        <div className="flex gap-4">
                                            <div className="relative">
                                                <img 
                                                   src={rider.avatar && !rider.avatar.includes('emoji') && !rider.avatar.includes('avatar') ? rider.avatar : "https://cdn-icons-png.flaticon.com/512/149/149071.png"} 
                                                   alt="" 
                                                   className="h-14 w-14 rounded-lg bg-gray-100 ring-2 ring-white shadow-sm object-cover group-hover:scale-105 transition-transform" 
                                                />
                                                <div className={cn(
                                                    "absolute -bottom-1 -right-1 h-5 w-5 rounded-full border-4 border-white shadow-sm",
                                                    rider.status === 'available' ? 'bg-brand-500' :
                                                        rider.status === 'busy' ? 'bg-amber-500' : 'bg-slate-300'
                                                )} />
                                            </div>
                                            <div>
                                                <h4 className="text-sm font-black text-slate-900 group-hover:text-primary transition-colors">{rider.name}</h4>
                                                <div className="flex items-center gap-1.5 mt-1 text-slate-500">
                                                    <Phone className="h-3 w-3" />
                                                    <span className="text-[10px] font-bold">{rider.phone} • {formatRiderId(rider.id)}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1 bg-amber-50 text-amber-600 px-2 py-1 rounded-lg">
                                            <Star className="h-3 w-3 fill-current" />
                                            <span className="text-[10px] font-black">{rider.rating}</span>
                                        </div>
                                    </div>

                                    {/* Metrics Row */}
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="bg-slate-50 p-3 rounded-2xl">
                                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">Today Earnings</p>
                                            <div className="flex items-center gap-1.5">
                                                <DollarSign className="h-3.5 w-3.5 text-brand-500" />
                                                <span className="text-xs font-black text-slate-900">₹{rider.todayEarnings}</span>
                                            </div>
                                        </div>
                                        <div className="bg-slate-50 p-3 rounded-2xl">
                                            <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1.5">Total Success</p>
                                            <div className="flex items-center gap-1.5">
                                                <ShieldCheck className="h-3.5 w-3.5 text-brand-500" />
                                                <span className="text-xs font-black text-slate-900">{rider.totalOrders} Deliv.</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Location & Vehicle */}
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <MapPin className="h-3.5 w-3.5 shrink-0" />
                                            <span className="text-[10px] font-semibold truncate">{rider.location}</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <Truck className="h-3.5 w-3.5 shrink-0" />
                                            <span className="text-[10px] font-semibold truncate">{rider.vehicle} • <span className="text-slate-900 font-bold">{rider.vehicleNum}</span></span>
                                        </div>
                                    </div>

                                    {/* Action Footer */}
                                    <div className="pt-2 flex items-center gap-2">
                                        <button
                                            onClick={() => handleAction('view', rider)}
                                            className="flex-1 py-2.5 bg-slate-900 text-white rounded-xl text-[10px] font-bold shadow-lg shadow-slate-200 hover:bg-slate-800 transition-all active:scale-95 flex items-center justify-center gap-2"
                                        >
                                            <Eye className="h-3.5 w-3.5" />
                                            VIEW PROFILE
                                        </button>
                                        <button
                                            onClick={() => handleAction('edit', rider)}
                                            className="p-2.5 bg-slate-100 text-slate-600 rounded-xl hover:bg-brand-50 hover:text-brand-600 transition-all"
                                        >
                                            <Pencil className="h-4 w-4" />
                                        </button>
                                        <button
                                            onClick={() => handleAction('delete', rider)}
                                            className="p-2.5 bg-slate-100 text-slate-600 hover:bg-rose-50 hover:text-rose-600 transition-all"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                </div>
                            </Card>
                        </motion.div>
                    ))
                }
            </AnimatePresence>
        </div>
        <div className="mt-6 flex justify-center">
            <Pagination
                page={page}
                totalPages={Math.ceil(total / pageSize) || 1}
                total={total}
                pageSize={pageSize}
                onPageChange={(p) => fetchRiders(p)}
                onPageSizeChange={(newSize) => {
                    setPageSize(newSize);
                    setPage(1);
                }}
                loading={isLoading}
            />
        </div>

        {/* Profile Detail Modal */}
        <AnimatePresence>
            {viewingRider && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-slate-900/40 backdrop-blur-md"
                        onClick={() => setViewingRider(null)}
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 20 }}
                        className="w-full max-w-3xl relative z-10 bg-white rounded-3xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
                        data-lenis-prevent
                    >
                        <div className="p-6 sm:p-8 overflow-y-auto space-y-6">
                            {/* Header */}
                            <div className="flex justify-between items-start">
                                <div className="flex gap-5 items-center">
                                    <img 
                                       src={viewingRider.avatar && !viewingRider.avatar.includes('emoji') && !viewingRider.avatar.includes('avatar') ? viewingRider.avatar : "https://cdn-icons-png.flaticon.com/512/149/149071.png"} 
                                       alt="" 
                                       className="h-20 w-20 rounded-2xl bg-gray-100 ring-4 ring-slate-50 shadow-lg object-cover" 
                                    />
                                    <div>
                                        <h2 className="ds-h1 text-slate-900">{viewingRider.name}</h2>
                                        <div className="flex items-center gap-3 mt-1.5">
                                            <Badge variant={viewingRider.status === 'available' ? 'success' : viewingRider.status === 'busy' ? 'warning' : 'neutral'} className="uppercase font-black text-[9px] px-3">
                                                {viewingRider.status}
                                            </Badge>
                                            <span className="text-xs font-bold text-slate-400">Rider ID: {formatRiderId(viewingRider.id)}</span>
                                        </div>
                                    </div>
                                </div>
                                <button onClick={() => setViewingRider(null)} className="p-2.5 bg-slate-50 hover:bg-slate-100 rounded-2xl transition-all">
                                    <XCircle className="h-6 w-6 text-slate-400" />
                                </button>
                            </div>

                            {/* Section 1: Contact & Personal Info */}
                            <div className="bg-slate-50/70 p-5 rounded-2xl border border-slate-100 space-y-3">
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Contact & Personal Details</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Contact Number</p>
                                        <p className="text-xs font-bold text-slate-900">{viewingRider.phone}</p>
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Email Address</p>
                                        <p className="text-xs font-bold text-slate-900 truncate">{viewingRider.email}</p>
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Date of Birth</p>
                                        <p className="text-xs font-bold text-slate-900">{viewingRider.dob}</p>
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Blood Group</p>
                                        <p className="text-xs font-bold text-slate-900">{viewingRider.bloodGroup}</p>
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Partner Since</p>
                                        <p className="text-xs font-bold text-slate-900">{viewingRider.joinDate}</p>
                                    </div>
                                    <div className="space-y-0.5 sm:col-span-3">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Address</p>
                                        <p className="text-xs font-bold text-slate-900 leading-snug">{viewingRider.address}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Section 2: Vehicle & Driving License */}
                            <div className="bg-slate-50/70 p-5 rounded-2xl border border-slate-100 space-y-3">
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Vehicle & License Info</h4>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Vehicle Type</p>
                                        <p className="text-xs font-bold text-slate-900 capitalize">{viewingRider.vehicle}</p>
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Registration No.</p>
                                        <p className="text-xs font-bold text-slate-900 uppercase">{viewingRider.vehicleNum}</p>
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">DL Number</p>
                                        <p className="text-xs font-bold text-slate-900 uppercase">{viewingRider.drivingLicenseNumber}</p>
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Current Area</p>
                                        <p className="text-xs font-bold text-slate-900">{viewingRider.location}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Section 3: Bank Account Details */}
                            <div className="bg-slate-50/70 p-5 rounded-2xl border border-slate-100 space-y-3">
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Bank Account Details</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Account Holder</p>
                                        <p className="text-xs font-bold text-slate-900">{viewingRider.accountHolder}</p>
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Account Number</p>
                                        <p className="text-xs font-bold text-slate-900 font-mono">{viewingRider.accountNumber}</p>
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">IFSC Code</p>
                                        <p className="text-xs font-bold text-slate-900 font-mono uppercase">{viewingRider.ifsc}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Section 4: Submitted Documents */}
                            <div className="bg-slate-50/70 p-5 rounded-2xl border border-slate-100 space-y-3">
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Registration Documents</h4>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    {[
                                        { label: 'Aadhar Card', value: viewingRider.documents?.aadhar },
                                        { label: 'PAN Card', value: viewingRider.documents?.pan },
                                        { label: 'Driving License', value: viewingRider.documents?.drivingLicense },
                                    ].map((doc) => (
                                        <div key={doc.label} className="p-3 bg-white rounded-xl border border-slate-200/60 flex items-center justify-between">
                                            <div>
                                                <p className="text-xs font-bold text-slate-800">{doc.label}</p>
                                                <p className="text-[10px] font-semibold text-slate-400">
                                                    {doc.value ? 'Uploaded' : 'Not Provided'}
                                                </p>
                                            </div>
                                            {doc.value ? (
                                                <a
                                                    href={doc.value}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="px-2.5 py-1 bg-brand-50 text-brand-600 text-[10px] font-bold rounded-lg hover:bg-brand-100 transition-colors"
                                                >
                                                    View
                                                </a>
                                            ) : (
                                                <span className="px-2 py-0.5 bg-slate-100 text-slate-400 text-[9px] font-bold rounded-md">
                                                    N/A
                                                </span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Performance Overview */}
                            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 p-5 bg-slate-900 text-white rounded-2xl">
                                <div className="text-center">
                                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Lifetime Rating</p>
                                    <div className="flex justify-center items-center gap-1">
                                        <Star className="h-4 w-4 text-amber-400 fill-current" />
                                        <span className="text-base font-black">{viewingRider.rating || 0}</span>
                                    </div>
                                </div>
                                <div className="text-center border-l border-slate-800">
                                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Fleet Rank</p>
                                    <span className="text-base font-black">{viewingRider.rank ? `#${viewingRider.rank}` : '0'}</span>
                                </div>
                                <div className="text-center border-l border-slate-800">
                                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Total Deliveries</p>
                                    <span className="text-base font-black text-emerald-400">{viewingRider.totalOrders || 0}</span>
                                </div>
                                <div className="text-center border-l border-slate-800">
                                    <p className="text-[9px] font-black text-slate-400 uppercase mb-1">Wallet Creds</p>
                                    <span className="text-base font-black text-emerald-400">₹{(viewingRider.walletCreds || 0).toLocaleString()}</span>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="flex gap-4 pt-2">
                                <button
                                    onClick={() => setViewingRider(null)}
                                    className="flex-1 py-3.5 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl active:scale-95 transition-all"
                                >
                                    Close Details
                                </button>
                            </div>
                        </div>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>

        {/* Onboard / Edit Modal */}
        <AnimatePresence>
            {(isOnboardModalOpen || isEditModalOpen) && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-slate-900/60 backdrop-blur-lg"
                        onClick={() => {
                            setIsOnboardModalOpen(false);
                            setIsEditModalOpen(false);
                        }}
                    />
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: 30 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: 30 }}
                        className="w-full max-w-lg relative z-[120] bg-white rounded-2xl p-5 shadow-3xl"
                    >
                        <h3 className="ds-h2 mb-2">
                            {isEditModalOpen ? 'Edit Rider' : 'Add New Rider'}
                        </h3>
                        <p className="ds-label mt-1 text-slate-500">
                            {isEditModalOpen ? 'Update rider details below.' : 'Enter details to register a new delivery partner.'}
                        </p>

                        <form onSubmit={isEditModalOpen ? handleEditSubmit : handleOnboardSubmit} className="space-y-5">
                            <div className="grid grid-cols-1 gap-5">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Identity Name</label>
                                    <input
                                        required
                                        type="text"
                                        value={formState.name}
                                        onChange={(e) => setFormState({ ...formState, name: e.target.value })}
                                        className="w-full px-5 py-3.5 bg-slate-50 border-none rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-primary/10 transition-all"
                                        placeholder="e.g. Rahul Sharma"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Secure Contact</label>
                                        <input
                                            required
                                            type="text"
                                            value={formState.phone}
                                            onChange={(e) => setFormState({ ...formState, phone: e.target.value })}
                                            className="w-full px-5 py-3.5 bg-slate-50 border-none rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-primary/10 transition-all"
                                            placeholder="+91..."
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Work Vehicle</label>
                                        <select
                                            required
                                            value={formState.vehicle}
                                            onChange={(e) => setFormState({ ...formState, vehicle: e.target.value })}
                                            className="w-full px-5 py-3.5 bg-slate-50 border-none rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-primary/10 transition-all appearance-none"
                                        >
                                            <option value="">Select Vehicle</option>
                                            <option>Two Wheeler</option>
                                            <option>Electric Scooter</option>
                                            <option>Cycle</option>
                                            <option>Three Wheeler</option>
                                        </select>
                                    </div>
                                </div>
                                {formState.vehicle !== 'Cycle' && (
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Registration Vehicle No.</label>
                                        <input
                                            required
                                            type="text"
                                            value={formState.vehicleNum}
                                            onChange={(e) => setFormState({ ...formState, vehicleNum: e.target.value.toUpperCase() })}
                                            className="w-full px-5 py-3.5 bg-slate-50 border-none rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-primary/10 transition-all"
                                            placeholder="e.g. MH 12 AB 0000"
                                        />
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Assigned Operational Area</label>
                                    <input
                                        required
                                        type="text"
                                        value={formState.location}
                                        onChange={(e) => setFormState({ ...formState, location: e.target.value })}
                                        className="w-full px-5 py-3.5 bg-slate-50 border-none rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-primary/10 transition-all"
                                        placeholder="e.g. Bandra West, Mumbai"
                                    />
                                </div>
                            </div>

                            <button type="submit" className="w-full py-4.5 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-2xl hover:bg-slate-800 transition-all transform active:scale-[0.98] mt-4">
                                {isEditModalOpen ? 'SAVE CHANGES' : 'ADD RIDER'}
                            </button>
                        </form>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    </div>
);
};

export default ActiveDeliveryBoys;
