import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, X, Check, ChevronLeft, ChevronRight, MessageSquare, Package, Sparkles } from "lucide-react";
import { customerApi } from "../../services/customerApi";
import { useToast } from "@shared/components/ui/Toast";
import {
  POSITIVE_FEEDBACK_TAGS,
  NEGATIVE_FEEDBACK_TAGS,
} from "../../constants/productRatingConstants";

const TAG_LABELS = {
  GOOD_QUALITY: "Good Quality",
  FRESH: "Fresh Product",
  GOOD_TASTE: "Great Taste",
  GOOD_VALUE: "Value for Money",
  GOOD_PACKAGING: "Good Packaging",
  AS_EXPECTED: "As Expected",
  POOR_QUALITY: "Poor Quality",
  NOT_FRESH: "Not Fresh",
  DAMAGED: "Damaged Item",
  WRONG_PRODUCT: "Wrong Item Received",
  PACKAGING_ISSUE: "Packaging Issue",
  NOT_AS_EXPECTED: "Not As Expected",
  EXPIRY_ISSUE: "Near Expiry / Expired",
  OTHER: "Other Issue",
};

const ProductRatingModal = ({ isOpen, onClose, orderId, onRatingSubmitted }) => {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  
  const [rating, setRating] = useState(5);
  const [selectedTags, setSelectedTags] = useState([]);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittedCount, setSubmittedCount] = useState(0);

  useEffect(() => {
    if (isOpen && orderId) {
      fetchEligibility();
    }
  }, [isOpen, orderId]);

  const fetchEligibility = async () => {
    try {
      setLoading(true);
      const res = await customerApi.getProductRatingEligibility(orderId);
      if (res.data?.success) {
        const eligibleItems = (res.data.result?.items || []).filter(
          (i) => i.eligible || i.alreadyRated
        );
        setItems(eligibleItems);

        // Find first unrated item index
        const firstUnrated = eligibleItems.findIndex((i) => !i.alreadyRated);
        setCurrentIndex(firstUnrated >= 0 ? firstUnrated : 0);
      }
    } catch (err) {
      showToast(err.response?.data?.message || "Failed to load product rating information", "error");
    } fontally: {
      setLoading(false);
    }
  };

  const currentItem = items[currentIndex];

  // Reset local state when switching items
  useEffect(() => {
    if (currentItem) {
      if (currentItem.alreadyRated && currentItem.existingRating) {
        setRating(currentItem.existingRating.rating || 5);
        setSelectedTags(currentItem.existingRating.feedbackTags || []);
        setComment(currentItem.existingRating.comment || "");
      } else {
        setRating(5);
        setSelectedTags([]);
        setComment("");
      }
    }
  }, [currentIndex, currentItem]);

  const toggleTag = (tag) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleRatingChange = (newRating) => {
    setRating(newRating);
    // Clear tags if switching between positive (4-5) and negative (1-3)
    const availableTags = newRating >= 4 ? POSITIVE_FEEDBACK_TAGS : NEGATIVE_FEEDBACK_TAGS;
    setSelectedTags((prev) => prev.filter((t) => availableTags.includes(t)));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!currentItem || currentItem.alreadyRated) return;

    try {
      setSubmitting(true);
      const payload = {
        orderItemId: currentItem.orderItemId,
        rating,
        feedbackTags: selectedTags,
        comment: comment.trim().slice(0, 500),
      };

      const res = await customerApi.submitProductRating(payload);
      if (res.data?.success) {
        showToast(`Rating submitted for ${currentItem.productName}! ⭐`, "success");
        setSubmittedCount((prev) => prev + 1);

        // Mark item as rated locally
        setItems((prev) =>
          prev.map((item, idx) =>
            idx === currentIndex
              ? {
                  ...item,
                  alreadyRated: true,
                  eligible: false,
                  existingRating: { rating, feedbackTags: selectedTags, comment },
                }
              : item
          )
        );

        if (onRatingSubmitted) {
          onRatingSubmitted();
        }

        // Auto advance to next unrated item or finish
        const nextUnrated = items.findIndex(
          (item, idx) => idx > currentIndex && !item.alreadyRated
        );
        if (nextUnrated !== -1) {
          setCurrentIndex(nextUnrated);
        }
      }
    } catch (err) {
      showToast(
        err.response?.data?.message || "Failed to submit rating. Please try again.",
        "error"
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const currentAvailableTags = rating >= 4 ? POSITIVE_FEEDBACK_TAGS : NEGATIVE_FEEDBACK_TAGS;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="text-base font-black text-slate-800 flex items-center gap-2">
                <Sparkles size={18} className="text-primary" />
                Rate Your Products
              </h3>
              <p className="text-[11px] text-slate-500 font-bold">
                Item {items.length > 0 ? currentIndex + 1 : 0} of {items.length}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Modal Body */}
          <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-5">
            {loading ? (
              <div className="py-12 text-center text-slate-400 font-medium text-xs">
                Loading rateable items...
              </div>
            ) : items.length === 0 ? (
              <div className="py-12 text-center text-slate-500 font-medium text-xs">
                No items eligible for rating in this order.
              </div>
            ) : !currentItem ? (
              <div className="py-12 text-center text-slate-500 font-medium text-xs">
                All products in this order have been rated! Thank you ⭐
              </div>
            ) : (
              <>
                {/* Product Card Info */}
                <div className="flex items-center gap-4 bg-brand-50/50 p-3.5 rounded-2xl border border-brand-100/50">
                  <div className="w-16 h-16 rounded-xl bg-white p-1 flex items-center justify-center border border-slate-100 shadow-sm shrink-0 overflow-hidden">
                    {currentItem.image ? (
                      <img
                        src={currentItem.image}
                        alt={currentItem.productName}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <Package size={24} className="text-slate-300" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-black text-slate-800 text-sm truncate">
                      {currentItem.productName}
                    </h4>
                    <p className="text-[11px] text-slate-500 font-bold mt-0.5">
                      ₹{currentItem.price} {currentItem.variantSlot ? `• ${currentItem.variantSlot}` : ""}
                    </p>
                    {currentItem.alreadyRated && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md mt-1">
                        <Check size={10} /> Already Rated
                      </span>
                    )}
                  </div>
                </div>

                {/* Star Rating Controls */}
                <div className="text-center space-y-2 py-2">
                  <p className="text-xs font-black text-slate-700 uppercase tracking-wider">
                    {currentItem.alreadyRated ? "Your Rating" : "How was this product?"}
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        disabled={currentItem.alreadyRated}
                        onClick={() => handleRatingChange(star)}
                        className="p-1 transition-transform active:scale-90 hover:scale-110 disabled:cursor-default"
                        aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
                      >
                        <Star
                          size={32}
                          className={
                            star <= rating
                              ? "text-amber-400 fill-amber-400 drop-shadow-sm"
                              : "text-slate-200 fill-slate-100"
                          }
                        />
                      </button>
                    ))}
                  </div>
                </div>

                {/* Contextual Feedback Tags */}
                <div className="space-y-2">
                  <p className="text-[11px] font-black text-slate-500 uppercase tracking-wider">
                    {rating >= 4 ? "What did you like?" : "What can be improved?"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {currentAvailableTags.map((tag) => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          disabled={currentItem.alreadyRated}
                          onClick={() => toggleTag(tag)}
                          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                            isSelected
                              ? "bg-primary text-white border-primary shadow-sm"
                              : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                          } disabled:opacity-70`}
                        >
                          {TAG_LABELS[tag] || tag}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Review Comment Input */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-black text-slate-500 uppercase tracking-wider">
                    <span className="flex items-center gap-1">
                      <MessageSquare size={12} />
                      Optional Comment
                    </span>
                    <span className="text-[10px] text-slate-400 font-bold">
                      {comment.length}/500
                    </span>
                  </div>
                  <textarea
                    rows={3}
                    maxLength={500}
                    disabled={currentItem.alreadyRated}
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Share details about fresh quality, packaging, or taste..."
                    className="w-full p-3 rounded-2xl border border-slate-200 bg-slate-50/50 text-xs font-medium focus:outline-none focus:border-primary focus:bg-white transition-all resize-none disabled:opacity-70"
                  />
                </div>
              </>
            )}
          </div>

          {/* Footer Actions */}
          <div className="p-4 border-t border-slate-100 bg-slate-50/80 flex items-center justify-between gap-3">
            {/* Prev / Next item buttons */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={currentIndex === 0}
                onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
                className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                aria-label="Previous product"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                disabled={currentIndex >= items.length - 1}
                onClick={() => setCurrentIndex((prev) => Math.min(items.length - 1, prev + 1))}
                className="p-2 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                aria-label="Next product"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              {currentItem && !currentItem.alreadyRated && (
                <button
                  type="button"
                  onClick={() => {
                    if (currentIndex < items.length - 1) {
                      setCurrentIndex((prev) => prev + 1);
                    } else {
                      onClose();
                    }
                  }}
                  className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-200 transition-colors"
                >
                  Skip
                </button>
              )}

              {currentItem && !currentItem.alreadyRated ? (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleSubmit}
                  className="px-6 py-2.5 rounded-xl text-xs font-black bg-primary text-white hover:opacity-90 shadow-md transition-all disabled:opacity-50"
                >
                  {submitting ? "Submitting..." : "Submit Rating"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-2.5 rounded-xl text-xs font-black bg-slate-800 text-white hover:bg-slate-900 transition-all"
                >
                  Done
                </button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default ProductRatingModal;
