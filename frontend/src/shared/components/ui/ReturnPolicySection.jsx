import React from "react";

export const ALLOWED_RETURN_REASONS = [
  "Damaged Product",
  "Wrong Product",
  "Quality Issue",
  "Expired Product",
  "Missing Item",
  "Received Different Variant",
  "Packaging Issue",
  "Other",
];

export default function ReturnPolicySection({ returnPolicy, onChange, readOnly = false }) {
  const policy = returnPolicy || { isReturnable: false, returnWindowDays: 0, returnReasons: [] };

  const handleReturnableChange = (isReturnable) => {
    if (readOnly) return;
    if (!isReturnable) {
      onChange({
        isReturnable: false,
        returnWindowDays: 0,
        returnReasons: [],
      });
    } else {
      onChange({
        isReturnable: true,
        returnWindowDays: policy.returnWindowDays > 0 ? policy.returnWindowDays : 7,
        returnReasons: policy.returnReasons?.length > 0 ? policy.returnReasons : [...ALLOWED_RETURN_REASONS],
      });
    }
  };

  const handleWindowChange = (val) => {
    if (readOnly) return;
    const num = val === "" ? "" : Math.max(0, parseInt(val, 10) || 0);
    onChange({
      ...policy,
      returnWindowDays: num,
      returnReasons: policy.returnReasons?.length > 0 ? policy.returnReasons : [...ALLOWED_RETURN_REASONS],
    });
  };

  return (
    <div className="bg-slate-50/80 border border-slate-200/80 rounded-2xl p-5 space-y-5">
      <div className="flex items-center justify-between border-b border-slate-200/60 pb-3">
        <div>
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            Return Policy
          </h4>
          <p className="text-[11px] text-slate-500 font-medium mt-0.5">
            Configure returnability and manual return window for this product.
          </p>
        </div>
      </div>

      {/* Returnable Radio Buttons */}
      <div className="space-y-2">
        <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
          Returnable <span className="text-rose-500">*</span>
        </label>
        <div className="flex items-center gap-6 pt-1">
          <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
            <input
              type="radio"
              name="isReturnable"
              checked={policy.isReturnable === true}
              disabled={readOnly}
              onChange={() => handleReturnableChange(true)}
              className="h-4 w-4 text-slate-900 border-slate-300 focus:ring-slate-900 cursor-pointer"
            />
            <span>Yes</span>
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
            <input
              type="radio"
              name="isReturnable"
              checked={policy.isReturnable === false}
              disabled={readOnly}
              onChange={() => handleReturnableChange(false)}
              className="h-4 w-4 text-slate-900 border-slate-300 focus:ring-slate-900 cursor-pointer"
            />
            <span>No</span>
          </label>
        </div>
      </div>

      {/* Show Manual Window Input only when Returnable === true */}
      {policy.isReturnable && (
        <div className="space-y-3 pt-2 border-t border-slate-200/60 animate-in fade-in duration-200">
          <div className="space-y-1.5 max-w-sm">
            <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
              RETURN WINDOW (DAYS) <span className="text-rose-500">*</span>
            </label>
            <input
              type="number"
              min="1"
              max="30"
              value={policy.returnWindowDays === 0 ? "" : policy.returnWindowDays}
              disabled={readOnly}
              onChange={(e) => handleWindowChange(e.target.value)}
              placeholder="Enter return window in days (e.g. 7)"
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-slate-900/10 outline-none"
            />
            <p className="text-[10px] text-slate-500 font-medium">
              Enter number of days (1 - 30) customer can request return after delivery.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
