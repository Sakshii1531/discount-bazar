import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertTriangle, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { customerApi } from "../../services/customerApi";
import { formatAmount } from "@shared/utils/currency";

const STAGE_LABELS = {
  AWAITING_PAYMENT: "Awaiting payment",
  PENDING_ACCEPTANCE: "Waiting for store to accept",
  ACCEPTED: "Accepted by store",
  PACKED: "Packed, ready for pickup",
  RIDER_ASSIGNED: "Delivery partner assigned",
  RIDER_AT_STORE: "Delivery partner at store",
  PICKED_UP: "Picked up / out for delivery",
};

const PAYMENT_LABELS = {
  ONLINE: "Online payment",
  COD: "Cash on Delivery",
  WALLET: "Wallet",
};

const DEFAULT_REASONS = [
  { code: "PLACED_BY_MISTAKE", label: "Order Placed by Mistake" },
  { code: "INCORRECT_ADDRESS", label: "Incorrect Address" },
  { code: "INCORRECT_PRODUCTS", label: "Incorrect Products Ordered" },
  { code: "MODIFY_ORDER", label: "Want to Modify Order" },
  { code: "DELIVERY_TOO_LONG", label: "Delivery Taking Long" },
  { code: "PAYMENT_ISSUE", label: "Payment Issue" },
  { code: "BETTER_PRICE", label: "Found a Better Price" },
  { code: "OTHER", label: "Other" },
];

