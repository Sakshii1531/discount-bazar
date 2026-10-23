import { useCallback, useEffect, useState } from "react";
import { XCircle, Clock, CheckCircle2, AlertCircle, HelpCircle, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { customerApi } from "../../services/customerApi";
import { formatAmount } from "@shared/utils/currency";
import CancelOrderModal from "./CancelOrderModal";

const REFUND_LABELS = {
  NOT_REQUIRED: { text: "No refund needed", tone: "text-slate-600" },
  PENDING: { text: "Refund pending", tone: "text-amber-700" },
  PROCESSING: { text: "Refund processing", tone: "text-amber-700" },
  SUCCESSFUL: { text: "Refund successful", tone: "text-emerald-700" },
  FAILED: { text: "Refund delayed — our team is on it", tone: "text-rose-700" },
  MANUAL_REVIEW: { text: "Refund under review by our team", tone: "text-rose-700" },
};

const money = (v) => `₹${formatAmount(Number(v) || 0)}`;

function RefundStatus({ refund }) {
  if (!refund?.status) return null;
  const label = REFUND_LABELS[refund.status] || { text: refund.status, tone: "text-slate-600" };
  return (
    <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm space-y-1">
      <div className="flex justify-between">
        <span className="text-slate-500">Refund</span>
        <span className={`font-bold ${label.tone}`}>{label.text}</span>
      </div>
      {refund.amount > 0 && (
        <div className="flex justify-between">
          <span className="text-slate-500">Amount</span>
          <span className="font-bold text-slate-900">{money(refund.amount)}</span>
        </div>
      )}
      {(refund.allocations || []).map((a) => (
        <div key={a.id} className="flex justify-between text-xs text-slate-500">
          <span>{a.destination === "WALLET" ? "To wallet" : "To original payment method"}</span>
          <span>
            {money(a.amount)} · {(REFUND_LABELS[a.status]?.text || a.status).replace(/^Refund /, "")}
          </span>
        </div>
      ))}
      {refund.awaitingPaymentConfirmation && (
        <p className="text-xs text-slate-500">We are confirming your online payment with the bank. Any amount deducted will be refunded automatically.</p>
      )}
    </div>
  );
}

/**
 * Cancellation section of the order page. Always asks the backend what is
 * allowed (on mount, on order status changes and when the app comes back to
 * the foreground), so cached screens never show an invalid action.
 */
const OrderCancellationCard = ({ orderId, refreshKey, onChanged, onContactSupport, autoOpen = false }) => {
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const [autoOpened, setAutoOpened] = useState(false);

  const load = useCallback(async () => {
    if (!orderId) return null;
    try {
      const res = await customerApi.getOrderCancellation(orderId);
      const next = res.data?.result || res.data?.data || null;
      setDetails(next);
      return next;
    } catch {
      setDetails(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", load);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", load);
    };
  }, [load]);

  useEffect(() => {
    if (!autoOpen || autoOpened || !details) return;
    setAutoOpened(true);
    if (details.eligibility?.canSelfCancel || details.eligibility?.canRequest) setShowModal(true);
  }, [autoOpen, autoOpened, details]);

  // Re-check right before opening: the order may have moved on since load.
  const openModal = async () => {
    const fresh = await load();
    if (fresh?.eligibility?.canSelfCancel || fresh?.eligibility?.canRequest) {
      setShowModal(true);
    } else if (fresh?.eligibility?.message) {
      toast.info(fresh.eligibility.message);
    }
  };

  const handleDone = async () => {
    await load();
    onChanged?.();
  };

  const handleWithdraw = async () => {
    if (withdrawing) return;
    setWithdrawing(true);
    try {
      await customerApi.withdrawOrderCancellation(orderId);
      toast.success("Cancellation request withdrawn. Your order continues as planned.");
      await handleDone();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not withdraw the request");
      await load();
    } finally {
      setWithdrawing(false);
    }
  };

  if (loading || !details) return null;
  const { eligibility, cancellation } = details;
  const status = cancellation?.status;

  let body = null;
  if (status === "CANCELLED" || status === "APPROVED") {
    body = (
      <>
        <div className="flex items-start gap-3">
          <XCircle className="text-rose-600 shrink-0" size={22} />
          <div>
            <p className="font-black text-slate-900">Order cancelled</p>
            <p className="text-sm text-slate-600">
              {cancellation.reasonLabel}
              {cancellation.reasonText ? ` — ${cancellation.reasonText}` : ""}
            </p>
            {status === "APPROVED" && cancellation.returnLeg?.status !== "INSPECTED" && (
              <p className="text-xs text-slate-500 mt-1">
                The parcel is being returned to the store. Your refund is processed once the store receives it.
              </p>
            )}
          </div>
        </div>
        <RefundStatus refund={cancellation.refund} />
      </>
    );
  } else if (status === "REQUESTED" || status === "UNDER_REVIEW") {
    body = (
      <>
        <div className="flex items-start gap-3">
          <Clock className="text-amber-600 shrink-0" size={22} />
          <div>
            <p className="font-black text-slate-900">
              {status === "UNDER_REVIEW" ? "Cancellation under review" : "Cancellation requested"}
            </p>
            <p className="text-sm text-slate-600">Our support team is reviewing your request. Your order stays active until a decision is made.</p>
          </div>
        </div>
        {eligibility?.canWithdraw && (
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={withdrawing}
            className="mt-3 w-full py-3 rounded-2xl border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {withdrawing ? <Loader2 size={16} className="animate-spin" /> : <Undo2 size={16} />}
            Withdraw request
          </button>
        )}
      </>
    );
  } else if (status === "REJECTED") {
    body = (
      <>
        <div className="flex items-start gap-3">
          <AlertCircle className="text-rose-600 shrink-0" size={22} />
          <div>
            <p className="font-black text-slate-900">Cancellation request declined</p>
            {cancellation.decisionNote && <p className="text-sm text-slate-600">{cancellation.decisionNote}</p>}
            <p className="text-xs text-slate-500 mt-1">Your order will be delivered as planned.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onContactSupport}
          className="mt-3 w-full py-3 rounded-2xl border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-2"
        >
          <HelpCircle size={16} /> Contact support
        </button>
      </>
    );
  } else if (status === "TRANSFERRED") {
    body = (
      <div className="flex items-start gap-3">
        <CheckCircle2 className="text-slate-600 shrink-0" size={22} />
        <div>
          <p className="font-black text-slate-900">Order delivered</p>
          <p className="text-sm text-slate-600">Your order was delivered before we could review the cancellation. Our support team will help with a return or refund.</p>
        </div>
      </div>
    );
  } else if (eligibility?.action === "SELF_CANCEL" || eligibility?.action === "REQUEST") {
    body = (
      <>
        {eligibility.action === "REQUEST" && (
          <p className="text-sm text-slate-600 mb-3">{eligibility.message}</p>
        )}
        <button
          type="button"
          id="order-detail-cancel-btn"
          onClick={openModal}
          className="w-full py-3.5 rounded-2xl border-2 border-rose-200 bg-white text-rose-600 font-black hover:bg-rose-50 transition-all flex items-center justify-center gap-2 text-sm active:scale-[0.98]"
        >
          <XCircle size={18} />
          {eligibility.action === "REQUEST" ? "Request cancellation" : "Cancel order"}
        </button>
      </>
    );
  } else if (eligibility?.action === "CONTACT_SUPPORT") {
    body = (
      <>
        <p className="text-sm text-slate-600">{eligibility.message}</p>
        <button
          type="button"
          onClick={onContactSupport}
          className="mt-3 w-full py-3 rounded-2xl border-2 border-slate-200 font-bold text-slate-700 hover:bg-slate-50 flex items-center justify-center gap-2"
        >
          <HelpCircle size={16} /> Contact support
        </button>
      </>
    );
  }

  if (!body) return null;
  const framed = Boolean(status) || eligibility?.action === "CONTACT_SUPPORT";

  return (
    <>
      <div className={framed ? "bg-white rounded-3xl p-5 shadow-sm border border-slate-100" : ""}>{body}</div>
      <CancelOrderModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        orderId={orderId}
        details={details}
        onDone={handleDone}
      />
    </>
  );
};

export default OrderCancellationCard;
