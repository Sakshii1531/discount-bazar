import React, { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2, Search, ShieldAlert, MessageSquare, Flag, History } from "lucide-react";
import Card from "@shared/components/ui/Card";
import Badge from "@shared/components/ui/Badge";
import { useToast } from "@shared/components/ui/Toast";
import { communicationApi } from "@shared/communication/communicationApi";

/**
 * Operations review for order communication: pickup/delivery issue reports,
 * the communication audit trail (assignment changes, pickup-ready, pickup
 * confirmation, access revocation, suppressed/failed notifications), and —
 * on explicit request — an order's chat transcript. Opening a transcript is
 * audit-logged server-side.
 *
 * Normal phone calls happen outside the platform, so no call records exist
 * here; only "contact number requested" events are shown.
 */

const EVENT_LABELS = {
  RIDER_ASSIGNED: "Rider assigned",
  RIDER_REASSIGNED: "Rider reassigned",
  SELLER_MARKED_READY: "Seller marked ready",
  SELLER_READY_ETA: "Seller gave ready time",
  RIDER_ARRIVED_AT_PICKUP: "Rider arrived at store",
  PICKUP_CONFIRMED: "Pickup confirmed",
  ISSUE_REPORTED: "Issue reported",
  ISSUE_ESCALATED: "Issue escalated",
  ISSUE_UPDATED: "Issue updated",
  ACCESS_REVOKED: "Chat access revoked",
  CONVERSATION_CLOSED: "Conversation closed",
  CONTACT_NUMBER_REQUESTED: "Contact number requested",
  NOTIFICATION_SUPPRESSED: "Notification suppressed (obsolete)",
  NOTIFICATION_FAILED: "Notification failed",
  ADMIN_VIEWED_CONVERSATION: "Admin viewed transcript",
};

const fmt = (iso) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

const issueVariant = (status) =>
  status === "resolved" ? "success" : status === "acknowledged" ? "warning" : "error";

