import { useState } from "react";
import { Phone, Loader2, AlertTriangle } from "lucide-react";
import Modal from "@shared/components/ui/Modal";
import { communicationApi, describeError } from "./communicationApi";
import { CALL_DISCLOSURE_FALLBACK } from "./labels";

/**
 * Normal phone call via the device's native dialer.
 *
 * Every tap shows the disclosure first; the number is fetched from the server
 * only after the user confirms (the server re-checks the live assignment and
 * order stage), and the dialer opens once per confirmation. Nothing is called
 * automatically, and we never claim the call was answered or completed.
 */
export default function CallContactButton({
  orderId,
  channel,
  label = "Call",
  disabled,
  className = "",
  children,
  onAccessLost,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const confirmCall = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await communicationApi.getContact(orderId, channel);
      const phone = String(res.data?.result?.phone || "").replace(/[^\d+]/g, "");
      if (!phone) throw new Error("no-number");
      setOpen(false);
      // A tel: link is the only call mechanism — no background calling.
      const link = document.createElement("a");
      link.href = `tel:${phone}`;
      link.rel = "noopener";
      link.click();
    } catch (err) {
      const info = err?.message === "no-number"
        ? { status: 404, code: "CONTACT_UNAVAILABLE", message: "A contact number is not available. You can still use in-app chat." }
        : describeError(err);
      if (info.status === 404 && info.code !== "CONTACT_UNAVAILABLE") onAccessLost?.(info);
      if (info.status === 403) onAccessLost?.(info);
      setError(info.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={label}
        className={className}
      >
        {children || (
          <>
            <Phone size={16} />
            <span>{label}</span>
          </>
        )}
      </button>
      <Modal
        isOpen={open}
        onClose={close}
        title="Make a normal phone call?"
        size="sm"
        footer={
          <div className="flex w-full gap-2">
            <button
              type="button"
              onClick={close}
              className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmCall}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Phone size={16} />}
              Open dialer
            </button>
          </div>
        }
      >
        <p className="text-sm leading-relaxed text-slate-600">{CALL_DISCLOSURE_FALLBACK}</p>
        <p className="mt-2 text-xs text-slate-500">Standard carrier charges may apply. In-app chat stays available.</p>
        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </Modal>
    </>
  );
}
