import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Loader2,
  RotateCw,
  Send,
  WifiOff,
  X,
  Flag,
  Lock,
} from "lucide-react";
import Modal from "@shared/components/ui/Modal";
import { useOrderChat } from "./useOrderChat";

const timeOf = (iso) => {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
};

function Ticks({ status }) {
  // Only states the server has actually confirmed are shown.
  if (status === "read") return <CheckCheck size={14} className="text-sky-300" aria-label="Read" />;
  if (status === "delivered") return <CheckCheck size={14} className="opacity-70" aria-label="Delivered" />;
  return <Check size={14} className="opacity-70" aria-label="Sent" />;
}

/**
 * Order-specific chat with the currently assigned counterpart. Shows clear
 * empty / loading / offline / pending / failed / read-only / expired states.
 */
export default function OrderChatSheet({
  open,
  onClose,
  orderId,
  channel,
  role,
  title,
  counterpartName,
  canSend,
  maxLength = 500,
  onReportIssue,
  onAccessLost,
}) {
  const [draft, setDraft] = useState("");
  const [expired, setExpired] = useState(null);
  const listRef = useRef(null);

  const chat = useOrderChat({
    orderId,
    channel,
    role,
    enabled: open,
    onAccessLost: (info) => {
      setExpired(info);
      onAccessLost?.(info);
    },
  });

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.outbox.length, open]);

  const writable = canSend && !expired && chat.access?.canSend !== false;

  const submit = (e) => {
    e?.preventDefault();
    if (!writable) return;
    if (chat.send(draft.slice(0, maxLength))) setDraft("");
  };

  const status = !chat.online
    ? { icon: WifiOff, text: "You're offline. Messages will be sent when you reconnect.", tone: "bg-amber-50 text-amber-800" }
    : expired
    ? {
        icon: Lock,
        text:
          expired.status === 404
            ? "You no longer have access to this conversation."
            : expired.message || "This conversation is no longer active.",
        tone: "bg-slate-100 text-slate-700",
      }
    : !writable
    ? { icon: Lock, text: "This conversation is read-only.", tone: "bg-slate-100 text-slate-700" }
    : chat.error
    ? { icon: AlertCircle, text: chat.error.message, tone: "bg-rose-50 text-rose-700" }
    : null;

  return (
    <Modal
      isOpen={open}
      onClose={() => {
        setExpired(null); // the next open re-checks access from scratch
        onClose();
      }}
      title={title}
      size="md"
    >
      <div className="-mx-4 -my-3.5 flex h-[65vh] flex-col sm:-mx-6">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{counterpartName || "—"}</p>
            <p className="text-xs text-slate-500">Order #{orderId}</p>
          </div>
          {onReportIssue && (
            <button
              type="button"
              onClick={onReportIssue}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-rose-600 hover:bg-rose-50"
            >
              <Flag size={13} /> Report issue
            </button>
          )}
        </div>

        {status && (
          <div className={`flex items-start gap-2 px-4 py-2 text-xs sm:px-6 ${status.tone}`} role="status">
            <status.icon size={14} className="mt-0.5 shrink-0" />
            <span>{status.text}</span>
          </div>
        )}

        <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto bg-slate-50 px-4 py-3 sm:px-6">
          {chat.hasMore && (
            <button type="button" onClick={chat.loadOlder} className="mx-auto block text-xs font-semibold text-slate-500">
              Load earlier messages
            </button>
          )}
          {chat.loading && !expired ? (
            <div className="flex h-full items-center justify-center text-slate-400">
              <Loader2 className="animate-spin" size={22} />
            </div>
          ) : !chat.messages.length && !chat.outbox.length ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-sm text-slate-400">
              <p>No messages yet.</p>
              {writable && <p className="mt-1 text-xs">Messages are linked to this order only.</p>}
            </div>
          ) : null}

          {chat.messages.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  m.mine ? "rounded-br-sm bg-slate-900 text-white" : "rounded-bl-sm bg-white text-slate-800"
                }`}
              >
                {m.text}
                <span className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${m.mine ? "text-white/70" : "text-slate-400"}`}>
                  {timeOf(m.createdAt)}
                  {m.mine && <Ticks status={chat.statusOf(m)} />}
                </span>
              </div>
            </div>
          ))}

          {chat.outbox.map((o) => (
            <div key={o.clientMessageId} className="flex justify-end">
              <div className="max-w-[80%]">
                <div
                  className={`whitespace-pre-wrap break-words rounded-2xl rounded-br-sm px-3 py-2 text-sm ${
                    o.status === "sending" ? "bg-slate-700 text-white/90" : "border border-rose-200 bg-rose-50 text-rose-900"
                  }`}
                >
                  {o.text}
                  <span className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-80">
                    {o.status === "sending" ? (
                      <>
                        <Clock size={12} /> Sending…
                      </>
                    ) : o.status === "unknown" ? (
                      <>
                        <AlertCircle size={12} /> Not confirmed
                      </>
                    ) : (
                      <>
                        <AlertCircle size={12} /> Not sent
                      </>
                    )}
                  </span>
                </div>
                {o.status !== "sending" && (
                  <div className="mt-1 flex justify-end gap-3 text-xs">
                    {o.error && <span className="text-rose-600">{o.error}</span>}
                    {writable && (
                      <button type="button" onClick={() => chat.retry(o.clientMessageId)} className="inline-flex items-center gap-1 font-semibold text-slate-700">
                        <RotateCw size={12} /> Retry
                      </button>
                    )}
                    <button type="button" onClick={() => chat.discard(o.clientMessageId)} className="inline-flex items-center gap-1 text-slate-500">
                      <X size={12} /> Remove
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={submit} className="flex items-end gap-2 border-t border-slate-100 bg-white px-4 py-3 sm:px-6">
          <div className="flex-1">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) submit(e);
              }}
              rows={1}
              maxLength={maxLength}
              disabled={!writable}
              placeholder={writable ? "Type a message" : "Messaging is closed"}
              aria-label="Message"
              className="max-h-28 w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400 disabled:bg-slate-50"
            />
            {draft.length > maxLength * 0.8 && (
              <p className="text-right text-[10px] text-slate-400">
                {draft.length}/{maxLength}
              </p>
            )}
          </div>
          <button
            type="submit"
            disabled={!writable || !draft.trim()}
            aria-label="Send message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white disabled:opacity-40"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </Modal>
  );
}