const newIdempotencyKey = () =>
  globalThis.crypto?.randomUUID?.() || `cxl-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const money = (v) => `₹${formatAmount(Number(v) || 0)}`;

/**
 * Cancellation confirmation sheet. Closing it or pressing Back never calls
 * the API, so the order stays exactly as it was.
 */
const CancelOrderModal = ({ isOpen, onClose, orderId, details, onDone }) => {
  const [reasonCode, setReasonCode] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // One key per opened sheet: double taps and retries after a timeout reach
  // the backend as the same request.
  const idempotencyKeyRef = useRef(null);

  const eligibility = details?.eligibility;
  const order = details?.order;
  const reasons = (details?.reasons && details.reasons.length > 0) ? details.reasons : DEFAULT_REASONS;
  const isRequest = eligibility?.action === "REQUEST";
  const preview = eligibility?.refundPreview;

  useEffect(() => {
    if (isOpen) {
      idempotencyKeyRef.current = newIdempotencyKey();
      setReasonCode("");
      setReasonText("");
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const refundLines = useMemo(() => {
    if (!preview) return [];
    const lines = [];
    if (preview.paidGateway > 0) lines.push(["Paid online", money(preview.paidGateway)]);
    if (preview.paidWallet > 0) lines.push(["Paid from wallet", money(preview.paidWallet)]);
    const d = preview.deductions || {};
    if (d.deliveryFee > 0) lines.push(["Delivery fee (not refundable)", `− ${money(d.deliveryFee)}`]);
    if (d.handlingFee > 0) lines.push(["Handling fee (not refundable)", `− ${money(d.handlingFee)}`]);
    if (d.tip > 0) lines.push(["Rider tip (not refundable)", `− ${money(d.tip)}`]);
    if (d.cancellationFee > 0) lines.push(["Cancellation fee", `− ${money(d.cancellationFee)}`]);
    return lines;
  }, [preview]);

  const refundSummary = useMemo(() => {
    if (!preview) return "";
    if (preview.refundable > 0) {
      const destinations = (preview.allocations || []).map((a) =>
        a.source === "WALLET" || a.destination === "WALLET" ? "your wallet" : "your original payment method",
      );
      const unique = [...new Set(destinations)].join(" and ");
      return `${money(preview.refundable)} will be refunded to ${unique}${isRequest ? " if the request is approved" : ""}.`;
    }
    if (order?.paymentMode === "COD") return "Cash on Delivery — nothing has been charged, so no refund is needed.";
    return "No refund applies to this order.";
  }, [preview, order, isRequest]);

  const handleConfirm = async () => {
    if (!reasonCode || submitting) return;
    setSubmitting(true);
    try {
      const res = await customerApi.submitOrderCancellation(
        orderId,
        {
          mode: isRequest ? "REQUEST" : "CANCEL",
          reasonCode,
          reasonText: reasonCode === "OTHER" ? reasonText.trim() : undefined,
        },
        idempotencyKeyRef.current,
      );
      const result = res.data?.result || res.data?.data;
      toast.success(
        result?.duplicate
          ? "We already have this request."
          : isRequest
            ? "Cancellation request sent. We'll update you soon."
            : "Your order has been cancelled.",
      );
      onDone?.(result);
      onClose();
    } catch (error) {
      const data = error?.response?.data;
      toast.error(data?.message || "Could not cancel the order. Please try again.");
      // The order moved on (e.g. picked up meanwhile): show the latest state.
      if (error?.response?.status === 409) {
        onDone?.(null);
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && details && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={submitting ? undefined : onClose}
          className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm"
        >
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="cancel-order-title"
            className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[90vh] sm:max-h-[85vh] flex flex-col overflow-hidden shadow-2xl relative"
          >
            <div className="shrink-0 flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100 bg-white z-10">
              <h2 id="cancel-order-title" className="text-lg font-black text-slate-900">
                {isRequest ? "Request cancellation" : "Cancel order"}
              </h2>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                aria-label="Close"
                className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center hover:bg-slate-200 disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4 overscroll-contain">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 bg-slate-50 rounded-2xl p-4 text-sm">
                <dt className="text-slate-500">Order</dt>
                <dd className="font-bold text-slate-900 text-right break-all">#{order?.orderId}</dd>
                <dt className="text-slate-500">Amount</dt>
                <dd className="font-bold text-slate-900 text-right">{money(order?.amount)}</dd>
                <dt className="text-slate-500">Status</dt>
                <dd className="font-semibold text-slate-800 text-right">{STAGE_LABELS[eligibility?.stage] || order?.status}</dd>
                <dt className="text-slate-500">Payment</dt>
                <dd className="font-semibold text-slate-800 text-right">{PAYMENT_LABELS[order?.paymentMode] || order?.paymentMode}</dd>
              </dl>

              <section className="rounded-2xl border border-slate-200 p-4 space-y-2">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Refund</h3>
                {refundLines.map(([label, value]) => (
                  <div key={label} className="flex justify-between text-sm text-slate-700">
                    <span>{label}</span>
                    <span className="font-semibold">{value}</span>
                  </div>
                ))}
                <p className="text-sm font-bold text-slate-900">{refundSummary}</p>
              </section>

              {eligibility?.specialConditions?.length > 0 && (
                <ul className="rounded-2xl bg-amber-50 border border-amber-200 p-4 space-y-2">
                  {eligibility.specialConditions.map((note) => (
                    <li key={note} className="flex gap-2 text-sm text-amber-900">
                      <Info size={16} className="shrink-0 mt-0.5" />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              )}

              <fieldset>
                <legend className="text-sm font-black text-slate-900 mb-2">Why are you cancelling?</legend>
                <div className="space-y-2">
                  {reasons.map((r) => (
                    <label
                      key={r.code}
                      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm cursor-pointer transition-colors ${
                        reasonCode === r.code ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        type="radio"
                        name="cancel-reason"
                        value={r.code}
                        checked={reasonCode === r.code}
                        onChange={() => setReasonCode(r.code)}
                        className="accent-slate-900"
                      />
                      <span className="font-medium text-slate-800">{r.label}</span>
                    </label>
                  ))}
                </div>
                {reasonCode === "OTHER" && (
                  <textarea
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value.slice(0, 500))}
                    rows={3}
                    placeholder="Tell us more (optional)"
                    className="mt-2 w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                )}
                {/* Instant proceed button visible right when a cancellation reason is selected */}
                {reasonCode && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="pt-3"
                  >
                    <button
                      type="button"
                      onClick={handleConfirm}
                      disabled={submitting}
                      className="w-full py-3.5 px-4 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-black flex items-center justify-center gap-2 shadow-lg shadow-rose-200 active:scale-[0.98] transition-all cursor-pointer"
                    >
                      {submitting && <Loader2 size={16} className="animate-spin" />}
                      <span>{isRequest ? "Proceed with Request" : "Proceed to Cancel"}</span>
                    </button>
                  </motion.div>
                )}
              </fieldset>

              <div className="flex gap-2 rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-900">
                <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                <p>
                  {isRequest
                    ? "Your order is already with the delivery partner. Our support team will review this request; the order is only cancelled if it is approved."
                    : "Once cancelled, this order will not be processed further and cannot be restored — you would need to place a new order."}
                  {preview?.paidGateway > 0 ? " Refunds for prepaid orders can take additional processing time." : ""}
                </p>
              </div>
            </div>

            <div className="shrink-0 grid grid-cols-2 gap-3 p-4 sm:p-5 border-t border-slate-100 bg-white z-20 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] pb-[max(1.25rem,env(safe-area-inset-bottom))]">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="py-3 rounded-2xl border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                id="cancel-order-proceed-btn"
                onClick={handleConfirm}
                disabled={!reasonCode || submitting}
                className={`py-3 rounded-2xl font-black flex items-center justify-center gap-2 transition-all ${
                  !reasonCode
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                    : "bg-rose-600 hover:bg-rose-700 text-white shadow-lg shadow-rose-200 active:scale-[0.98] cursor-pointer"
                }`}
              >
                {submitting && <Loader2 size={16} className="animate-spin" />}
                {!reasonCode
                  ? "Select a reason"
                  : isRequest
                    ? "Proceed to Request"
                    : "Proceed to Cancel"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CancelOrderModal;
