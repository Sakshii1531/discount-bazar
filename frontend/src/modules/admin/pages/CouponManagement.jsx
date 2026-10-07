import React, { useState, useMemo, useEffect } from 'react';
import Card from '@shared/components/ui/Card';
import Badge from '@shared/components/ui/Badge';
import Modal from '@shared/components/ui/Modal';
import { useToast } from '@shared/components/ui/Toast';
import {
    HiOutlinePlus,
    HiOutlineTicket,
    HiOutlineMagnifyingGlass,
    HiOutlineFunnel,
    HiOutlineTrash,
    HiOutlinePencilSquare,
    HiOutlineCalendarDays,
    HiOutlineUsers,
    HiOutlineBanknotes,
    HiOutlineClock,
    HiOutlineCheckCircle,
    HiOutlineXMark,
    HiOutlineEye
} from 'react-icons/hi2';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { adminApi } from '../services/adminApi';

// Each strategy has its own condition; the form only shows what that strategy needs.
export const COUPON_STRATEGIES = {
    generic: {
        label: 'Regular discount',
        help: 'Works on any order for every customer.',
    },
    min_order_value: {
        label: 'Minimum order value',
        help: 'Unlocks when the cart total reaches the amount you set.',
    },
    bulk_order: {
        label: 'Bulk order (number of items)',
        help: 'Unlocks when the cart has at least the number of items you set.',
    },
    category_based: {
        label: 'Category-based',
        help: 'Works only when the cart has products from the categories you pick.',
    },
    monthly_volume: {
        label: 'VIP – high monthly spenders',
        help: "Only for customers whose orders this month add up to the amount you set.",
    },
    free_delivery: {
        label: 'Free delivery',
        help: 'Removes the delivery fee. No discount amount is needed.',
    },
};

const EMPTY_FORM = {
    code: '',
    title: '',
    couponType: 'generic',
    discountType: 'percentage',
    discountValue: '',
    minOrderValue: '',
    maxDiscount: '',
    minItems: '',
    applicableCategories: [],
    monthlyVolumeThreshold: '',
    usageLimit: '',
    perUserLimit: '1',
    validFrom: '',
    validTill: '',
    description: '',
};

/** Plain-language summary of what the coupon will do. */
export const describeCoupon = (f, categoryNames = {}) => {
    const kind = f.couponType === 'free_delivery' ? 'free_delivery' : f.discountType;
    let what;
    if (kind === 'free_delivery') what = 'free delivery';
    else if (kind === 'percentage') what = `${f.discountValue || '?'}% off${f.maxDiscount ? ` (up to ₹${f.maxDiscount})` : ''}`;
    else what = `₹${f.discountValue || '?'} off`;
    const rules = [];
    if (f.couponType === 'bulk_order') rules.push(`the cart has ${f.minItems || '?'}+ items`);
    if (f.couponType === 'category_based') {
        const names = (f.applicableCategories || []).map((id) => categoryNames[id]).filter(Boolean);
        rules.push(`the cart has products from ${names.length ? names.join(', ') : '?'}`);
    }
    if (f.couponType === 'monthly_volume') rules.push(`the customer has spent ₹${f.monthlyVolumeThreshold || '?'}+ this month`);
    if (f.couponType === 'min_order_value' || Number(f.minOrderValue) > 0) rules.push(`the cart total is ₹${f.minOrderValue || '?'} or more`);
    return `Customers get ${what}${rules.length ? ` when ${rules.join(' and ')}` : ' on any order'}.`;
};

