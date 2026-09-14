import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Star, X, Check, ThumbsUp, AlertCircle, Loader2 } from "lucide-react";
import axiosInstance from "@core/api/axios";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const POSITIVE_TAGS = [
  { id: "POLITE", label: "Polite" },
  { id: "QUICK_DELIVERY", label: "Quick delivery" },
  { id: "PROFESSIONAL", label: "Professional" },
  { id: "GOOD_COMMUNICATION", label: "Good communication" },
  { id: "CAREFUL_HANDLING", label: "Handled order carefully" },
];

const NEGATIVE_TAGS = [
  { id: "DELIVERY_LATE", label: "Delivery was late" },
  { id: "COMMUNICATION_ISSUE", label: "Communication issue" },
  { id: "RUDE_BEHAVIOUR", label: "Rude behaviour" },
  { id: "HANDLING_ISSUE", label: "Handling issue" },
  { id: "INSTRUCTIONS_IGNORED", label: "Instructions ignored" },
  { id: "SAFETY_CONCERN", label: "Safety concern" },
  { id: "OTHER", label: "Other" },
];

const DeliveryRatingModal = ({
  isOpen,
  onClose,
  orderId,
  partnerName = "Delivery Partner",
  partnerImage,
  onSuccess,
}) => {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [selectedTags, setSelectedTags] = useState([]);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  if (!isOpen) return null;

  const currentRating = hoverRating || rating;
  const isHighRating = currentRating >= 4;
  const availableTags = isHighRating ? POSITIVE_TAGS : NEGATIVE_TAGS;

  const handleTagToggle = (tagId) => {
    if (selectedTags.includes(tagId)) {
      setSelectedTags(selectedTags.filter((t) => t !== tagId));
    } else {
      setSelectedTags([...selectedTags, tagId]);
    }
  };

  const handleRatingChange = (newRating) => {
    setRating(newRating);
    // Reset selected tags if rating category flips (e.g. 5 stars -> 2 stars)
    setSelectedTags([]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (rating < 1 || rating > 5) {
      toast.error("Please select a rating between 1 and 5 stars");
      return;
    }

    setIsSubmitting(true);
    setErrorMsg("");

    try {
      const response = await axiosInstance.post("/delivery-ratings", {
        orderId,
        rating,
        feedbackTags: selectedTags,
        comment: comment.trim(),
      });

      if (response.data?.success) {
        setIsSubmitted(true);
        if (orderId) {
          localStorage.setItem(`rating_dismissed_${orderId}`, "true");
          localStorage.setItem(`rating_completed_${orderId}`, "true");
          sessionStorage.setItem(`rating_dismissed_${orderId}`, "true");
          sessionStorage.setItem(`rating_completed_${orderId}`, "true");
        }
        toast.success("Thank you! Rating submitted successfully ⭐");
        setTimeout(() => {
          if (onSuccess) onSuccess(response.data.data?.rating || { hasRated: true });
          onClose();
        }, 1800);
      }
    } catch (err) {
      console.error("Submit Delivery Rating Error:", err);
      const isAlreadySubmitted =
        err.response?.status === 409 ||
        err.response?.data?.message?.toLowerCase()?.includes("already");

      if (isAlreadySubmitted) {
        if (orderId) {
          localStorage.setItem(`rating_dismissed_${orderId}`, "true");
          localStorage.setItem(`rating_completed_${orderId}`, "true");
          sessionStorage.setItem(`rating_dismissed_${orderId}`, "true");
          sessionStorage.setItem(`rating_completed_${orderId}`, "true");
        }
        toast.info("Rating already submitted for this order.");
        if (onSuccess) {
          onSuccess({ hasRated: true });
        }
        onClose();
        return;
      }

      const msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        "Failed to submit rating. Please try again.";
      setErrorMsg(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-md"
          onClick={onClose}
        />

        {/* Modal Window */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative z-10 w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-100 p-6 sm:p-8 text-slate-900"
        >
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"
            aria-label="Close"
          >
            <X size={20} />
          </button>

          {isSubmitted ? (
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="py-8 flex flex-col items-center text-center space-y-4"
            >
              <div className="h-20 w-20 rounded-full bg-emerald-50 text-emerald-500 flex items-center justify-center shadow-inner">
                <Check size={40} strokeWidth={3} />
              </div>
              <h3 className="text-xl font-black text-slate-900">
                Thanks for your feedback! ⭐
              </h3>
              <p className="text-xs text-slate-500 font-medium max-w-xs leading-relaxed">
                Your rating helps us maintain top-quality delivery service.
              </p>
            </motion.div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Header Profile */}
              <div className="flex flex-col items-center text-center space-y-2">
                <div className="h-16 w-16 rounded-full overflow-hidden bg-primary/10 border-2 border-primary/20 shadow-md flex items-center justify-center">
                  <img
                    src={
                      partnerImage ||
                      "https://images.unsplash.com/photo-1633332755192-727a05c4013d?w=120&auto=format&fit=crop&q=60"
                    }
                    alt={partnerName}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">
                    How was your delivery?
                  </h3>
                  <p className="text-xs font-semibold text-slate-500 mt-0.5">
                    Rate <span className="text-primary font-bold">{partnerName}</span> for this order
                  </p>
                </div>
              </div>

              {/* Star Selection */}
              <div className="flex items-center justify-center gap-2 py-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onClick={() => handleRatingChange(star)}
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-1 text-amber-400 hover:scale-125 transition-transform focus:outline-none"
                    aria-label={`Rate ${star} stars`}
                  >
                    <Star
                      size={36}
                      className={cn(
                        "transition-all duration-200",
                        star <= currentRating
                          ? "fill-amber-400 text-amber-400 drop-shadow-sm"
                          : "text-slate-200 fill-slate-100"
                      )}
                    />
                  </button>
                ))}
              </div>

              {/* Dynamic Feedback Tags */}
              {rating > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className="space-y-3 pt-2 border-t border-slate-100"
                >
                  <p className="text-xs font-bold text-slate-700 uppercase tracking-wider text-center">
                    {isHighRating ? "What did you like?" : "What could be better?"}
                  </p>

                  <div className="flex flex-wrap gap-2 justify-center">
                    {availableTags.map((tag) => {
                      const isSelected = selectedTags.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => handleTagToggle(tag.id)}
                          className={cn(
                            "px-3 py-1.5 rounded-full text-xs font-bold transition-all border",
                            isSelected
                              ? "bg-slate-900 text-white border-slate-900 shadow-sm scale-105"
                              : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                          )}
                        >
                          {tag.label}
                        </button>
                      );
                    })}
                  </div>

                  {/* Comment Box */}
                  <div className="pt-2">
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      placeholder="Tell us more (optional)..."
                      maxLength={500}
                      rows={3}
                      className="w-full p-3 text-xs bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none font-medium placeholder:text-slate-400"
                    />
                    <div className="text-[10px] text-right text-slate-400 font-semibold mt-1">
                      {comment.length}/500
                    </div>
                  </div>
                </motion.div>
              )}

              {/* Error Message */}
              {errorMsg && (
                <div className="p-3 bg-rose-50 border border-rose-100 rounded-xl text-rose-600 text-xs font-bold flex items-center gap-2">
                  <AlertCircle size={16} className="shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Footer Actions */}
              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="submit"
                  disabled={rating === 0 || isSubmitting}
                  className={cn(
                    "w-full py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-lg flex items-center justify-center gap-2",
                    rating > 0 && !isSubmitting
                      ? "bg-primary text-primary-foreground hover:bg-primary/90 shadow-primary/20 active:scale-95 cursor-pointer"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                  )}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <span>Submit Rating</span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    // Mark dismissed in sessionStorage so it doesn't auto-prompt again this session
                    sessionStorage.setItem(`rating_dismissed_${orderId}`, "true");
                    onClose();
                  }}
                  disabled={isSubmitting}
                  className="w-full py-2.5 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors text-center"
                >
                  Maybe Later
                </button>
              </div>
            </form>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

export default DeliveryRatingModal;
