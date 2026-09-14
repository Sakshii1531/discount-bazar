import React, { useState, useEffect } from "react";
import { Star, MessageSquare, Loader2, ThumbsUp, ShieldCheck, AlertCircle, RefreshCw } from "lucide-react";
import axiosInstance from "@core/api/axios";
import { cn } from "@/lib/utils";

const RatingAnalyticsCard = () => {
  const [summary, setSummary] = useState(null);
  const [ratings, setRatings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const fetchRatingData = async (pageNum = 1) => {
    try {
      setLoading(true);
      setError(null);
      const [sumRes, listRes] = await Promise.all([
        axiosInstance.get("/delivery-partners/me/rating"),
        axiosInstance.get("/delivery-partners/me/ratings", {
          params: { page: pageNum, limit: 10 },
        }),
      ]);

      // Handle all possible backend response shapes
      const sumData = sumRes.data?.result ?? sumRes.data?.data ?? sumRes.data;
      setSummary(sumData);

      const listData = listRes.data?.result ?? listRes.data?.data ?? listRes.data;
      setRatings(listData?.items || []);
      setPage(listData?.page || pageNum);
      setTotalPages(listData?.totalPages || 1);
    } catch (err) {
      console.error("Failed to fetch partner rating analytics:", err);
      setError(err?.response?.data?.message || "Failed to load ratings. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRatingData(1);
  }, []);

  if (loading && !summary) {
    return (
      <div className="p-8 flex flex-col items-center justify-center bg-white rounded-3xl border border-slate-100 shadow-sm">
        <Loader2 className="animate-spin text-brand-600 mb-2" size={28} />
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
          Loading Ratings...
        </p>
      </div>
    );
  }

  if (error && !summary) {
    return (
      <div className="p-8 flex flex-col items-center justify-center bg-white rounded-3xl border border-slate-100 shadow-sm gap-3">
        <AlertCircle size={32} className="text-rose-400" />
        <p className="text-sm font-bold text-slate-500 text-center">{error}</p>
        <button
          onClick={() => fetchRatingData(1)}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200 transition-colors"
        >
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    );
  }

  const ratingAvg = summary?.ratingAverage || 0;
  const ratingCount = summary?.ratingCount || 0;
  const dist = summary?.ratingDistribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

  return (
    <div className="space-y-6">
      {/* Overall Score Card */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-3xl p-6 shadow-xl text-white relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 relative z-10">
          <div className="text-center sm:text-left space-y-1">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-brand-400">
              Customer Satisfaction
            </p>
            <div className="flex items-baseline justify-center sm:justify-start gap-2">
              <span className="text-4xl sm:text-5xl font-black tracking-tight">
                {ratingAvg > 0 ? ratingAvg.toFixed(2) : "0.0"}
              </span>
              <div className="flex items-center text-amber-400">
                <Star size={24} className="fill-amber-400" />
              </div>
            </div>
            <p className="text-xs text-slate-400 font-medium">
              Based on{" "}
              <span className="text-white font-bold">{ratingCount}</span> customer reviews
            </p>
          </div>

          {/* Distribution Bars */}
          <div className="w-full sm:w-56 space-y-1.5 border-t sm:border-t-0 sm:border-l border-slate-700/60 pt-4 sm:pt-0 sm:pl-6">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = dist[star] || 0;
              const percent = ratingCount > 0 ? Math.round((count / ratingCount) * 100) : 0;
              return (
                <div key={star} className="flex items-center gap-2 text-xs">
                  <span className="w-3 text-[10px] font-bold text-slate-400">{star}★</span>
                  <div className="flex-1 h-2 bg-slate-700/60 rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        star >= 4 ? "bg-amber-400" : star === 3 ? "bg-amber-500" : "bg-rose-500"
                      )}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                  <span className="w-8 text-[10px] font-semibold text-slate-400 text-right">
                    {percent}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Decorative Gradient Blob */}
        <div className="absolute -bottom-10 -right-10 w-36 h-36 bg-brand-500/20 rounded-full blur-2xl pointer-events-none" />
      </div>

      {/* Recent Feedback List */}
      <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <MessageSquare size={16} className="text-brand-600" />
            Recent Feedback
          </h3>
          <span className="text-xs font-bold text-slate-400">
            {ratings.length} Reviews
          </span>
        </div>

        {ratings.length === 0 ? (
          <div className="py-12 text-center text-slate-400 space-y-2">
            <ShieldCheck size={36} className="mx-auto text-slate-300" />
            <p className="text-xs font-bold text-slate-500">No ratings received yet</p>
            <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
              Deliver orders safely and politely to build your customer rating!
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {ratings.map((item) => (
              <div
                key={item.id || item._id}
                className="p-4 rounded-2xl bg-slate-50 border border-slate-100 space-y-2 transition-all hover:bg-slate-100/60"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-amber-50 text-amber-600 px-2 py-0.5 rounded-lg border border-amber-200/50">
                      <span className="text-xs font-black">{item.rating}</span>
                      <Star size={12} className="fill-amber-400 text-amber-400" />
                    </div>
                    <span className="text-xs font-bold text-slate-700">
                      {item.customerName || "Anonymous customer"}
                    </span>
                  </div>
                  <span className="text-[10px] font-semibold text-slate-400">
                    {new Date(item.createdAt).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </div>

                {item.feedbackTags?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {item.feedbackTags.map((tag) => (
                      <span
                        key={tag}
                        className="px-2.5 py-0.5 bg-white text-slate-700 border border-slate-200 rounded-full text-[9px] font-bold shadow-2xs"
                      >
                        {tag.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}

                {item.comment && (
                  <p className="text-xs text-slate-600 italic font-medium leading-relaxed pt-1">
                    "{item.comment}"
                  </p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Pagination controls if totalPages > 1 */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-4 border-t border-slate-100 text-xs">
            <button
              disabled={page <= 1}
              onClick={() => fetchRatingData(page - 1)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >
              Previous
            </button>
            <span className="font-bold text-slate-400">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => fetchRatingData(page + 1)}
              className="px-3 py-1.5 rounded-xl border border-slate-200 font-bold text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default RatingAnalyticsCard;
