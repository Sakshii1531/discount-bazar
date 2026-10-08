import React from "react";
import { Tag, Check, Search } from "lucide-react";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * CheckoutCouponSection
 *
 * Props:
 *   coupons           – array of coupon objects
 *   selectedCoupon    – currently applied coupon or null
 *   manualCode        – string value of the manual code input
 *   onApplyCoupon     – (coupon) => void
 *   onRemoveCoupon    – () => void
 *   onManualCodeChange – (value) => void
 *   isOpen            – boolean — controls the coupon modal
 *   onOpenChange      – (open) => void
 *   onApplyManualCode – () => void — triggered when user clicks CHECK
 */
const couponHeadline = (coupon) =>
  coupon.discountType === "free_delivery" || coupon.couponType === "free_delivery"
    ? "FREE DELIVERY"
    : coupon.discountType === "percentage"
      ? `${coupon.discountValue}% OFF`
      : `₹${coupon.discountValue} OFF`;

const inr = (v) => `₹${Number(v || 0).toLocaleString("en-IN")}`;

/** The coupon's real conditions, read from the coupon itself. */
export const couponConditions = (coupon) => {
  const lines = [];
  if (coupon.couponType === "monthly_volume" && Number(coupon.monthlyVolumeThreshold) > 0) {
    lines.push(`For customers who spent ${inr(coupon.monthlyVolumeThreshold)} this month`);
  }
  if (Number(coupon.minItems) > 0) lines.push(`Add ${coupon.minItems}+ items to the cart`);
  if (coupon.couponType === "category_based") {
    const names = (coupon.applicableCategories || []).map((c) => c?.name).filter(Boolean);
    if (names.length) lines.push(`On products from ${names.join(", ")}`);
  }
  if (Number(coupon.minOrderValue) > 0) lines.push(`On orders of ${inr(coupon.minOrderValue)} or more`);
  if (coupon.discountType === "percentage" && Number(coupon.maxDiscount) > 0) {
    lines.push(`Max discount ${inr(coupon.maxDiscount)}`);
  }
  return lines;
};

