import React, { useState, useEffect } from 'react';
import Card from '@shared/components/ui/Card';
import Badge from '@shared/components/ui/Badge';
import Pagination from '@shared/components/ui/Pagination';
import { adminApi } from '../services/adminApi';
import {
    HiOutlineStar,
    HiOutlineTrash,
    HiOutlineShieldCheck,
    HiOutlineExclamationTriangle,
    HiOutlineChatBubbleBottomCenterText,
    HiOutlineMagnifyingGlass,
    HiOutlineBuildingStorefront,
    HiOutlineEyeSlash,
    HiOutlineArrowPath
} from 'react-icons/hi2';
import { useToast } from '@shared/components/ui/Toast';
import Modal from '@shared/components/ui/Modal';
import { cn } from '@/lib/utils';
import { Loader2, ShieldCheck } from 'lucide-react';

const ReviewModeration = () => {
    const { showToast } = useToast();
    const [statusFilter, setStatusFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [reviews, setReviews] = useState([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);

    const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
    const [selectedReview, setSelectedReview] = useState(null);
    const [targetStatus, setTargetStatus] = useState('');
    const [moderationReason, setModerationReason] = useState('');
    const [actionLoading, setActionLoading] = useState(false);

    useEffect(() => {
        fetchReviews(1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageSize, statusFilter]);

    const fetchReviews = async (requestedPage = 1) => {
        try {
            setLoading(true);
            const params = { page: requestedPage, limit: pageSize };
            if (statusFilter) params.status = statusFilter;
            if (searchQuery.trim()) params.search = searchQuery.trim();

            const res = await adminApi.getAdminProductRatings(params);
            if (res.data.success) {
                const payload = res.data.result || {};
                const data = Array.isArray(payload.items) ? payload.items : [];
                setReviews(data);
                setTotal(typeof payload.total === 'number' ? payload.total : data.length);
                setPage(typeof payload.page === 'number' ? payload.page : requestedPage);
            }
        } catch (error) {
            console.error("Fetch Reviews Error:", error);
            showToast("Failed to load product ratings", "error");
        } finally {
            setLoading(false);
        }
    };

    const openModerationModal = (review, newStatus) => {
        setSelectedReview(review);
        setTargetStatus(newStatus);
        setModerationReason('');
        setIsAuditModalOpen(true);
    };

    const handleStatusUpdate = async () => {
        if (!selectedReview || !targetStatus) return;

        try {
            setActionLoading(true);
            const res = await adminApi.updateProductRatingStatus(selectedReview.id, {
                status: targetStatus,
                moderationReason: moderationReason.trim()
            });

            if (res.data.success) {
                showToast(`Rating status updated to ${targetStatus}`, 'success');
                setIsAuditModalOpen(false);
                fetchReviews(page);
            }
        } catch (error) {
            showToast(error.response?.data?.message || "Failed to update rating status", "error");
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="ds-section-spacing animate-in fade-in slide-in-from-bottom-4 duration-700 pb-12">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 px-1 mb-6">
                <div>
                    <h1 className="ds-h1">Product Ratings & Reviews Moderation</h1>
                    <p className="ds-description mt-0.5">Protect community integrity and product quality standards.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {/* Status Filter Tabs */}
                    <div className="flex bg-slate-100 p-1 rounded-xl">
                        {[
                            { label: "ALL", value: "" },
                            { label: "ACTIVE", value: "ACTIVE" },
                            { label: "FLAGGED", value: "FLAGGED" },
                            { label: "HIDDEN", value: "HIDDEN" },
                            { label: "REMOVED", value: "REMOVED" },
                        ].map((tab) => (
                            <button
                                key={tab.value}
                                onClick={() => {
                                    setStatusFilter(tab.value);
                                    setPage(1);
                                }}
                                className={cn(
                                    "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all",
                                    statusFilter === tab.value
                                        ? "bg-white text-slate-900 shadow-sm"
                                        : "text-slate-500 hover:text-slate-800"
                                )}
                            >
                                {tab.label}
                            </button>
                        ))}
                    </div>

                    {/* Search */}
                    <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm">
                        <HiOutlineMagnifyingGlass className="text-slate-400 h-4 w-4" />
                        <input
                            type="text"
                            placeholder="Search reviews..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && fetchReviews(1)}
                            className="text-xs font-bold bg-transparent outline-none w-36"
                        />
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center p-20">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : reviews.length === 0 ? (
                <div className="p-16 text-center rounded-3xl bg-white border border-slate-100 shadow-sm">
                    <p className="text-slate-400 font-black uppercase text-sm">No product ratings found.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 gap-6">
                    {reviews.map((r) => (
                        <Card key={r.id} className="p-5 border-none shadow-xl ring-1 ring-slate-100 bg-white rounded-2xl group overflow-hidden relative">
                            <HiOutlineChatBubbleBottomCenterText className="absolute -top-6 -right-6 h-32 w-32 text-slate-50 opacity-[0.03] group-hover:scale-110 transition-transform duration-1000" />

                            <div className="flex flex-col lg:flex-row gap-6 relative z-10">
                                {/* Customer & Product Info */}
                                <div className="lg:w-64 shrink-0 space-y-3">
                                    <div className="flex items-center gap-3">
                                        <div className="h-10 w-10 rounded-2xl bg-emerald-50 text-emerald-700 font-black text-sm flex items-center justify-center border border-emerald-100 shrink-0">
                                            {r.customer?.[0] || "C"}
                                        </div>
                                        <div className="min-w-0">
                                            <h4 className="text-xs font-black text-slate-900 truncate">{r.customer}</h4>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{r.customerPhone || r.customerEmail}</p>
                                        </div>
                                    </div>

                                    {/* Star Rating */}
                                    <div className="flex items-center gap-1">
                                        {[...Array(5)].map((_, i) => (
                                            <HiOutlineStar
                                                key={i}
                                                className={cn("h-4 w-4", i < r.rating ? "text-amber-400 fill-amber-400" : "text-slate-200")}
                                            />
                                        ))}
                                        <span className="text-xs font-black text-slate-700 ml-1">{r.rating}/5</span>
                                    </div>

                                    <div className="space-y-1">
                                        <p className="text-[10px] font-black text-primary uppercase tracking-tighter truncate">Product: {r.productName}</p>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Order #{r.orderId}</p>
                                        <p className="text-[10px] text-slate-400 font-bold">{new Date(r.createdAt).toLocaleString()}</p>
                                    </div>
                                </div>

                                {/* Rating Content & Status */}
                                <div className="flex-1 space-y-3">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className={cn(
                                            "text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full border",
                                            r.status === 'ACTIVE' ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                            r.status === 'FLAGGED' ? "bg-amber-50 text-amber-700 border-amber-200" :
                                            r.status === 'HIDDEN' ? "bg-slate-100 text-slate-600 border-slate-200" :
                                            "bg-rose-50 text-rose-700 border-rose-200"
                                        )}>
                                            Status: {r.status}
                                        </span>

                                        {r.isVerifiedPurchase && (
                                            <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 uppercase">
                                                <ShieldCheck size={10} /> Verified Purchase
                                            </span>
                                        )}

                                        {(r.feedbackTags || []).map((tag, idx) => (
                                            <Badge key={idx} variant="secondary" className="text-[9px] font-bold text-slate-500 bg-slate-50 border-none px-2">
                                                {tag.replace(/_/g, " ")}
                                            </Badge>
                                        ))}
                                    </div>

                                    {r.comment ? (
                                        <blockquote className="text-xs font-medium text-slate-700 leading-relaxed bg-slate-50/60 p-4 rounded-2xl border-l-4 border-slate-300">
                                            "{r.comment}"
                                        </blockquote>
                                    ) : (
                                        <p className="text-xs text-slate-400 italic">No written comment provided.</p>
                                    )}

                                    {r.moderationReason && (
                                        <p className="text-[10px] font-bold text-rose-600 bg-rose-50 p-2 rounded-xl border border-rose-100">
                                            Moderation Note: {r.moderationReason}
                                        </p>
                                    )}
                                </div>

                                {/* Actions */}
                                <div className="lg:w-44 flex lg:flex-col items-center justify-center gap-2">
                                    {r.status !== 'ACTIVE' && (
                                        <button
                                            onClick={() => openModerationModal(r, 'ACTIVE')}
                                            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-1.5"
                                        >
                                            <HiOutlineShieldCheck className="h-4 w-4" />
                                            Set Active
                                        </button>
                                    )}
                                    {r.status !== 'HIDDEN' && (
                                        <button
                                            onClick={() => openModerationModal(r, 'HIDDEN')}
                                            className="w-full py-2.5 bg-slate-700 hover:bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-1.5"
                                        >
                                            <HiOutlineEyeSlash className="h-4 w-4" />
                                            Hide Review
                                        </button>
                                    )}
                                    {r.status !== 'REMOVED' && (
                                        <button
                                            onClick={() => openModerationModal(r, 'REMOVED')}
                                            className="w-full py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shadow-sm flex items-center justify-center gap-1.5"
                                        >
                                            <HiOutlineTrash className="h-4 w-4" />
                                            Remove
                                        </button>
                                    )}
                                </div>
                            </div>
                        </Card>
                    ))}
                </div>
            )}

            <div className="mt-6 flex justify-center">
                <Pagination
                    page={page}
                    totalPages={Math.ceil(total / pageSize) || 1}
                    total={total}
                    pageSize={pageSize}
                    onPageChange={(p) => fetchReviews(p)}
                    onPageSizeChange={(newSize) => {
                        setPageSize(newSize);
                        setPage(1);
                    }}
                    loading={loading}
                />
            </div>

            {/* Moderation Reason Audit Modal */}
            <Modal
                isOpen={isAuditModalOpen}
                onClose={() => setIsAuditModalOpen(false)}
                title={`Moderate Rating to ${targetStatus}`}
            >
                <div className="space-y-4 max-w-sm mx-auto">
                    <p className="text-xs text-slate-500 font-medium">
                        Changing status will automatically recalculate the product rating aggregate.
                    </p>
                    <textarea
                        value={moderationReason}
                        onChange={(e) => setModerationReason(e.target.value)}
                        placeholder="Reason for moderation (optional)..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-2xl p-3 text-xs font-bold min-h-[90px] outline-none focus:border-slate-900 transition-all"
                    />
                    <div className="flex gap-3">
                        <button
                            onClick={() => setIsAuditModalOpen(false)}
                            className="flex-1 py-3 bg-slate-100 text-slate-600 text-[10px] font-black uppercase rounded-xl"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleStatusUpdate}
                            disabled={actionLoading}
                            className="flex-1 py-3 bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-black uppercase rounded-xl shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {actionLoading ? <Loader2 size={14} className="animate-spin" /> : 'Confirm Status Change'}
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default ReviewModeration;
