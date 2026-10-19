import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Flag, Loader2, MessageCircle, PackageCheck, Phone, Search } from "lucide-react";
import { useOrderCommunication } from "./useOrderCommunication";
import OrderChatSheet from "./OrderChatSheet";
import CallContactButton from "./CallContactButton";
import ReportIssueDialog from "./ReportIssueDialog";
import { channelLabels, unavailableMessage } from "./labels";
import { communicationApi, describeError } from "./communicationApi";

const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * Seller pickup readiness. "Ready for Pickup" is validated server-side and is
 * idempotent; it never moves the order to picked up. If no rider is assigned
 * yet the flag is kept and delivered to whoever is assigned next.
 */
function SellerPickupReadiness({ orderId, pickup, assigned, refresh }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [eta, setEta] = useState("10");

  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(describeError(err).message);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  if (pickup.pickupConfirmedAt) {
    return (
      <p className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-700">
        <CheckCircle2 size={16} /> Picked up at {fmtTime(pickup.pickupConfirmedAt)}
      </p>
    );
  }
  if (pickup.sellerReadyAt) {
    return (
      <p className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-700">
        <CheckCircle2 size={16} /> Marked ready at {fmtTime(pickup.sellerReadyAt)}
        {!assigned && <span className="font-normal text-slate-500">· rider will be notified on assignment</span>}
      </p>
    );
  }
  if (!pickup.canMarkReady) return null;

  return (
    <div className="mb-3 space-y-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => run(() => communicationApi.markReadyForPickup(orderId))}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <PackageCheck size={16} />}
        Mark ready for pickup
      </button>
      {assigned && (
        <div className="flex items-center gap-2 text-sm">
          <Clock size={15} className="text-slate-400" />
          <span className="text-slate-600">Not ready? Ready in</span>
          <select
            value={eta}
            onChange={(e) => setEta(e.target.value)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm"
            aria-label="Minutes until ready"
          >
            {["5", "10", "15", "20", "30", "45"].map((m) => (
              <option key={m} value={m}>{m} min</option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => communicationApi.setReadyEta(orderId, Number(eta)))}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700"
          >
            Tell rider
          </button>
        </div>
      )}
      {pickup.sellerReadyEtaAt && (
        <p className="text-xs text-slate-500">Rider told: ready by {fmtTime(pickup.sellerReadyEtaAt)}</p>
      )}
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}

/**
 * Contact controls for one order channel (customer ↔ rider or seller ↔ rider):
 * chat with unread badge, normal call, and Report Issue. Everything is driven
 * by the server's live access decision — buttons disappear the moment the
 * order closes or the rider changes, and the assignment is re-checked right
 * before the chat opens.
 *
 * Pass `comm` (from useOrderCommunication) to share one state fetch between
 * several panels on the same screen.
 */
export default function OrderContactPanel({
  orderId,
  role,
  channel,
  comm: sharedComm,
  autoOpenChat = false,
  tone = "light",
  className = "",
  showHeading = true,
}) {
  const ownComm = useOrderCommunication(sharedComm ? null : orderId, role);
  const comm = sharedComm || ownComm;
  const { state, loading, refresh, channel: channelOf } = comm;
  const [chatOpen, setChatOpen] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  const ch = channelOf(channel);
  const labels = channelLabels(role, channel);
  const reasons = state?.issueReasons?.[channel] || [];
  const dark = tone === "dark";

  const openChat = async () => {
    setOpening(true);
    const fresh = await refresh(); // never trust a cached assignment
    setOpening(false);
    const next = fresh?.channels?.find((c) => c.channel === channel);
    if (next?.allowed) setChatOpen(true);
  };

  useEffect(() => {
    if (autoOpenChat && ch?.allowed && !chatOpen) setChatOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenChat, ch?.allowed]);

  // Close an open chat if access is withdrawn underneath it.
  useEffect(() => {
    if (chatOpen && state && !ch?.allowed) setChatOpen(false);
  }, [chatOpen, state, ch?.allowed]);

  const btn = dark
    ? "bg-white/20 text-white border border-white/30 hover:bg-white/30"
    : "bg-slate-900 text-white hover:bg-slate-800";
  const ghost = dark
    ? "text-white/90 hover:bg-white/10"
    : "text-slate-700 border border-slate-200 bg-white hover:bg-slate-50";

  if (loading && !state) {
    return (
      <div className={`flex items-center gap-2 text-sm ${dark ? "text-white/80" : "text-slate-500"} ${className}`}>
        <Loader2 size={16} className="animate-spin" /> Checking contact options…
      </div>
    );
  }
  if (!state || !ch) return null;

  const active = ch.allowed && !ch.readOnly;
  const waiting = ch.reason === "RIDER_NOT_ASSIGNED";

  return (
    <div className={className}>
      {showHeading && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-xs font-semibold uppercase tracking-wide ${dark ? "text-white/70" : "text-slate-500"}`}>
              {labels.heading}
            </p>
            {ch.counterpartName && (
              <p className={`truncate text-sm font-bold ${dark ? "text-white" : "text-slate-900"}`}>{ch.counterpartName}</p>
            )}
          </div>
        </div>
      )}

      {role === "seller" && state.pickup && (
        <SellerPickupReadiness
          orderId={state.orderId}
          pickup={state.pickup}
          assigned={state.assignment?.assigned}
          refresh={refresh}
        />
      )}

      {!active && (
        <p className={`mb-2 flex items-start gap-2 text-sm ${dark ? "text-white/85" : "text-slate-600"}`}>
          {waiting && <Search size={15} className="mt-0.5 shrink-0" />}
          {unavailableMessage({ role, channelState: ch, assignment: state.assignment })}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {ch.allowed && (
          <button
            type="button"
            onClick={openChat}
            disabled={opening}
            className={`relative inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${active ? btn : ghost}`}
          >
            {opening ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />}
            {active ? "Chat" : "View messages"}
            {ch.unread > 0 && (
              <span className="absolute -right-1.5 -top-1.5 min-w-[20px] rounded-full bg-rose-500 px-1.5 text-center text-[11px] font-bold leading-5 text-white">
                {ch.unread > 9 ? "9+" : ch.unread}
              </span>
            )}
          </button>
        )}
        {ch.canCall && (
          <CallContactButton
            orderId={orderId}
            channel={channel}
            label={labels.callLabel}
            onAccessLost={refresh}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${ghost}`}
          >
            <Phone size={16} /> Call
          </CallContactButton>
        )}
        {reasons.length > 0 && (
          <button
            type="button"
            onClick={() => setIssueOpen(true)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition ${ghost}`}
          >
            <Flag size={15} /> Report issue
          </button>
        )}
      </div>

      <OrderChatSheet
        open={chatOpen}
        onClose={() => {
          setChatOpen(false);
          refresh();
        }}
        orderId={state.orderId}
        channel={channel}
        role={role}
        title={labels.chatTitle}
        counterpartName={ch.counterpartName}
        canSend={ch.canSend}
        maxLength={state.config?.messageMaxLength || 500}
        onReportIssue={reasons.length ? () => setIssueOpen(true) : undefined}
        onAccessLost={refresh}
      />
      <ReportIssueDialog
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        orderId={state.orderId}
        channel={channel}
        reasons={reasons}
        onReported={refresh}
      />
    </div>
  );
}