const CouponManagement = () => {
    const { showToast } = useToast();
    const today = new Date().toISOString().split('T')[0];
    const getTomorrow = (dateStr) => {
        const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
        d.setDate(d.getDate() + 1);
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    const [editingCoupon, setEditingCoupon] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [isLoading, setIsLoading] = useState(false);

    const [coupons, setCoupons] = useState([]);

    const [formData, setFormData] = useState(EMPTY_FORM);
    const [mainCategories, setMainCategories] = useState([]);

    // Category-based coupons match the cart's main (header) categories.
    useEffect(() => {
        adminApi
            .getCategoryTree()
            .then((res) => {
                const tree = res.data?.results || res.data?.result || [];
                setMainCategories(Array.isArray(tree) ? tree.map((h) => ({ _id: h._id, name: h.name })) : []);
            })
            .catch(() => setMainCategories([]));
    }, []);
    const categoryNames = useMemo(
        () => Object.fromEntries(mainCategories.map((c) => [String(c._id), c.name])),
        [mainCategories]
    );

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchCoupons();
        }, 500);
        return () => clearTimeout(timer);
    }, [statusFilter, searchTerm]);

    const fetchCoupons = async () => {
        try {
            setIsLoading(true);
            const res = await adminApi.getCoupons({
                status: statusFilter === 'all' ? undefined : statusFilter,
                search: searchTerm.trim() || undefined,
            });
            if (res.data.success) {
                const list = res.data.result || res.data.results || [];
                setCoupons(list);
            }
        } catch (error) {
            showToast('Failed to load coupons', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const stats = useMemo(() => {
        const now = new Date();
        const active = coupons.filter(c => {
            const from = c.validFrom ? new Date(c.validFrom) : null;
            const till = c.validTill ? new Date(c.validTill) : null;
            if (till) till.setHours(23, 59, 59, 999);
            return c.isActive && (!from || from <= now) && (!till || till >= now);
        });
        const expiringSoon = coupons.filter(c => {
            if (!c.validTill) return false;
            const till = new Date(c.validTill);
            const diffDays = (till - now) / (1000 * 60 * 60 * 24);
            return diffDays >= 0 && diffDays <= 7;
        });
        return {
            total: coupons.length,
            active: active.length,
            totalRedeemed: coupons.reduce((acc, c) => acc + (c.usedCount || 0), 0),
            expiringSoon: expiringSoon.length,
        };
    }, [coupons]);

    const filteredCoupons = coupons;

    const handleOpenModal = (coupon = null) => {
        if (coupon) {
            setEditingCoupon(coupon);
            setFormData({
                ...EMPTY_FORM,
                code: coupon.code || '',
                title: coupon.title || '',
                couponType: coupon.couponType || 'generic',
                discountType: coupon.discountType || 'percentage',
                discountValue: coupon.discountType === 'free_delivery' ? '' : coupon.discountValue ?? '',
                minOrderValue: coupon.minOrderValue ? String(coupon.minOrderValue) : '',
                maxDiscount: coupon.maxDiscount ?? '',
                minItems: coupon.minItems ? String(coupon.minItems) : '',
                applicableCategories: (coupon.applicableCategories || []).map((c) => String(c?._id ?? c)),
                monthlyVolumeThreshold: coupon.monthlyVolumeThreshold ?? '',
                usageLimit: coupon.usageLimit ?? '',
                perUserLimit: coupon.perUserLimit ?? '',
                validFrom: coupon.validFrom ? coupon.validFrom.substring(0, 10) : '',
                validTill: coupon.validTill ? coupon.validTill.substring(0, 10) : '',
                description: coupon.description || '',
            });
        } else {
            setEditingCoupon(null);
            setFormData(EMPTY_FORM);
        }
        setIsModalOpen(true);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        const f = formData;
        const kind = f.couponType === 'free_delivery' ? 'free_delivery' : f.discountType;
        const problem =
            (kind === 'percentage' && !(Number(f.discountValue) > 0 && Number(f.discountValue) <= 100) && 'Percentage discount must be between 1 and 100') ||
            (kind === 'fixed' && !(Number(f.discountValue) > 0) && 'Enter the discount amount in ₹') ||
            (f.couponType === 'min_order_value' && !(Number(f.minOrderValue) > 0) && 'Enter the minimum cart total') ||
            (f.couponType === 'bulk_order' && !(Number.isInteger(Number(f.minItems)) && Number(f.minItems) >= 2) && 'Enter the minimum number of items (2 or more)') ||
            (f.couponType === 'category_based' && f.applicableCategories.length === 0 && 'Select at least one category') ||
            (f.couponType === 'monthly_volume' && !(Number(f.monthlyVolumeThreshold) > 0) && 'Enter the monthly spend customers must reach') ||
            (f.validTill && f.validTill < getTomorrow(f.validFrom) && 'End date must be after start date');
        if (problem) {
            showToast(problem, 'error');
            return;
        }
        try {
            // Only the fields that apply to this strategy and discount kind are sent.
            const payload = {
                code: f.code,
                title: f.title,
                description: f.description,
                couponType: f.couponType,
                discountType: kind,
                discountValue: kind === 'free_delivery' ? 0 : Number(f.discountValue),
                maxDiscount: kind === 'percentage' && f.maxDiscount ? Number(f.maxDiscount) : null,
                minOrderValue: f.minOrderValue ? Number(f.minOrderValue) : 0,
                minItems: f.couponType === 'bulk_order' ? Number(f.minItems) : 0,
                applicableCategories: f.couponType === 'category_based' ? f.applicableCategories : [],
                monthlyVolumeThreshold: f.couponType === 'monthly_volume' ? Number(f.monthlyVolumeThreshold) : null,
                usageLimit: f.usageLimit ? Number(f.usageLimit) : null,
                perUserLimit: f.perUserLimit ? Number(f.perUserLimit) : null,
                validFrom: f.validFrom,
                validTill: f.validTill ? (f.validTill.length === 10 ? `${f.validTill}T23:59:59.999Z` : f.validTill) : '',
            };

            if (editingCoupon?._id) {
                await adminApi.updateCoupon(editingCoupon._id, payload);
                showToast('Coupon updated successfully', 'success');
            } else {
                await adminApi.createCoupon(payload);
                showToast('New coupon launched!', 'success');
            }
            setIsModalOpen(false);
            setEditingCoupon(null);
            const res = await adminApi.getCoupons();
            if (res.data.success) {
                const list = res.data.result || res.data.results || [];
                setCoupons(list);
            }
        } catch (error) {
            showToast(error.response?.data?.message || 'Failed to save coupon', 'error');
        }
    };

    const handleDelete = async (id) => {
        try {
            await adminApi.deleteCoupon(id);
            setCoupons(coupons.filter(c => c._id !== id));
            setDeleteTarget(null);
            showToast('Coupon removed', 'warning');
        } catch (error) {
            showToast('Failed to delete coupon', 'error');
        }
    };

    return (
        <div className="ds-section-spacing animate-in fade-in slide-in-from-bottom-4 duration-700 pb-12">
            {/* Header Area */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 px-1">
                <div>
                    <h1 className="ds-h1 flex items-center gap-3">
                        Promo Engine
                        <Badge variant="primary" className="text-[10px] font-black uppercase tracking-widest">v4.2 PRO</Badge>
                    </h1>
                    <p className="ds-description mt-1">Design, deploy, and track high-conversion discount campaigns.</p>
                </div>
                <button
                    onClick={() => handleOpenModal()}
                    className="flex items-center gap-2 px-6 py-3.5 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-[0.2em] shadow-xl hover:scale-[1.02] active:scale-95 transition-all"
                >
                    <HiOutlinePlus className="h-5 w-5" />
                    CREATE NEW PROMO
                </button>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {[
                    { label: 'Total Coupons', value: stats.total, icon: HiOutlineTicket, color: 'indigo' },
                    { label: 'Active Codes', value: stats.active, icon: HiOutlineCheckCircle, color: 'emerald' },
                    { label: 'Redemptions', value: stats.totalRedeemed.toLocaleString(), icon: HiOutlineUsers, color: 'amber' },
                    { label: 'Expiring Soon', value: stats.expiringSoon, icon: HiOutlineClock, color: 'rose' },
                ].map((s, i) => (
                    <Card key={i} className="p-6 border-none shadow-xl ring-1 ring-slate-100 bg-white group hover:ring-primary/20 transition-all">
                        <div className="flex items-center justify-between mb-4">
                            <div className={cn("p-2.5 rounded-2xl",
                                s.color === 'indigo' && "bg-brand-50 text-brand-600",
                                s.color === 'emerald' && "bg-brand-50 text-brand-600",
                                s.color === 'amber' && "bg-amber-50 text-amber-600",
                                s.color === 'rose' && "bg-rose-50 text-rose-600",
                            )}>
                                <s.icon className="h-6 w-6" />
                            </div>
                        </div>
                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">{s.label}</h4>
                        <h3 className="text-2xl font-black text-slate-900">{s.value}</h3>
                    </Card>
                ))}
            </div>

            {/* Main Content Area */}
            <Card className="border-none shadow-xl ring-1 ring-slate-100 bg-white rounded-xl overflow-hidden">
                {/* Table Filters */}
                <div className="p-4 border-b border-slate-50 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="flex items-center gap-4 flex-1">
                        <div className="relative group flex-1 max-w-md">
                            <HiOutlineMagnifyingGlass className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
                            <input
                                type="text"
                                placeholder="Search by code or description..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border-none rounded-2xl text-xs font-bold outline-none ring-1 ring-transparent focus:ring-primary/10 transition-all"
                            />
                        </div>
                        <div className="flex bg-slate-100 p-1.5 rounded-2xl">
                            {['all', 'active', 'expired'].map((filter) => (
                                <button
                                    key={filter}
                                    onClick={() => setStatusFilter(filter)}
                                    className={cn(
                                        "px-5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                                        statusFilter === filter ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                                    )}
                                >
                                    {filter}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Coupons Table */}
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="bg-slate-50/50 border-b border-slate-50">
                                <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Coupon Code</th>
                                <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Offerings</th>
                                <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Performance</th>
                                <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest">Validity</th>
                                <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Status</th>
                                <th className="px-4 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {isLoading && (
                                <tr>
                                    <td colSpan="6" className="text-center py-8 text-slate-400 text-sm">
                                        Loading coupons...
                                    </td>
                                </tr>
                            )}
                            {!isLoading && filteredCoupons.map((c) => (
                                <tr key={c._id} className="group hover:bg-slate-50/30 transition-colors">
                                    <td className="px-4 py-6">
                                        <div className="flex items-center gap-4">
                                            <div className="h-12 w-12 rounded-2xl bg-brand-50 text-brand-600 flex items-center justify-center">
                                                <HiOutlineTicket className="h-6 w-6" />
                                            </div>
                                            <div>
                                                <span className="text-sm font-black text-slate-900 tracking-wider bg-slate-100 px-2 py-1 rounded-lg border-2 border-dashed border-slate-300">{c.code}</span>
                                                <p className="text-[10px] font-bold text-slate-400 mt-1">{c.title}</p>
                                                <p className="text-[10px] font-medium text-slate-400 mt-0.5 line-clamp-2">{c.description}</p>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-6">
                                        <div className="space-y-1">
                                            <p className="text-xs font-black text-slate-900">
                                                {c.discountType === 'percentage' ? `${c.discountValue}% OFF` : c.discountType === 'free_delivery' ? 'Free Delivery' : `₹${c.discountValue} OFF`}
                                            </p>
                                            {c.minOrderValue > 0 && (
                                                <p className="text-[10px] font-bold text-slate-400">Min. Order: ₹{c.minOrderValue}</p>
                                            )}
                                            <p className="text-[10px] font-bold text-slate-400">{COUPON_STRATEGIES[c.couponType]?.label || 'Regular discount'}</p>
                                            <p className="text-[10px] font-semibold text-slate-500 max-w-[260px]" data-testid="coupon-rule">{describeCoupon({ ...c, applicableCategories: (c.applicableCategories || []).map((x) => String(x?._id ?? x)) }, categoryNames)}</p>
                                        </div>
                                    </td>
                                    <td className="px-4 py-6">
                                        <div className="space-y-2">
                                            <div className="flex justify-between items-end">
                                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Redeemed</span>
                                                <span className="text-xs font-black text-slate-900">{c.usedCount || 0}{c.usageLimit ? `/${c.usageLimit}` : ''}</span>
                                            </div>
                                            <div className="h-1.5 w-32 bg-slate-100 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-brand-500 rounded-full transition-all duration-1000"
                                                    style={{ width: c.usageLimit ? `${((c.usedCount || 0) / c.usageLimit) * 100}%` : '0%' }}
                                                />
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-4 py-6">
                                        <div className="flex items-center gap-2 text-slate-500">
                                            <HiOutlineCalendarDays className="h-4 w-4" />
                                            <span className="text-[10px] font-bold uppercase tracking-tighter">
                                                {c.validFrom ? new Date(c.validFrom).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'} - {c.validTill ? new Date(c.validTill).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-6 text-center">
                                        {(() => {
                                            const now = new Date();
                                            const till = c.validTill ? new Date(c.validTill) : null;
                                            if (till) till.setHours(23, 59, 59, 999);
                                            const from = c.validFrom ? new Date(c.validFrom) : null;
                                            
                                            let status = 'inactive';
                                            let variant = 'gray';
                                            
                                            if (!c.isActive) {
                                                status = 'inactive';
                                                variant = 'gray';
                                            } else if (till && till < now) {
                                                status = 'expired';
                                                variant = 'error';
                                            } else if (from && from > now) {
                                                status = 'scheduled';
                                                variant = 'warning';
                                            } else if (c.usageLimit && (c.usedCount || 0) >= c.usageLimit) {
                                                status = 'exhausted';
                                                variant = 'gray';
                                            } else {
                                                status = 'active';
                                                variant = 'success';
                                            }
                                            
                                            return (
                                                <Badge variant={variant} className="text-[9px] font-black uppercase">
                                                    {status}
                                                </Badge>
                                            );
                                        })()}
                                    </td>
                                    <td className="px-4 py-6">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => handleOpenModal(c)}
                                                className="p-2 text-slate-400 hover:text-primary hover:bg-primary/5 rounded-xl transition-all"
                                            >
                                                <HiOutlinePencilSquare className="h-5 w-5" />
                                            </button>
                                            <button
                                                onClick={() => setDeleteTarget(c)}
                                                className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-xl transition-all"
                                            >
                                                <HiOutlineTrash className="h-5 w-5" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {filteredCoupons.length === 0 && (
                    <div className="p-20 text-center">
                        <div className="h-20 w-20 bg-slate-50 rounded-xl flex items-center justify-center mx-auto mb-6">
                            <HiOutlineTicket className="h-10 w-10 text-slate-200" />
                        </div>
                        <h3 className="text-lg font-black text-slate-900">No codes found</h3>
                        <p className="text-sm font-bold text-slate-400 mt-2">Try adjusting your filters or create a new promotion.</p>
                    </div>
                )}
            </Card>

            {/* Delete confirmation dialog */}
            <AnimatePresence>
                {deleteTarget && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden"
                        >
                            <div className="p-6 text-center">
                                <div className="w-12 h-12 rounded-full bg-rose-100 text-rose-600 flex items-center justify-center mx-auto mb-4">
                                    <HiOutlineTrash className="w-6 h-6" />
                                </div>
                                <h3 className="text-lg font-bold text-slate-900 mb-2">Delete coupon?</h3>
                                <p className="text-slate-500 text-sm mb-6">
                                    Are you sure you want to remove{' '}
                                    <span className="font-semibold text-slate-900">{deleteTarget.code}</span>? This action cannot be undone.
                                </p>
                                <div className="flex gap-3 justify-center">
                                    <button
                                        onClick={() => setDeleteTarget(null)}
                                        className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl font-medium transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => handleDelete(deleteTarget._id)}
                                        className="px-4 py-2.5 bg-rose-600 text-white rounded-xl font-medium hover:bg-rose-700 transition-colors"
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {/* Modal for Create/Edit */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title={editingCoupon ? "Modify Promotion" : "New Promotion Protocol"}
            >
                <form onSubmit={handleSubmit} className="space-y-6">
                    {(() => {
                        const labelCls = 'text-[10px] font-black text-slate-400 uppercase tracking-widest';
                        const inputCls = 'w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-xs font-black outline-none ring-1 ring-transparent focus:ring-primary/20';
                        const noBadKeys = (e) => { if (['-', 'e', 'E', '+'].includes(e.key)) e.preventDefault(); };
                        const set = (patch) => setFormData((prev) => ({ ...prev, ...patch }));
                        const strategy = formData.couponType;
                        const kind = strategy === 'free_delivery' ? 'free_delivery' : formData.discountType;
                        const numberInput = (key, props = {}) => (
                            <input
                                type="number"
                                min={0}
                                onWheel={(e) => e.target.blur()}
                                onKeyDown={noBadKeys}
                                value={formData[key]}
                                onChange={(e) => set({ [key]: e.target.value })}
                                className={inputCls}
                                {...props}
                            />
                        );
                        return (
                            <>
                                {/* 1. Code + strategy */}
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className={labelCls}>Promo Code *</label>
                                        <input
                                            required
                                            value={formData.code}
                                            onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/\s/g, '') })}
                                            placeholder="E.G. SUMMER50"
                                            className={cn(inputCls, 'uppercase tracking-widest')}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <label className={labelCls}>Coupon Type *</label>
                                        <select
                                            aria-label="Coupon type"
                                            value={strategy}
                                            onChange={(e) => {
                                                const next = e.target.value;
                                                set({
                                                    couponType: next,
                                                    // Leaving "Free delivery" goes back to a normal discount.
                                                    discountType: next === 'free_delivery' ? 'free_delivery' : formData.discountType === 'free_delivery' ? 'percentage' : formData.discountType,
                                                });
                                            }}
                                            className={inputCls}
                                        >
                                            {Object.entries(COUPON_STRATEGIES).map(([value, s]) => (
                                                <option key={value} value={value}>{s.label}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <p className="-mt-3 text-[11px] font-semibold text-slate-500" data-testid="coupon-strategy-help">
                                    {COUPON_STRATEGIES[strategy]?.help}
                                </p>

                                {/* 2. The condition this strategy needs */}
                                {strategy !== 'generic' && strategy !== 'free_delivery' && (
                                    <div className="space-y-3 rounded-2xl border border-slate-100 p-4" data-testid="coupon-condition">
                                        <p className={labelCls}>When does it apply?</p>
                                        {strategy === 'min_order_value' && (
                                            <div className="space-y-2">
                                                <label className={labelCls}>Minimum cart total (₹) *</label>
                                                {numberInput('minOrderValue', { required: true, placeholder: 'e.g. 499', 'aria-label': 'Minimum cart total' })}
                                            </div>
                                        )}
                                        {strategy === 'bulk_order' && (
                                            <div className="space-y-2">
                                                <label className={labelCls}>Minimum number of items in cart *</label>
                                                {numberInput('minItems', { required: true, min: 2, step: 1, placeholder: 'e.g. 10', 'aria-label': 'Minimum items' })}
                                            </div>
                                        )}
                                        {strategy === 'category_based' && (
                                            <div className="space-y-2">
                                                <label className={labelCls}>Categories *</label>
                                                <div className="flex flex-wrap gap-2" data-testid="coupon-categories">
                                                    {mainCategories.length === 0 && <p className="text-xs text-slate-400">No categories found.</p>}
                                                    {mainCategories.map((c) => {
                                                        const id = String(c._id);
                                                        const on = formData.applicableCategories.includes(id);
                                                        return (
                                                            <button
                                                                type="button"
                                                                key={id}
                                                                aria-pressed={on}
                                                                onClick={() => set({
                                                                    applicableCategories: on
                                                                        ? formData.applicableCategories.filter((x) => x !== id)
                                                                        : [...formData.applicableCategories, id],
                                                                })}
                                                                className={cn(
                                                                    'px-3 py-1.5 rounded-xl text-xs font-bold border transition-all',
                                                                    on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                                                )}
                                                            >
                                                                {c.name}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        {strategy === 'monthly_volume' && (
                                            <div className="space-y-2">
                                                <label className={labelCls}>Customer's spend this month at least (₹) *</label>
                                                {numberInput('monthlyVolumeThreshold', { required: true, placeholder: 'e.g. 5000', 'aria-label': 'Monthly spend' })}
                                            </div>
                                        )}
                                        {strategy !== 'min_order_value' && (
                                            <div className="space-y-2">
                                                <label className={labelCls}>Minimum cart total (₹, optional)</label>
                                                {numberInput('minOrderValue', { placeholder: 'No minimum', 'aria-label': 'Minimum cart total' })}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* 3. The discount itself */}
                                <div className="space-y-3 rounded-2xl border border-slate-100 p-4" data-testid="coupon-discount">
                                    <p className={labelCls}>What does the customer get?</p>
                                    {strategy === 'free_delivery' ? (
                                        <p className="text-xs font-bold text-emerald-700">The delivery fee becomes ₹0 for the order.</p>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-6">
                                            <div className="space-y-2">
                                                <label className={labelCls}>Discount Kind *</label>
                                                <select
                                                    aria-label="Discount kind"
                                                    value={kind}
                                                    onChange={(e) => set({ discountType: e.target.value, maxDiscount: e.target.value === 'percentage' ? formData.maxDiscount : '' })}
                                                    className={inputCls}
                                                >
                                                    <option value="percentage">Percentage off (%)</option>
                                                    <option value="fixed">Flat amount off (₹)</option>
                                                    <option value="free_delivery">Free delivery</option>
                                                </select>
                                            </div>
                                            {kind === 'percentage' && (
                                                <div className="space-y-2">
                                                    <label className={labelCls}>Discount (%) *</label>
                                                    {numberInput('discountValue', { required: true, min: 1, max: 100, placeholder: 'e.g. 10', 'aria-label': 'Discount value' })}
                                                </div>
                                            )}
                                            {kind === 'fixed' && (
                                                <div className="space-y-2">
                                                    <label className={labelCls}>Discount amount (₹) *</label>
                                                    {numberInput('discountValue', { required: true, min: 1, placeholder: 'e.g. 50', 'aria-label': 'Discount value' })}
                                                </div>
                                            )}
                                            {kind === 'free_delivery' && (
                                                <p className="self-end pb-3 text-xs font-bold text-emerald-700">Delivery fee becomes ₹0.</p>
                                            )}
                                            {kind === 'percentage' && (
                                                <div className="space-y-2">
                                                    <label className={labelCls}>Max discount (₹, optional)</label>
                                                    {numberInput('maxDiscount', { placeholder: 'No cap', 'aria-label': 'Max discount' })}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {(strategy === 'generic' || strategy === 'free_delivery') && (
                                        <div className="space-y-2">
                                            <label className={labelCls}>Minimum cart total (₹, optional)</label>
                                            {numberInput('minOrderValue', { placeholder: 'No minimum', 'aria-label': 'Minimum cart total' })}
                                        </div>
                                    )}
                                </div>

                                {/* 4. Limits */}
                                <div className="grid grid-cols-2 gap-6">
                                    <div className="space-y-2">
                                        <label className={labelCls}>Total uses (optional)</label>
                                        {numberInput('usageLimit', { min: 1, step: 1, placeholder: 'Unlimited' })}
                                    </div>
                                    <div className="space-y-2">
                                        <label className={labelCls}>Uses per customer</label>
                                        {numberInput('perUserLimit', { min: 1, step: 1, placeholder: 'Unlimited' })}
                                    </div>
                                </div>

                                <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-xs font-bold text-emerald-800" data-testid="coupon-summary">
                                    {describeCoupon(formData, categoryNames)}
                                </p>
                            </>
                        );
                    })()}

                    <div className="grid grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Start Date</label>
                            <input
                                required
                                type="date"
                                // Running campaigns keep their past start date when edited.
                                min={editingCoupon?._id ? undefined : today}
                                value={formData.validFrom}
                                onChange={(e) => {
                                    const newFrom = e.target.value;
                                    const minEnd = getTomorrow(newFrom);
                                    setFormData((prev) => ({
                                        ...prev,
                                        validFrom: newFrom,
                                        validTill: prev.validTill && prev.validTill < minEnd ? '' : prev.validTill,
                                    }));
                                }}
                                className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-xs font-black outline-none"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">End Date</label>
                            <input
                                required
                                type="date"
                                min={getTomorrow(formData.validFrom)}
                                value={formData.validTill}
                                onChange={(e) => setFormData({ ...formData, validTill: e.target.value })}
                                className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-xs font-black outline-none"
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Campaign Description</label>
                        <textarea
                            rows={3}
                            value={formData.description}
                            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                            placeholder="Briefly describe the campaign..."
                            className="w-full px-4 py-3 bg-slate-50 border-none rounded-2xl text-xs font-black outline-none resize-none"
                        />
                    </div>

                    <div className="flex gap-4 pt-4">
                        <button
                            type="button"
                            onClick={() => setIsModalOpen(false)}
                            className="flex-1 py-4 bg-slate-100 text-slate-400 rounded-2xl text-[10px] font-black uppercase tracking-widest"
                        >
                            CANCEL
                        </button>
                        <button
                            type="submit"
                            className="flex-1 py-4 bg-primary text-primary-foreground rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-primary/20"
                        >
                            {editingCoupon ? 'SAVE CHANGES' : 'LAUNCH CAMPAIGN'}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default CouponManagement;
