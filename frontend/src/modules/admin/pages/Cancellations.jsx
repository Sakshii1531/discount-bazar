import React, { useCallback, useEffect, useState } from "react";
import Card from "@shared/components/ui/Card";
import Badge from "@shared/components/ui/Badge";
import Button from "@shared/components/ui/Button";
import Modal from "@shared/components/ui/Modal";
import Pagination from "@shared/components/ui/Pagination";
import { useToast } from "@shared/components/ui/Toast";
import ReturnInspectionForm from "@shared/components/cancellation/ReturnInspectionForm";
import { adminOrdersApi } from "../services/api/ordersApi";
import { formatAmount } from "@shared/utils/currency";
import { Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_VARIANT = {
  REQUESTED: "warning",
  UNDER_REVIEW: "warning",
  APPROVED: "info",
  CANCELLED: "error",
  REJECTED: "gray",
  WITHDRAWN: "gray",
  TRANSFERRED: "primary",
};
const REFUND_VARIANT = {
  NOT_REQUIRED: "gray",
  PENDING: "warning",
  PROCESSING: "warning",
  SUCCESSFUL: "success",
  FAILED: "error",
  MANUAL_REVIEW: "error",
};
const human = (s) => String(s || "—").replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const money = (v) => `₹${formatAmount(Number(v) || 0)}`;
const when = (d) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const result = (res) => res?.data?.result || res?.data?.data;

const FILTERS = [
  { key: "", label: "All" },
  { key: "REQUESTED,UNDER_REVIEW", label: "Pending review" },
  { key: "APPROVED", label: "Awaiting return" },
  { key: "CANCELLED", label: "Cancelled" },
  { key: "REJECTED", label: "Rejected" },
  { key: "TRANSFERRED", label: "Moved to disputes" },
];

/* ---------------------------------------------------------------- */

function CancellationDetail({ id, onClose, onChanged }) {
  const { showToast } = useToast();
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [showInspection, setShowInspection] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(result(await adminOrdersApi.getCancellation(id)));
    } catch (e) {
      showToast(e?.response?.data?.message || "Failed to load cancellation", "error");
    }
  }, [id, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (key, fn, success) => {
    setBusy(key);
    try {
      const res = await fn();
      setData(result(res));
      setNote("");
      setShowInspection(false);
      showToast(success, "success");
      onChanged?.();
    } catch (e) {
      showToast(e?.response?.data?.message || "Action failed", "error");
      await load();
      onChanged?.();
    } finally {
      setBusy("");
    }
  };

  if (!data) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="animate-spin text-slate-400" />
      </div>
    );
  }

  const open = ["REQUESTED", "UNDER_REVIEW"].includes(data.status);
  const refundFailed = ["FAILED", "MANUAL_REVIEW"].includes(data.refund?.status);
  const awaitingReturn = data.returnLeg?.status === "RETURN_TO_STORE";
  const awaitingInspection = ["AWAITING_INSPECTION", "AWAITING_RETURN"].includes(data.inventory?.status);

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Card contentClassName="p-4 space-y-1">
          <p className="text-xs font-bold uppercase text-slate-400">Order</p>
          <p className="font-bold">#{data.orderId}</p>
          <p>Order status: <b>{human(data.order?.workflowStatus || data.order?.status)}</b></p>
          <p>Payment: <b>{data.order?.paymentMode}</b> · {human(data.order?.paymentStatus)}</p>
          <p>Amount: <b>{money(data.orderAmount)}</b></p>
        </Card>
        <Card contentClassName="p-4 space-y-1">
          <p className="text-xs font-bold uppercase text-slate-400">People</p>
          <p>Customer: <b>{data.customer?.name || "—"}</b> {data.customer?.phone}</p>
          <p>Seller: <b>{data.seller?.shopName || "—"}</b></p>
          <p>Rider: <b>{data.deliveryBoy?.name || "—"}</b> {data.deliveryBoy?.phone}</p>
        </Card>
      </div>

      <Card contentClassName="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div><p className="text-xs text-slate-400">Status</p><Badge variant={STATUS_VARIANT[data.status]}>{human(data.status)}</Badge></div>
        <div><p className="text-xs text-slate-400">Type</p><b>{human(data.type)}</b></div>
        <div><p className="text-xs text-slate-400">Reason</p><b>{data.reasonLabel}</b>{data.reasonText ? <p className="text-xs text-slate-500">{data.reasonText}</p> : null}</div>
        <div><p className="text-xs text-slate-400">Requested</p>{when(data.requestedAt)}</div>
        <div><p className="text-xs text-slate-400">Cancelled</p>{when(data.cancelledAt)}</div>
        <div><p className="text-xs text-slate-400">Stage at request</p>{human(data.stageAtRequest)}</div>
        <div><p className="text-xs text-slate-400">Inventory</p>{human(data.inventory?.status)}</div>
        <div><p className="text-xs text-slate-400">Return leg</p>{human(data.returnLeg?.status)}</div>
        <div><p className="text-xs text-slate-400">Processing</p>{human(data.processing?.state)}{data.processing?.lastError ? <p className="text-[11px] text-rose-600">{data.processing.lastError}</p> : null}</div>
      </Card>

      <Card title="Refund" contentClassName="p-4 space-y-2">
        <div className="flex flex-wrap gap-4">
          <span>Status: <Badge variant={REFUND_VARIANT[data.refund?.status]}>{human(data.refund?.status)}</Badge></span>
          <span>Refundable: <b>{money(data.refund?.amount)}</b></span>
          <span>Paid wallet: {money(data.refund?.paidWallet)}</span>
          <span>Paid online: {money(data.refund?.paidGateway)}</span>
        </div>
        {data.refund?.deductions?.total > 0 && (
          <p className="text-xs text-slate-500">
            Deductions: delivery {money(data.refund.deductions.deliveryFee)}, handling {money(data.refund.deductions.handlingFee)}, tip {money(data.refund.deductions.tip)}, fee {money(data.refund.deductions.cancellationFee)}
          </p>
        )}
        {(data.refund?.allocations || []).map((a) => (
          <div key={a.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
            <span>{a.source} → {a.destination}</span>
            <span>{money(a.amount)}</span>
            <Badge variant={REFUND_VARIANT[a.status]}>{human(a.status)}</Badge>
            {a.gatewayRefundId && <span className="text-slate-500">ref {a.gatewayRefundId}</span>}
            {a.lastError && <span className="w-full text-rose-600">{a.lastError}</span>}
          </div>
        ))}
        {data.refundLastError && <p className="text-xs text-rose-600">{data.refundLastError}</p>}
        {data.manualResolution?.at && <p className="text-xs text-slate-500">Resolved manually {when(data.manualResolution.at)}: {data.manualResolution.note}</p>}
      </Card>

      <Card title="Settlement adjustments" contentClassName="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {["seller", "rider", "cod"].map((part) => (
          <div key={part}>
            <p className="text-xs font-bold uppercase text-slate-400">{part}</p>
            <p>{human(data.settlement?.[part]?.status)} · {money(data.settlement?.[part]?.amount)}</p>
            <p className="text-xs text-slate-500">{data.settlement?.[part]?.detail}</p>
          </div>
        ))}
      </Card>

      {(open || refundFailed || awaitingReturn || awaitingInspection) && (
        <Card title="Actions" contentClassName="p-4 space-y-3">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder={open ? "Decision note (required to reject)" : "Note"}
            className="w-full rounded-xl border border-slate-200 p-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            {data.status === "REQUESTED" && (
              <Button size="sm" variant="outline" isLoading={busy === "review"} onClick={() => act("review", () => adminOrdersApi.reviewCancellation(id), "Moved to review")}>
                Mark under review
              </Button>
            )}
            {open && (
              <>
                <Button size="sm" variant="danger" isLoading={busy === "approve"} onClick={() => act("approve", () => adminOrdersApi.approveCancellation(id, { note }), "Cancellation approved — rider told to return the parcel")}>
                  Approve & stop delivery
                </Button>
                <Button size="sm" variant="outline" isLoading={busy === "reject"} disabled={note.trim().length < 3} onClick={() => act("reject", () => adminOrdersApi.rejectCancellation(id, { reason: note }), "Request rejected")}>
                  Reject
                </Button>
              </>
            )}
            {refundFailed && (
              <>
                <Button size="sm" isLoading={busy === "retry"} onClick={() => act("retry", () => adminOrdersApi.retryCancellationRefund(id, { note }), "Refund retry started")}>
                  Retry refund
                </Button>
                <Button size="sm" variant="outline" isLoading={busy === "resolve"} disabled={note.trim().length < 3} onClick={() => act("resolve", () => adminOrdersApi.resolveCancellationRefund(id, { note }), "Refund marked resolved")}>
                  Mark resolved manually
                </Button>
              </>
            )}
            {awaitingReturn && (
              <Button size="sm" variant="outline" isLoading={busy === "return"} onClick={() => act("return", () => adminOrdersApi.confirmCancellationReturn(id, { note }), "Return to store confirmed")}>
                Confirm parcel returned
              </Button>
            )}
            {awaitingInspection && !showInspection && (
              <Button size="sm" variant="outline" onClick={() => setShowInspection(true)}>
                Inspect returned items
              </Button>
            )}
          </div>
          {showInspection && (
            <ReturnInspectionForm
              items={data.inventory?.items || []}
              submitting={busy === "inspect"}
              onCancel={() => setShowInspection(false)}
              onSubmit={(payload) => act("inspect", () => adminOrdersApi.inspectCancellationReturn(id, payload), "Inspection saved")}
            />
          )}
        </Card>
      )}

      <Card title="Audit log" contentClassName="p-0">
        <ol className="divide-y divide-slate-100">
          {(data.auditLog || []).slice().reverse().map((entry, i) => (
            <li key={`${entry.at}-${i}`} className="px-4 py-2 text-xs">
              <div className="flex flex-wrap justify-between gap-2">
                <b>{human(entry.action)}</b>
                <span className="text-slate-400">{when(entry.at)}</span>
              </div>
              <p className="text-slate-500">
                {entry.actorRole}{entry.actorId ? ` (${String(entry.actorId).slice(-6)})` : ""}
                {entry.previousStatus || entry.newStatus ? ` · ${entry.previousStatus || "—"} → ${entry.newStatus || "—"}` : ""}
                {entry.orderStatusBefore || entry.orderStatusAfter ? ` · order ${entry.orderStatusBefore || "—"} → ${entry.orderStatusAfter || "—"}` : ""}
              </p>
              {entry.financial && <p className="text-slate-500">{JSON.stringify(entry.financial)}</p>}
              {entry.note && <p className="text-slate-600">{entry.note}</p>}
            </li>
          ))}
        </ol>
      </Card>

      <Card title="Notifications" contentClassName="p-4 space-y-1">
        {(data.notifications || []).map((n) => (
          <div key={n.key} className="flex justify-between text-xs">
            <span>{human(n.event)}</span>
            <span className={n.status === "SENT" ? "text-emerald-600" : "text-amber-600"}>
              {human(n.status)}{n.attempts > 1 ? ` (${n.attempts} tries)` : ""}
            </span>
          </div>
        ))}
      </Card>
      <div className="flex justify-end"><Button variant="outline" size="sm" onClick={onClose}>Close</Button></div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

