import { Loader2, MapPin, Navigation, PackageCheck, RefreshCw, Store, WifiOff, Undo2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useActiveDeliveries, STAGE_LABELS } from "../context/ActiveDeliveriesContext";

const PICKUP_STAGES = new Set(["HEADING_TO_STORE", "AT_STORE"]);

function ActiveDeliveryCard({ order, onResume, resuming, disabled }) {
  const isReturn = order.kind === "return";
  const pickupPending = PICKUP_STAGES.has(order.stage);
  return (
    <div className="rounded-3xl border-2 border-primary bg-white p-4 shadow-lg shadow-primary/10">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">
            {isReturn ? "Return in progress" : "Active delivery in progress"}
          </p>
          <h3 className="truncate text-lg font-black text-slate-900">#{order.orderId}</h3>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
          {STAGE_LABELS[order.stage] || "In progress"}
        </span>
      </div>

      <div className="mb-4 space-y-2 text-sm">
        {order.store && (
          <div className="flex items-start gap-2">
            <Store size={15} className="mt-0.5 shrink-0 text-orange-500" />
            <div className="min-w-0">
              <p className="font-semibold text-slate-800">
                {isReturn ? "Return to: " : pickupPending ? "Pick up from: " : ""}
                {order.store.name}
              </p>
              {order.store.address && <p className="truncate text-xs text-slate-500">{order.store.address}</p>}
            </div>
          </div>
        )}
        {order.customer && (
          <div className="flex items-start gap-2">
            <MapPin size={15} className="mt-0.5 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <p className="font-semibold text-slate-800">
                {isReturn ? "Collect from: " : "Deliver to: "}
                {order.customer.name}
              </p>
              {order.customer.address && <p className="truncate text-xs text-slate-500">{order.customer.address}</p>}
            </div>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={() => onResume(order.orderId)}
        disabled={disabled}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-black uppercase tracking-widest text-white shadow-md disabled:opacity-60"
      >
        {resuming ? <Loader2 size={18} className="animate-spin" /> : <Navigation size={18} />}
        Resume {isReturn ? "Return" : "Delivery"}
      </button>
    </div>
  );
}

/**
 * Dashboard section for work the rider has already accepted. Rendered above
 * the new-order search, fed only by the server's active-assignment list, and
 * never touched by new-order search results.
 */
export default function ActiveDeliveriesSection() {
  const { orders, status, provisional, resume, resumingId, refresh } = useActiveDeliveries();

  if (status === "loading" && !orders.length) {
    return (
      <div className="flex items-center gap-3 rounded-3xl border border-slate-100 bg-white p-4 text-sm text-slate-500 shadow-sm">
        <Loader2 size={18} className="animate-spin text-primary" />
        Checking for active deliveries…
      </div>
    );
  }
  if (!orders.length) return null;

  return (
    <section aria-label="Active deliveries" className="space-y-3">
      {orders.length > 1 && (
        <div className="flex items-center gap-2 px-1">
          <PackageCheck size={16} className="text-primary" />
          <h2 className="text-sm font-black text-slate-800">{orders.length} active deliveries</h2>
        </div>
      )}
      {provisional && (
        <div className="flex items-center justify-between gap-2 rounded-2xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          <span className="flex items-center gap-2">
            <WifiOff size={14} /> Last known status — refreshing…
          </span>
          <button type="button" onClick={refresh} className="flex items-center gap-1 font-bold">
            <RefreshCw size={12} /> Retry
          </button>
        </div>
      )}
      {orders.map((order) => (
        <ActiveDeliveryCard
          key={`${order.kind}:${order.orderId}`}
          order={order}
          onResume={resume}
          resuming={resumingId === order.orderId}
          disabled={Boolean(resumingId)}
        />
      ))}
    </section>
  );
}

/** Slim banner for other rider tabs (earnings, profile…) so active work is one tap away. */
export function ActiveDeliveryBanner() {
  const { orders, resume, resumingId } = useActiveDeliveries();
  const navigate = useNavigate();
  if (!orders.length) return null;
  const first = orders[0];
  return (
    <button
      type="button"
      // Several orders: let the rider pick on the dashboard rather than guessing.
      onClick={() => (orders.length > 1 ? navigate("/delivery/dashboard") : resume(first.orderId))}
      disabled={Boolean(resumingId)}
      className="sticky top-0 z-40 flex w-full items-center justify-between gap-2 bg-primary px-4 py-2.5 text-left text-white shadow-md"
    >
      <span className="flex min-w-0 items-center gap-2 text-xs font-bold">
        {first.kind === "return" ? <Undo2 size={15} /> : <Navigation size={15} />}
        <span className="truncate">
          {orders.length > 1 ? `${orders.length} active deliveries` : `Active delivery #${first.orderId}`}
        </span>
      </span>
      <span className="shrink-0 rounded-full bg-white/20 px-3 py-1 text-[11px] font-black uppercase tracking-wider">
        {resumingId ? "Opening…" : "Resume"}
      </span>
    </button>
  );
}
