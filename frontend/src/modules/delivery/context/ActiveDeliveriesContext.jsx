import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { deliveryApi } from "../services/deliveryApi";
import { rawGet, rawSet, rawRemove } from "@core/utils/storage";
import { STORAGE_KEYS } from "@core/utils/storageKeys";
import { createSocketTokenReader, getStoredAuthToken } from "@core/utils/authStorage";
import { decodeToken } from "@core/utils/token";
import { onSocketConnect, onSocketEvent } from "@core/services/orderSocket";

/**
 * The rider's in-progress assignments, as the server sees them.
 *
 * The backend (GET /delivery/active-orders) is the only authority on whether
 * a delivery is active and which stage it is in. This provider re-asks it on
 * mount, app foreground, reconnect, relevant socket pings and a slow poll.
 * The last good answer is cached so a rider who loses signal still sees where
 * they were going — flagged as provisional and never used to authorize an
 * action (every workflow action is validated by the server anyway).
 */

const ActiveDeliveriesContext = createContext(null);

const FINAL_WORKFLOW = new Set(["DELIVERED", "CANCELLED"]);
const FINAL_RETURN = new Set(["returned", "qc_passed", "qc_failed", "refund_completed", "return_rejected"]);
const POLL_MS = 30000;

function riderIdFromToken() {
  const token = getStoredAuthToken(STORAGE_KEYS.AUTH_DELIVERY, { allowExpired: true });
  return token ? String(decodeToken(token)?.id || "") : "";
}

function readSnapshot(riderId) {
  try {
    const raw = rawGet(STORAGE_KEYS.DELIVERY_ACTIVE_ORDERS);
    const snap = raw ? JSON.parse(raw) : null;
    // Never show one rider's work to another account on a shared device.
    return snap && snap.riderId === riderId && Array.isArray(snap.orders) ? snap : null;
  } catch {
    return null;
  }
}

const refId = (ref) => (ref && typeof ref === "object" ? String(ref._id || "") : String(ref || ""));