function CancellationList() {
  const { showToast } = useToast();
  const [filter, setFilter] = useState("REQUESTED,UNDER_REVIEW");
  const [refundFilter, setRefundFilter] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminOrdersApi.getCancellations({
        status: filter || undefined,
        refundStatus: refundFilter || undefined,
        q: q.trim() || undefined,
        page,
        limit: pageSize,
      });
      setData(result(res) || { items: [], total: 0, totalPages: 1 });
    } catch (e) {
      showToast(e?.response?.data?.message || "Failed to load cancellations", "error");
    } finally {
      setLoading(false);
    }
  }, [filter, refundFilter, q, page, pageSize, showToast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card contentClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-100">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => { setFilter(f.key); setPage(1); }}
            className={cn("px-3 py-1.5 rounded-full text-xs font-bold border", filter === f.key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200")}
          >
            {f.label}
          </button>
        ))}
        <select
          value={refundFilter}
          onChange={(e) => { setRefundFilter(e.target.value); setPage(1); }}
          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs"
        >
          <option value="">Any refund</option>
          <option value="PENDING,PROCESSING">Refund pending</option>
          <option value="FAILED,MANUAL_REVIEW">Refund failed</option>
          <option value="SUCCESSFUL">Refunded</option>
        </select>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
          placeholder="Order #"
          className="rounded-full border border-slate-200 px-3 py-1.5 text-xs w-36"
        />
        <button type="button" onClick={load} className="ml-auto p-2 rounded-full hover:bg-slate-100" aria-label="Refresh">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[860px]">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              {["Order", "Customer", "Seller / Rider", "Reason", "Status", "Order status", "Refund", "Inventory", "Requested"].map((h) => (
                <th key={h} className="px-4 py-2 text-left font-bold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.items.map((row) => (
              <tr key={row.id} onClick={() => setSelected(row.id)} className="cursor-pointer hover:bg-slate-50">
                <td className="px-4 py-2 font-bold">#{row.orderId}<p className="text-[11px] font-normal text-slate-400">{human(row.type)}</p></td>
                <td className="px-4 py-2">{row.customer?.name || "—"}<p className="text-[11px] text-slate-400">{row.customer?.phone}</p></td>
                <td className="px-4 py-2">{row.seller?.shopName || "—"}<p className="text-[11px] text-slate-400">{row.deliveryBoy?.name || "No rider"}</p></td>
                <td className="px-4 py-2">{row.reasonLabel}</td>
                <td className="px-4 py-2"><Badge variant={STATUS_VARIANT[row.status]}>{human(row.status)}</Badge></td>
                <td className="px-4 py-2 text-xs">{human(row.order?.workflowStatus || row.order?.status)}</td>
                <td className="px-4 py-2"><Badge variant={REFUND_VARIANT[row.refund?.status]}>{human(row.refund?.status)}</Badge><p className="text-[11px] text-slate-400">{money(row.refund?.amount)}</p></td>
                <td className="px-4 py-2 text-xs">{human(row.inventory?.status)}</td>
                <td className="px-4 py-2 text-xs text-slate-500">{when(row.requestedAt)}</td>
              </tr>
            ))}
            {!loading && data.items.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">No cancellations match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="p-4">
        <Pagination
          page={page}
          totalPages={data.totalPages || 1}
          total={data.total || 0}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          loading={loading}
        />
      </div>
      <Modal isOpen={Boolean(selected)} onClose={() => setSelected(null)} title="Cancellation" size="xl">
        {selected && <CancellationDetail id={selected} onClose={() => setSelected(null)} onChanged={load} />}
      </Modal>
    </Card>
  );
}

