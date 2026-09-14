import React from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Star } from "lucide-react";
import RatingAnalyticsCard from "../components/RatingAnalyticsCard";

const DeliveryRatingsPage = () => {
  const navigate = useNavigate();

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto space-y-6 pb-20 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-2.5 bg-white rounded-2xl border border-slate-100 shadow-sm hover:bg-slate-50 transition-all active:scale-95"
        >
          <ChevronLeft size={20} className="text-slate-600" />
        </button>
        <div>
          <h1 className="text-xl font-black text-slate-900 flex items-center gap-2">
            Ratings & Reviews
            <Star size={18} className="fill-amber-400 text-amber-400" />
          </h1>
          <p className="text-xs text-slate-500 font-medium">
            Customer feedback on your deliveries
          </p>
        </div>
      </div>

      {/* Analytics & Feedback Component */}
      <RatingAnalyticsCard />
    </div>
  );
};

export default DeliveryRatingsPage;