export default function OrderCommunications() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [orderQuery, setOrderQuery] = useState(searchParams.get("orderId") || "");
  const orderId = searchParams.get("orderId") || "";
  const [statusFilter, setStatusFilter] = useState("open");
  const [issues, setIssues] = useState([]);
  const [events, setEvents] = useState({ items: [], notificationFailures: [] });
  const [transcript, setTranscript] = useState(null);
  const [loading, setLoading] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    setTranscript(null);
    try {
      const [iRes, eRes] = await Promise.all([
        communicationApi.adminIssues({ status: statusFilter || undefined, orderId: orderId || undefined, limit: 100 }),
        communicationApi.adminEvents({ orderId: orderId || undefined, limit: 100 }),
      ]);
      setIssues(iRes.data?.result?.items || []);
      setEvents(eRes.data?.result || { items: [], notificationFailures: [] });
    } catch (err) {
      showToast(err?.response?.data?.message || "Failed to load communication data", "error");
    } finally {
      setLoading(false);
    }
  }, [orderId, statusFilter, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const updateIssue = async (issue, status) => {
    try {
      await communicationApi.adminUpdateIssue(issue.id, { status });
      showToast(`Issue marked ${status}`, "success");
      load();
    } catch (err) {
      showToast(err?.response?.data?.message || "Update failed", "error");
    }
  };

  const viewTranscript = async () => {
    if (!orderId) return;
    setTranscriptLoading(true);
    try {
      const res = await communicationApi.adminConversations(orderId);
      setTranscript(res.data?.result || null);
    } catch (err) {
      showToast(err?.response?.data?.message || "Could not load transcript", "error");
    } finally {
      setTranscriptLoading(false);
    }
  };

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-black text-slate-900">Order Communications</h1>
          <p className="text-sm text-slate-500">
            Pickup and delivery issue reports, rider assignment changes and chat access events.
          </p>
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const next = orderQuery.trim();
            setSearchParams(next ? { orderId: next } : {});
          }}
        >
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={orderQuery}
              onChange={(e) => setOrderQuery(e.target.value)}
              placeholder="Filter by order ID"
              className="w-56 rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-400"
            />
          </div>
          <button type="submit" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            Apply
          </button>
        </form>
      </div>

      {loading ? (
        <div className="flex justify-center py-16 text-slate-400">
          <Loader2 className="animate-spin" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-bold text-slate-900">
                <Flag size={16} /> Issue reports
              </h2>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-slate-200 px-2 py-1 text-sm"
              >
                <option value="open">Open</option>
                <option value="acknowledged">Acknowledged</option>
                <option value="resolved">Resolved</option>
                <option value="">All</option>
              </select>
            </div>
            {!issues.length ? (
              <p className="py-8 text-center text-sm text-slate-400">No issues.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {issues.map((issue) => (
                  <li key={issue.id} className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">
                          {issue.reason.replace(/_/g, " ").toLowerCase()}
                          {issue.escalatedAt && (
                            <span className="ml-2 inline-flex items-center gap-1 text-xs font-bold text-rose-600">
                              <ShieldAlert size={12} /> escalated
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">
                          <button
                            type="button"
                            className="font-semibold text-slate-700 underline"
                            onClick={() => {
                              setOrderQuery(issue.orderId);
                              setSearchParams({ orderId: issue.orderId });
                            }}
                          >
                            #{issue.orderId}
                          </button>{" "}
                          · by {issue.reporterRole === "delivery" ? "rider" : issue.reporterRole} · {fmt(issue.createdAt)}
                        </p>
                        {issue.note && <p className="mt-1 text-sm text-slate-600">{issue.note}</p>}
                      </div>
                      <Badge variant={issueVariant(issue.status)}>{issue.status}</Badge>
                    </div>
                    {issue.status !== "resolved" && (
                      <div className="mt-2 flex gap-2">
                        {issue.status === "open" && (
                          <button type="button" onClick={() => updateIssue(issue, "acknowledged")} className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold">
                            Acknowledge
                          </button>
                        )}
                        <button type="button" onClick={() => updateIssue(issue, "resolved")} className="rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white">
                          Resolve
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 flex items-center gap-2 font-bold text-slate-900">
              <History size={16} /> Event trail {orderId ? `· #${orderId}` : "(latest)"}
            </h2>
            {!events.items.length ? (
              <p className="py-8 text-center text-sm text-slate-400">No events.</p>
            ) : (
              <ol className="space-y-2">
                {events.items.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800">{EVENT_LABELS[e.type] || e.type}</p>
                      <p className="text-xs text-slate-500">
                        {!orderId && `#${e.orderId} · `}
                        {e.actorRole}
                        {e.meta?.channel ? ` · ${e.meta.channel.replace("_", " ↔ ")}` : ""}
                        {e.meta?.reason ? ` · ${String(e.meta.reason).replace(/_/g, " ").toLowerCase()}` : ""}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-slate-400">{fmt(e.createdAt)}</span>
                  </li>
                ))}
              </ol>
            )}
            {orderId && events.notificationFailures?.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Undelivered notifications</p>
                {events.notificationFailures.map((n) => (
                  <p key={n.id} className="text-xs text-slate-600">
                    {n.type} → {n.role}: {n.status} ({n.reason || "unknown"}) · {fmt(n.createdAt)}
                  </p>
                ))}
              </div>
            )}
            <p className="mt-4 text-xs text-slate-400">
              Phone calls use the normal mobile network and are not recorded or tracked by the platform.
            </p>
          </Card>
        </div>
      )}

      {orderId && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-bold text-slate-900">
              <MessageSquare size={16} /> Chat transcript · #{orderId}
            </h2>
            {!transcript && (
              <button
                type="button"
                onClick={viewTranscript}
                disabled={transcriptLoading}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold"
              >
                {transcriptLoading && <Loader2 size={14} className="animate-spin" />}
                View transcript
              </button>
            )}
          </div>
          {!transcript ? (
            <p className="text-sm text-slate-500">
              Transcripts contain private messages. Open them only when needed to resolve an issue — each view is logged.
            </p>
          ) : !transcript.conversations.length ? (
            <p className="text-sm text-slate-400">No conversations for this order.</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {transcript.conversations.map((c) => (
                <div key={c.id} className="rounded-2xl border border-slate-100 p-3">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                    {c.channel === "customer_rider" ? "Customer ↔ Rider" : "Seller ↔ Rider"} · {c.status}
                    {c.closedReason ? ` (${c.closedReason.replace(/_/g, " ").toLowerCase()})` : ""}
                  </p>
                  <div className="max-h-72 space-y-1.5 overflow-y-auto">
                    {c.messages.map((m) => (
                      <p key={m.id} className="text-sm">
                        <span className="font-semibold text-slate-700">{m.senderRole === "delivery" ? "Rider" : m.senderRole}:</span>{" "}
                        <span className="text-slate-600">{m.text}</span>{" "}
                        <span className="text-xs text-slate-400">{fmt(m.createdAt)}</span>
                      </p>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
