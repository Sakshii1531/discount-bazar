import React, { useState, useEffect } from "react";
import Card from "@shared/components/ui/Card";
import Badge from "@shared/components/ui/Badge";
import Pagination from "@shared/components/ui/Pagination";
import {
  Star,
  Search,
  Filter,
  ShieldAlert,
  Eye,
  AlertTriangle,
  CheckCircle,
  EyeOff,
  Trash2,
  X,
  Loader2,
  User,
  Truck,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import axiosInstance from "@core/api/axios";

const DeliveryRatings = () => {
  const [ratings, setRatings] = useState([]);
  const [metrics, setMetrics] = useState({
    totalRatings: 0,
    overallAverage: 0,
    flaggedCount: 0,
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [ratingFilter, setRatingFilter] = useState("all");
  const [isFlaggedFilter, setIsFlaggedFilter] = useState(false);

  // Selected rating for modal
  const [selectedRating, setSelectedRating] = useState(null);
  const [moderationReason, setModerationReason] = useState("");
  const [isModerating, setIsModerating] = useState(false);

  const fetchRatings = async (requestedPage = 1) => {
    setLoading(true);
    try {
      const params = {
        page: requestedPage,
        limit: pageSize,
      };
      if (searchTerm.trim()) params.search = searchTerm.trim();
      if (statusFilter !== "all") params.status = statusFilter;
      if (ratingFilter !== "all") params.rating = ratingFilter;
      if (isFlaggedFilter) params.isFlagged = true;

      const response = await axiosInstance.get("/admin/delivery-ratings", { params });
      const data = response.data?.result || response.data?.data || {};

      setRatings(data.items || []);
      setTotal(data.total || 0);
      setPage(data.page || requestedPage);
      if (data.metrics) setMetrics(data.metrics);
    } catch (error) {
      console.error("Fetch Admin Ratings Error:", error);
      toast.error("Failed to fetch delivery ratings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchRatings(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [pageSize, searchTerm, statusFilter, ratingFilter, isFlaggedFilter]);

  // Lock body scroll (Lenis smooth scroll) when moderation modal is open
  useEffect(() => {
    if (selectedRating) {
      window.lenis?.stop();
    } else {
      window.lenis?.start();
    }
    return () => {
      window.lenis?.start();
    };
  }, [selectedRating]);

  const handleModeration = async (targetStatus) => {
    if (!selectedRating) return;
    setIsModerating(true);
    try {
      await axiosInstance.patch(`/admin/delivery-ratings/${selectedRating._id}/status`, {
        status: targetStatus,
        reason: moderationReason,
      });

      toast.success(`Rating status updated to ${targetStatus}`);
      setSelectedRating(null);
      setModerationReason("");
      fetchRatings(page);
    } catch (error) {
      console.error("Moderate Rating Error:", error);
      toast.error(error.response?.data?.message || "Failed to moderate rating");
    } finally {
      setIsModerating(false);
    }
  };

  const statsList = [
    {
      label: "Total Active Ratings",
      value: metrics.totalRatings,
      color: "indigo",
      icon: MessageSquare,
    },
    {
      label: "Overall Avg Rating",
      value: `${metrics.overallAverage} ★`,
      color: "emerald",
      icon: Star,
    },
    {
      label: "5 Star Reviews",
      value: metrics.distribution[5] || 0,
      color: "amber",
      icon: CheckCircle,
    },
    {
      label: "Flagged / Reported",
      value: metrics.flaggedCount,
      color: "rose",
      icon: ShieldAlert,
    },
  ];

  return (
    <div className="ds-section-spacing animate-in fade-in duration-500 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="ds-h1 flex items-center gap-3">
            Delivery Ratings & Reviews
            <div className="h-2 w-2 rounded-full bg-brand-500 animate-pulse" />
          </h1>
          <p className="ds-description mt-1">
            Monitor and moderate customer feedback for delivery partners.
          </p>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {statsList.map((stat, idx) => (
          <Card
            key={idx}
            className="p-6 border-none shadow-xl ring-1 ring-slate-100 relative overflow-hidden group"
          >
            <div className="flex justify-between items-start relative z-10">
              <div>
                <p className="ds-label mb-2">{stat.label}</p>
                <h3 className="ds-stat-medium">{stat.value}</h3>
              </div>
              <div
                className={cn(
                  "p-3 rounded-2xl transition-all duration-300 shadow-md",
                  stat.color === "indigo"
                    ? "bg-brand-500/10 text-brand-600 shadow-brand-100"
                    : stat.color === "emerald"
                    ? "bg-emerald-500/10 text-emerald-600 shadow-emerald-100"
                    : stat.color === "amber"
                    ? "bg-amber-500/10 text-amber-600 shadow-amber-100"
                    : "bg-rose-500/10 text-rose-600 shadow-rose-100"
                )}
              >
                <stat.icon size={20} strokeWidth={2.5} />
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Filters Bar */}
      <Card className="p-4 border-none shadow-sm ring-1 ring-slate-100 bg-white/50 backdrop-blur-xl space-y-4">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-primary transition-colors" />
            <input
              type="text"
              placeholder="Search by Rating ID, Order ID, or Partner ID..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-3 bg-slate-100/60 border-none rounded-2xl text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Star Rating Filter */}
            <select
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value)}
              className="px-4 py-3 bg-slate-100/60 border-none rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
            >
              <option value="all">All Stars</option>
              <option value="5">5 Stars ⭐⭐⭐⭐⭐</option>
              <option value="4">4 Stars ⭐⭐⭐⭐</option>
              <option value="3">3 Stars ⭐⭐⭐</option>
              <option value="2">2 Stars ⭐⭐</option>
              <option value="1">1 Star ⭐</option>
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-3 bg-slate-100/60 border-none rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-primary/20 transition-all cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="FLAGGED">FLAGGED</option>
              <option value="HIDDEN">HIDDEN</option>
              <option value="REMOVED">REMOVED</option>
            </select>

            {/* Flagged Toggle */}
            <button
              type="button"
              onClick={() => setIsFlaggedFilter(!isFlaggedFilter)}
              className={cn(
                "px-4 py-3 rounded-2xl text-xs font-bold transition-all border flex items-center gap-2",
                isFlaggedFilter
                  ? "bg-rose-500 text-white border-rose-500 shadow-md"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              )}
            >
              <AlertTriangle size={14} />
              <span>Flagged Only</span>
            </button>
          </div>
        </div>
      </Card>

      {/* Ratings Table */}
      <Card className="border-none shadow-xl ring-1 ring-slate-100 overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-wider">
              <tr>
                <th className="p-4">Rating</th>
                <th className="p-4">Order ID</th>
                <th className="p-4">Delivery Partner</th>
                <th className="p-4">Customer</th>
                <th className="p-4">Tags & Comment</th>
                <th className="p-4">Status</th>
                <th className="p-4">Date</th>
                <th className="p-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-semibold">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <Loader2 className="animate-spin mx-auto mb-2 text-primary" size={24} />
                    <p className="text-[10px] font-black uppercase tracking-widest">Loading delivery ratings...</p>
                  </td>
                </tr>
              ) : ratings.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    No ratings found matching filters.
                  </td>
                </tr>
              ) : (
                ratings.map((item) => {
                  const partner = item.deliveryPartnerId;
                  const customer = item.customerId;
                  const orderDoc = item.orderId;

                  return (
                    <tr key={item._id} className="hover:bg-slate-50/80 transition-colors">
                      {/* Rating Stars */}
                      <td className="p-4">
                        <div className="flex items-center gap-1 bg-amber-50 text-amber-600 px-2.5 py-1 rounded-xl w-fit border border-amber-200/50">
                          <span className="font-black text-sm">{item.rating}</span>
                          <Star size={14} className="fill-amber-400 text-amber-400" />
                        </div>
                      </td>

                      {/* Order ID */}
                      <td className="p-4 font-mono text-slate-700">
                        {orderDoc?.orderId ? `#${orderDoc.orderId}` : "N/A"}
                      </td>

                      {/* Delivery Partner */}
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <Truck size={14} className="text-slate-400" />
                          <div>
                            <p className="font-bold text-slate-900">{partner?.name || "Rider"}</p>
                            <p className="text-[10px] text-slate-400">{partner?.phone}</p>
                          </div>
                        </div>
                      </td>

                      {/* Customer */}
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <User size={14} className="text-slate-400" />
                          <div>
                            <p className="font-bold text-slate-900">{customer?.name || "Customer"}</p>
                            <p className="text-[10px] text-slate-400">{customer?.phone || customer?.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Tags & Comment */}
                      <td className="p-4 max-w-xs">
                        {item.feedbackTags?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1">
                            {item.feedbackTags.map((tag) => (
                              <span
                                key={tag}
                                className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[9px] font-bold"
                              >
                                {tag.replace(/_/g, " ")}
                              </span>
                            ))}
                          </div>
                        )}
                        {item.comment ? (
                          <p className="text-slate-600 truncate italic">"{item.comment}"</p>
                        ) : (
                          <span className="text-slate-300 text-[10px]">— No comment —</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="p-4">
                        <Badge
                          variant={
                            item.status === "ACTIVE"
                              ? "success"
                              : item.status === "FLAGGED"
                              ? "warning"
                              : "destructive"
                          }
                          className="uppercase font-black text-[9px] px-2.5 py-1"
                        >
                          {item.status}
                        </Badge>
                      </td>

                      {/* Date */}
                      <td className="p-4 text-slate-500 text-[11px]">
                        {new Date(item.createdAt).toLocaleDateString("en-GB", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>

                      {/* Actions */}
                      <td className="p-4 text-right">
                        <button
                          onClick={() => {
                            setSelectedRating(item);
                            setModerationReason(item.moderationReason || "");
                          }}
                          className="p-2 bg-slate-100 hover:bg-slate-900 hover:text-white rounded-xl transition-all"
                          title="View & Moderate"
                        >
                          <Eye size={16} />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="p-4 border-t border-slate-100 flex justify-center">
          <Pagination
            page={page}
            totalPages={Math.ceil(total / pageSize) || 1}
            total={total}
            pageSize={pageSize}
            onPageChange={(p) => fetchRatings(p)}
            onPageSizeChange={(newSize) => {
              setPageSize(newSize);
              setPage(1);
            }}
            loading={loading}
          />
        </div>
      </Card>

      {/* Moderation Detail Modal */}
      <AnimatePresence>
        {selectedRating && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/50 backdrop-blur-md"
              onClick={() => setSelectedRating(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative z-10 w-full max-w-lg bg-white rounded-3xl p-6 sm:p-8 shadow-2xl space-y-6"
              data-lenis-prevent
            >
              <div className="flex items-center justify-between">
                <h3 className="ds-h2 flex items-center gap-2">
                  <Star className="text-amber-400 fill-amber-400" size={20} />
                  Rating Moderation
                </h3>
                <button
                  onClick={() => setSelectedRating(null)}
                  className="p-2 bg-slate-50 hover:bg-slate-100 rounded-full transition-all"
                >
                  <X size={18} className="text-slate-400" />
                </button>
              </div>

              {/* Rating Overview */}
              <div className="p-4 bg-slate-50 rounded-2xl space-y-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-slate-900">{selectedRating.rating}.0</span>
                    <div className="flex text-amber-400">
                      {[...Array(selectedRating.rating)].map((_, i) => (
                        <Star key={i} size={16} className="fill-amber-400" />
                      ))}
                    </div>
                  </div>
                  <Badge
                    variant={
                      selectedRating.status === "ACTIVE"
                        ? "success"
                        : selectedRating.status === "FLAGGED"
                        ? "warning"
                        : "destructive"
                    }
                    className="uppercase font-black text-[9px]"
                  >
                    {selectedRating.status}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Delivery Partner:</span>
                    <p className="font-bold text-slate-900">{selectedRating.deliveryPartnerId?.name || "N/A"}</p>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Customer:</span>
                    <p className="font-bold text-slate-900">{selectedRating.customerId?.name || "N/A"}</p>
                  </div>
                </div>

                {selectedRating.feedbackTags?.length > 0 && (
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Feedback Tags:</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedRating.feedbackTags.map((t) => (
                        <span key={t} className="px-2 py-0.5 bg-white border border-slate-200 rounded-md text-[9px] font-bold">
                          {t.replace(/_/g, " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedRating.comment && (
                  <div>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Comment:</span>
                    <p className="text-xs text-slate-700 italic font-medium mt-0.5">"{selectedRating.comment}"</p>
                  </div>
                )}
              </div>

              {/* Moderation Notes */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                  Moderation Reason / Note
                </label>
                <textarea
                  value={moderationReason}
                  onChange={(e) => setModerationReason(e.target.value)}
                  placeholder="Enter moderation reason or audit note..."
                  rows={2}
                  className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-primary/20 transition-all font-medium"
                />
              </div>

              {/* Moderation Action Buttons */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                {selectedRating.status !== "ACTIVE" && (
                  <button
                    disabled={isModerating}
                    onClick={() => handleModeration("ACTIVE")}
                    className="py-3 bg-emerald-600 text-white rounded-2xl font-bold text-xs hover:bg-emerald-700 transition-all shadow-md flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle size={16} /> Restore (Active)
                  </button>
                )}

                {selectedRating.status !== "FLAGGED" && (
                  <button
                    disabled={isModerating}
                    onClick={() => handleModeration("FLAGGED")}
                    className="py-3 bg-amber-500 text-white rounded-2xl font-bold text-xs hover:bg-amber-600 transition-all shadow-md flex items-center justify-center gap-1.5"
                  >
                    <AlertTriangle size={16} /> Flag Review
                  </button>
                )}

                {selectedRating.status !== "HIDDEN" && (
                  <button
                    disabled={isModerating}
                    onClick={() => handleModeration("HIDDEN")}
                    className="py-3 bg-slate-700 text-white rounded-2xl font-bold text-xs hover:bg-slate-800 transition-all shadow-md flex items-center justify-center gap-1.5"
                  >
                    <EyeOff size={16} /> Hide Rating
                  </button>
                )}

                {selectedRating.status !== "REMOVED" && (
                  <button
                    disabled={isModerating}
                    onClick={() => handleModeration("REMOVED")}
                    className="py-3 bg-rose-600 text-white rounded-2xl font-bold text-xs hover:bg-rose-700 transition-all shadow-md flex items-center justify-center gap-1.5"
                  >
                    <Trash2 size={16} /> Remove Rating
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DeliveryRatings;