export function ActiveDeliveriesProvider({ children }) {
  const navigate = useNavigate();
  const riderId = riderIdFromToken();
  const snapshot = useMemo(() => (riderId ? readSnapshot(riderId) : null), [riderId]);

  const [orders, setOrders] = useState(snapshot?.orders || []);
  const [meta, setMeta] = useState({
    canAcceptMore: snapshot?.canAcceptMore ?? true,
    maxActiveOrders: snapshot?.maxActiveOrders ?? 0,
  });
  // loading: nothing confirmed yet this session · ready: server-confirmed ·
  // stale: showing the last known list while the server is unreachable.
  const [status, setStatus] = useState(riderId ? "loading" : "ready");
  const [lastSyncedAt, setLastSyncedAt] = useState(snapshot?.syncedAt || null);
  const [resumingId, setResumingId] = useState(null);
  // Increments on every server-confirmed sync, so callers can wait for an
  // answer that is newer than their request (e.g. after app foreground).
  const [syncSeq, setSyncSeq] = useState(0);

  const inflight = useRef(null);
  const retryTimer = useRef(null);
  const failures = useRef(0);
  const resumeLock = useRef(false);
  const listeners = useRef(new Set());

  const refresh = useCallback(async () => {
    if (!riderIdFromToken()) {
      setOrders([]);
      setStatus("ready");
      return null;
    }
    if (inflight.current) return inflight.current;
    const run = (async () => {
      try {
        const res = await deliveryApi.getActiveOrders({ timeout: 12000 });
        const result = res.data?.result || {};
        const next = Array.isArray(result.orders) ? result.orders : [];
        setOrders(next);
        setMeta({
          canAcceptMore: result.canAcceptMore !== false,
          maxActiveOrders: result.maxActiveOrders || 0,
        });
        setStatus("ready");
        setSyncSeq((n) => n + 1);
        const syncedAt = new Date().toISOString();
        setLastSyncedAt(syncedAt);
        failures.current = 0;
        try {
          if (next.length) {
            rawSet(
              STORAGE_KEYS.DELIVERY_ACTIVE_ORDERS,
              JSON.stringify({ riderId: riderIdFromToken(), orders: next, canAcceptMore: result.canAcceptMore, maxActiveOrders: result.maxActiveOrders, syncedAt }),
            );
          } else {
            rawRemove(STORAGE_KEYS.DELIVERY_ACTIVE_ORDERS);
          }
        } catch {
          /* storage optional */
        }
        listeners.current.forEach((fn) => fn(next));
        return next;
      } catch (error) {
        const code = error?.response?.status;
        if (code === 401 || code === 403) {
          setStatus("ready");
          return null;
        }
        // Keep whatever we last knew; mark it provisional and retry with backoff.
        setStatus("stale");
        failures.current += 1;
        clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(
          () => refresh(),
          Math.min(30000, 3000 * 2 ** Math.min(failures.current - 1, 4)),
        );
        return null;
      } finally {
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, []);

  /** Subscribe to every successful sync (used by the layout's restore logic). */
  const onSynced = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  useEffect(() => {
    refresh();
    const getToken = createSocketTokenReader(STORAGE_KEYS.AUTH_DELIVERY);
    const ping = () => refresh();
    const offs = [
      onSocketConnect(getToken, ping),
      onSocketEvent(getToken, "communication:state", ping),
      onSocketEvent(getToken, "communication:revoked", ping),
      onSocketEvent(getToken, "order:status:update", ping),
    ];
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", ping);
    window.addEventListener("focus", ping);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("online", ping);
      window.removeEventListener("focus", ping);
      document.removeEventListener("visibilitychange", onVisible);
      clearTimeout(retryTimer.current);
    };
  }, [refresh]);

  // Slow poll while work is in progress — catches a cancellation or
  // reassignment even if the socket ping was missed.
  useEffect(() => {
    if (!orders.length) return undefined;
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);
    return () => clearInterval(iv);
  }, [orders.length, refresh]);

  /**
   * Re-open an active order on the screen for its *current* stage. Verifies
   * with the server first so a just-completed, cancelled or reassigned order
   * shows its final state instead of a dead workflow. Read-only: never
   * changes the order. Repeated taps are ignored while one is in flight.
   */
  const resume = useCallback(
    async (orderId) => {
      if (!orderId || resumeLock.current) return;
      resumeLock.current = true;
      setResumingId(orderId);
      try {
        const res = await deliveryApi.getOrderDetails(orderId);
        const order = res.data?.result || {};
        const me = riderIdFromToken();
        const isReturn = order.returnStatus && order.returnStatus !== "none" && refId(order.returnDeliveryBoy) === me;
        const mine = isReturn || refId(order.deliveryBoy) === me;
        const final = isReturn
          ? FINAL_RETURN.has(String(order.returnStatus))
          : FINAL_WORKFLOW.has(String(order.workflowStatus || "").toUpperCase()) ||
            ["delivered", "cancelled"].includes(String(order.status || "").toLowerCase());

        if (!mine) {
          toast.info(`Order #${orderId} is no longer assigned to you.`);
          refresh();
          return;
        }
        if (final) {
          const cancelled =
            String(order.workflowStatus || "").toUpperCase() === "CANCELLED" ||
            String(order.status || "").toLowerCase() === "cancelled";
          toast.info(cancelled ? `Order #${orderId} was cancelled.` : `Order #${orderId} is already completed.`);
          refresh();
          return;
        }
        navigate(`/delivery/order-details/${encodeURIComponent(orderId)}`);
      } catch (error) {
        const code = error?.response?.status;
        if (code === 404 || code === 403) {
          toast.info(`Order #${orderId} is no longer available to you.`);
          refresh();
        } else {
          toast.error("Couldn't reach the server. Check your connection and try again.");
        }
      } finally {
        resumeLock.current = false;
        setResumingId(null);
      }
    },
    [navigate, refresh],
  );

  const value = useMemo(
    () => ({
      orders,
      status,
      provisional: status === "stale",
      lastSyncedAt,
      canAcceptMore: meta.canAcceptMore,
      maxActiveOrders: meta.maxActiveOrders,
      refresh,
      resume,
      resumingId,
      onSynced,
      syncSeq,
    }),
    [orders, status, lastSyncedAt, meta, refresh, resume, resumingId, onSynced, syncSeq],
  );

  return <ActiveDeliveriesContext.Provider value={value}>{children}</ActiveDeliveriesContext.Provider>;
}

export function useActiveDeliveries() {
  const ctx = useContext(ActiveDeliveriesContext);
  if (!ctx) throw new Error("useActiveDeliveries must be used inside ActiveDeliveriesProvider");
  return ctx;
}

/** Human labels for server stages. */
export const STAGE_LABELS = {
  HEADING_TO_STORE: "Heading to store",
  AT_STORE: "At store · awaiting pickup",
  HEADING_TO_CUSTOMER: "Picked up · heading to customer",
  AT_CUSTOMER: "At customer · complete delivery",
  RETURN_TO_CUSTOMER: "Return · collect from customer",
  RETURN_TO_STORE: "Return · heading to store",
  RETURN_AT_STORE: "Return · hand over at store",
};
