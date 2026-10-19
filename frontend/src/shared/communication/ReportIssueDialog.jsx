import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import Modal from "@shared/components/ui/Modal";
import { communicationApi, describeError, newClientId } from "./communicationApi";

/**
 * "Report Issue" for an order's communication flow. Reasons come from the
 * server config for this role and channel. Reporting never changes the order
 * status — it records the problem and routes it to support/operations.
 * The request id is fixed per dialog session so a retried submit is deduped.
 */
export default function ReportIssueDialog({ open, onClose, orderId, channel, reasons = [], onReported }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const requestId = useRef(newClientId("i"));

  useEffect(() => {
    if (open) {
      setReason("");
      setNote("");
      setError(null);
      setDone(false);
      requestId.current = newClientId("i");
    }
  }, [open]);

  const submit = async () => {
    if (!reason) {
      setError("Please choose a reason.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await communicationApi.reportIssue(orderId, {
        channel,
        reason,
        note: note.trim(),
        clientRequestId: requestId.current,
      });
      setDone(true);
      onReported?.(res.data?.result?.issue);
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Report an issue"
      size="sm"
      footer={
        done ? (
          <button type="button" onClick={onClose} className="w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white">
            Close
          </button>
        ) : (
          <div className="flex w-full gap-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              Submit report
            </button>
          </div>
        )
      }
    >
      {done ? (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <CheckCircle2 className="text-emerald-600" size={36} />
          <p className="font-semibold text-slate-900">Thanks — we've received your report.</p>
          <p className="text-sm text-slate-500">Our support team will look into it. This does not change your order status.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold text-slate-800">What went wrong?</legend>
            {reasons.map((r) => (
              <label
                key={r.code}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                  reason === r.code ? "border-rose-400 bg-rose-50" : "border-slate-200"
                }`}
              >
                <input
                  type="radio"
                  name="issue-reason"
                  value={r.code}
                  checked={reason === r.code}
                  onChange={() => setReason(r.code)}
                  className="accent-rose-600"
                />
                {r.label}
              </label>
            ))}
          </fieldset>
          <div>
            <label htmlFor="issue-note" className="mb-1 block text-sm font-semibold text-slate-800">
              Details <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              id="issue-note"
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 500))}
              rows={3}
              placeholder="Add a short explanation. Avoid sharing personal details."
              className="w-full resize-none rounded-xl border border-slate-200 p-3 text-sm outline-none focus:border-slate-400"
            />
            <p className="mt-1 text-right text-xs text-slate-400">{note.length}/500</p>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