/* ---------------------------------------------------------------- */

function CancellationReports() {
  const [range, setRange] = useState({ from: "", to: "" });
  const [data, setData] = useState(null);

  useEffect(() => {
    adminOrdersApi
      .getCancellationReports({ from: range.from || undefined, to: range.to || undefined })
      .then((res) => setData(result(res)))
      .catch(() => setData(null));
  }, [range]);

  const tile = (label, value, sub) => (
    <Card contentClassName="p-4">
      <p className="text-xs font-bold uppercase text-slate-400">{label}</p>
      <p className="text-2xl font-black text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center text-sm">
        <label>From <input type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} className="ml-1 rounded-lg border border-slate-200 px-2 py-1" /></label>
        <label>To <input type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} className="ml-1 rounded-lg border border-slate-200 px-2 py-1" /></label>
      </div>
      {!data ? (
        <div className="flex justify-center py-10"><Loader2 className="animate-spin text-slate-400" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {tile("Total", data.total)}
            {tile("Open requests", data.openRequests)}
            {tile("Pending refunds", data.pendingRefunds.count, money(data.pendingRefunds.amount))}
            {tile("Refunded", data.refunds?.SUCCESSFUL?.count || 0, money(data.refunds?.SUCCESSFUL?.amount || 0))}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <Card title="By reason" contentClassName="p-4 space-y-2">
              {data.byReason.length === 0 && <p className="text-sm text-slate-400">No data</p>}
              {data.byReason.map((r) => {
                const pct = data.total ? Math.round((r.count / data.total) * 100) : 0;
                return (
                  <div key={r.code} className="text-sm">
                    <div className="flex justify-between"><span>{r.label}</span><b>{r.count}</b></div>
                    <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-slate-700" style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </Card>
            <Card title="By status / type" contentClassName="p-4 space-y-1 text-sm">
              {Object.entries(data.byStatus).map(([k, v]) => <div key={k} className="flex justify-between"><span>{human(k)}</span><b>{v}</b></div>)}
              <hr className="my-2" />
              {Object.entries(data.byType).map(([k, v]) => <div key={k} className="flex justify-between"><span>{human(k)}</span><b>{v}</b></div>)}
            </Card>
            <Card title="Settlement adjustments" contentClassName="p-4 space-y-1 text-sm">
              <div className="flex justify-between"><span>Seller payouts adjusted</span><b>{money(data.adjustments.sellerAdjusted)}</b></div>
              <div className="flex justify-between"><span>Rider adjustments / compensation</span><b>{money(data.adjustments.riderAdjusted)}</b></div>
              <div className="flex justify-between"><span>COD reconciliations</span><b>{money(data.adjustments.codAdjusted)}</b></div>
              <div className="flex justify-between"><span>Seller recoveries to review</span><b>{data.adjustments.sellerManualReview}</b></div>
              <div className="flex justify-between"><span>COD cases to review</span><b>{data.adjustments.codManualReview}</b></div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- */

const STAGE_FIELDS = [
  ["AWAITING_PAYMENT", "Awaiting online payment"],
  ["PENDING_ACCEPTANCE", "Placed, not yet accepted"],
  ["ACCEPTED", "Accepted / picking"],
  ["PACKED", "Packed / ready for pickup"],
  ["RIDER_ASSIGNED", "Rider assigned, travelling to store"],
  ["RIDER_AT_STORE", "Rider at store, pickup not confirmed"],
];
const BOOL_FIELDS = [
  ["selfCancelEnabled", "Allow customer self-cancellation (before pickup)"],
  ["allowRequestAfterPickup", "Allow cancellation requests after pickup"],
  ["allowWithdrawal", "Allow customers to withdraw pending requests"],
  ["refundDeliveryFeeBeforePickup", "Refund delivery fee — before pickup"],
  ["refundHandlingFeeBeforePickup", "Refund handling fee — before pickup"],
  ["refundTipBeforePickup", "Refund rider tip — before pickup"],
  ["refundDeliveryFeeAfterPickup", "Refund delivery fee — after pickup"],
  ["refundHandlingFeeAfterPickup", "Refund handling fee — after pickup"],
  ["refundTipAfterPickup", "Refund rider tip — after pickup"],
];
const MONEY_FIELDS = [
  ["cancellationFeeAfterAcceptance", "Cancellation fee after seller acceptance (₹)"],
  ["cancellationFeeAfterPickup", "Cancellation fee after pickup (₹)"],
  ["riderReturnCompensation", "Rider return-trip compensation (₹)"],
  ["paymentVerificationWindowHours", "Re-check unconfirmed payments for (hours)"],
];

function CancellationPolicy() {
  const { showToast } = useToast();
  const [policy, setPolicy] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    adminOrdersApi.getCancellationPolicy()
      .then((res) => setPolicy(result(res)?.policy))
      .catch(() => showToast("Failed to load policy", "error"));
  }, [showToast]);

  if (!policy) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-slate-400" /></div>;

  const set = (key, value) => setPolicy((p) => ({ ...p, [key]: value }));
  const save = async () => {
    setSaving(true);
    try {
      const res = await adminOrdersApi.updateCancellationPolicy(policy);
      setPolicy(result(res)?.policy);
      showToast("Cancellation policy saved", "success");
    } catch (e) {
      showToast(e?.response?.data?.message || "Failed to save policy", "error");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (checked, onChange, label, key) => (
    <label key={key} className="flex items-center justify-between gap-3 py-2 text-sm">
      <span>{label}</span>
      <input type="checkbox" checked={Boolean(checked)} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-slate-900" />
    </label>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="Self-cancellation stages" subtitle="After rider pickup, customers can only request cancellation for review." contentClassName="p-4 divide-y divide-slate-100">
        {STAGE_FIELDS.map(([stage, label]) =>
          toggle(policy.selfCancelStages?.[stage], (v) => set("selfCancelStages", { ...policy.selfCancelStages, [stage]: v }), label, stage),
        )}
      </Card>
      <Card title="Rules & refundable charges" contentClassName="p-4 divide-y divide-slate-100">
        {BOOL_FIELDS.map(([key, label]) => toggle(policy[key], (v) => set(key, v), label, key))}
      </Card>
      <Card title="Fees, compensation & refunds" contentClassName="p-4 space-y-3">
        {MONEY_FIELDS.map(([key, label]) => (
          <label key={key} className="flex items-center justify-between gap-3 text-sm">
            <span>{label}</span>
            <input type="number" min={0} value={policy[key]} onChange={(e) => set(key, e.target.value)} className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-right" />
          </label>
        ))}
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Online refunds go to</span>
          <select value={policy.onlineRefundDestination} onChange={(e) => set("onlineRefundDestination", e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1">
            <option value="WALLET">Customer wallet (instant)</option>
            <option value="ORIGINAL_SOURCE">Original payment method</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Deductions are taken from</span>
          <select value={policy.refundAllocation} onChange={(e) => set("refundAllocation", e.target.value)} className="rounded-lg border border-slate-200 px-2 py-1">
            <option value="WALLET_FIRST">Online portion (wallet refunded first)</option>
            <option value="GATEWAY_FIRST">Wallet portion (online refunded first)</option>
          </select>
        </label>
        <label className="block text-sm">
          Refund timeline shown to customers
          <textarea value={policy.prepaidRefundTimelineText} onChange={(e) => set("prepaidRefundTimelineText", e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-slate-200 p-2" />
        </label>
      </Card>
      <div className="lg:col-span-2 flex justify-end">
        <Button onClick={save} isLoading={saving}>Save policy</Button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- */

const TABS = [
  ["list", "Cancellations"],
  ["reports", "Reports"],
  ["policy", "Policy"],
];

const Cancellations = () => {
  const [tab, setTab] = useState("list");
  return (
    <div className="space-y-4 p-1">
      <div>
        <h1 className="text-xl font-black text-slate-900">Order Cancellations</h1>
        <p className="text-sm text-slate-500">Review requests, track refunds and returned parcels, and configure the cancellation policy.</p>
      </div>
      <div className="flex gap-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn("px-4 py-2 rounded-xl text-sm font-bold", tab === key ? "bg-slate-900 text-white" : "bg-white text-slate-600 border border-slate-200")}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "list" && <CancellationList />}
      {tab === "reports" && <CancellationReports />}
      {tab === "policy" && <CancellationPolicy />}
    </div>
  );
};

export default Cancellations;