const CheckoutCouponSection = React.memo(function CheckoutCouponSection({
  coupons,
  selectedCoupon,
  manualCode,
  onApplyCoupon,
  onRemoveCoupon,
  onManualCodeChange,
  isOpen,
  onOpenChange,
  onApplyManualCode,
}) {
  return (
    <>
      {/* Inline coupon carousel */}
      <motion.div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Tag size={20} className="text-orange-500" />
            <h3 className="font-black text-slate-800">Available Coupons</h3>
          </div>
          <button
            onClick={() => onOpenChange(true)}
            className="text-primary text-sm font-bold hover:underline">
            See All
          </button>
        </div>
        <p className="-mt-1 mb-3 text-[11px] font-semibold text-slate-500" data-testid="one-coupon-note">
          Only one coupon can be used per order
          {selectedCoupon ? " — applying another replaces the current one." : "."}
        </p>
        {coupons.length === 0 ? (
          <p className="text-xs text-slate-400 font-medium py-2">
            No coupons available right now.
          </p>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 no-scrollbar -mx-4 px-4 snap-x">
            {coupons.map((coupon) => {
              const isApplied = selectedCoupon?.code === coupon.code;
              return (
                <div
                  key={coupon.code}
                  className={`flex-shrink-0 w-[200px] snap-start rounded-2xl border-2 border-dashed p-3 flex flex-col gap-2 transition-all ${
                    isApplied
                      ? "border-green-400 bg-green-50"
                      : "border-orange-200 bg-gradient-to-br from-orange-50 to-yellow-50"
                  }`}>
                  <div className="flex items-center justify-between">
                    <span
                      className={`text-xs font-black px-2 py-0.5 rounded-lg tracking-widest uppercase ${
                        isApplied
                          ? "bg-green-100 text-green-700"
                          : "bg-orange-100 text-orange-600"
                      }`}>
                      {coupon.code}
                    </span>
                    {isApplied && (
                      <span className="text-[10px] font-black text-green-600 uppercase tracking-wide">
                        ✓ Applied
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-black text-slate-800 leading-tight">
                    {couponHeadline(coupon)}
                    {couponConditions(coupon).map((line) => (
                      <span key={line} className="block text-[10px] font-medium text-slate-500" data-testid="coupon-condition">
                        {line}
                      </span>
                    ))}
                  </p>
                  {coupon.description && (
                    <p className="text-[10px] text-slate-500 leading-snug line-clamp-2">
                      {coupon.description}
                    </p>
                  )}
                  {isApplied ? (
                    <button
                      onClick={onRemoveCoupon}
                      className="mt-auto w-full py-1.5 rounded-xl text-xs font-black bg-red-50 text-red-500 hover:bg-red-100 active:scale-95 transition-all">
                      Remove
                    </button>
                  ) : (
                    <button
                      onClick={() => onApplyCoupon(coupon)}
                      className="mt-auto w-full py-1.5 rounded-xl text-xs font-black bg-primary text-primary-foreground hover:bg-[var(--brand-400)] active:scale-95 transition-all">
                      {selectedCoupon ? "Use instead" : "Apply"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Coupon Selection Modal */}
      <Dialog open={isOpen} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Apply Coupon</DialogTitle>
            <DialogDescription>Pick one offer — only one coupon can be used per order.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            {coupons.map((coupon) => (
              <div
                key={coupon.code}
                className={`p-4 rounded-2xl border-2 transition-all relative overflow-hidden ${
                  selectedCoupon?.code === coupon.code
                    ? "border-primary bg-brand-50 shadow-sm"
                    : "border-slate-100 bg-white hover:border-slate-200"
                }`}>
                {selectedCoupon?.code === coupon.code && (
                  <div className="absolute top-0 right-0 p-1.5 bg-primary text-primary-foreground rounded-bl-xl">
                    <Check size={12} strokeWidth={4} />
                  </div>
                )}
                <div className="flex items-start gap-3">
                  <div
                    className={`p-3 rounded-2xl ${
                      selectedCoupon?.code === coupon.code
                        ? "bg-primary/10 text-primary"
                        : "bg-orange-50 text-orange-500"
                    }`}>
                    <Tag size={20} />
                  </div>
                  <div className="flex-1">
                    <p className="font-black text-slate-800 tracking-wider mb-1">
                      {coupon.code} <span className="text-xs text-primary">· {couponHeadline(coupon)}</span>
                    </p>
                    {couponConditions(coupon).length > 0 && (
                      <ul className="mb-2 space-y-0.5">
                        {couponConditions(coupon).map((line) => (
                          <li key={line} className="text-[11px] font-semibold text-slate-600">• {line}</li>
                        ))}
                      </ul>
                    )}
                    <p className="text-xs text-slate-500 leading-relaxed mb-3">
                      {coupon.description}
                    </p>
                    <button
                      onClick={() => onApplyCoupon(coupon)}
                      disabled={selectedCoupon?.code === coupon.code}
                      className={`w-full py-2.5 rounded-xl font-bold text-sm transition-all ${
                        selectedCoupon?.code === coupon.code
                          ? "bg-white text-primary border-2 border-primary cursor-default"
                          : "bg-primary text-primary-foreground hover:bg-[#0b721b]"
                      }`}>
                      {selectedCoupon?.code === coupon.code ? "Applied" : selectedCoupon ? "Use this instead" : "Apply Now"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="pt-2">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={16}
              />
              <Input
                placeholder="Enter coupon code manually"
                value={manualCode}
                onChange={(e) => onManualCodeChange(e.target.value.toUpperCase())}
                className="pl-10 h-12 rounded-xl focus-visible:ring-primary"
              />
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-primary font-bold text-xs"
                onClick={onApplyManualCode}>
                CHECK
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
});

export default CheckoutCouponSection;
