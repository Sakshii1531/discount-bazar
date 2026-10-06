import React from "react";
import { useSettings } from "@core/context/SettingsContext";

/**
 * Seller's extra delivery fee and time for one product. Customers see the
 * platform's global values plus these (e.g. ₹10 + ₹20 = ₹30, 15 + 20 = 35 mins).
 */
const inputCls =
  "w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-900 outline-none focus:border-primary";

// Only digits and one decimal point for the fee; only digits for minutes.
const cleanFee = (v) => {
  const s = String(v ?? "").replace(/[^0-9.]/g, "");
  const [whole, ...rest] = s.split(".");
  return rest.length ? `${whole}.${rest.join("").slice(0, 2)}` : whole;
};
// Whole minutes only: anything after a decimal point is dropped (7.5 -> 7).
const cleanMinutes = (v) => String(v ?? "").split(".")[0].replace(/[^0-9]/g, "");

const ProductDeliverySettings = ({ fee, minutes, onChange, showPreview = true }) => {
  let settings = {};
  try {
    settings = useSettings()?.settings || {};
  } catch {
    settings = {};
  }
  const globalFee = Number(
    settings.deliveryPricingMode === "fixed_price"
      ? settings.fixedDeliveryFee ?? settings.customerBaseDeliveryFee ?? 0
      : settings.customerBaseDeliveryFee ?? 0,
  ) || 0;
  const globalMinutes = Math.round(Number(settings.globalDeliveryTimeMinutes) || 0);
  const totalFee = Math.round((globalFee + (Number(fee) || 0)) * 100) / 100;
  const totalMinutes = globalMinutes + (Number(minutes) || 0);
  const zeroMessage = settings.zeroDeliveryTimeMessage || "Instant Delivery";

  return (
    <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4" data-testid="product-delivery-settings">
      <div>
        <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">Delivery fee & time (optional)</h4>
        <p className="text-[11px] text-slate-500 mt-0.5">
          Added on top of the platform&apos;s delivery fee and time. Leave empty for 0.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[11px] font-bold text-slate-600">Product delivery fee (₹)</span>
          <input
            type="text"
            inputMode="decimal"
            aria-label="Product delivery fee"
            value={fee ?? ""}
            onChange={(e) => onChange({ productDeliveryFee: cleanFee(e.target.value) })}
            className={inputCls}
            placeholder="0"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-bold text-slate-600">Product delivery time (minutes)</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Product delivery time"
            value={minutes ?? ""}
            onChange={(e) => onChange({ productDeliveryTimeMinutes: cleanMinutes(e.target.value) })}
            className={inputCls}
            placeholder="0"
          />
        </label>
      </div>
      {showPreview && (
        <p className="text-[11px] font-bold text-emerald-700">
          Customers will see: {totalFee === 0 ? "Free delivery" : `₹${totalFee} delivery`} ·{" "}
          {totalMinutes > 0 ? `${totalMinutes} mins` : zeroMessage}
          <span className="font-medium text-slate-400"> (platform ₹{globalFee} · {globalMinutes} mins + yours)</span>
        </p>
      )}
    </div>
  );
};

export default ProductDeliverySettings;
