import { useCallback, useEffect, useRef, useState } from "react";
import { onSocketConnect, onSocketEvent } from "@core/services/orderSocket";
import { communicationApi, describeError, socketTokenReaderFor } from "./communicationApi";

/**
 * Live communication state for one order, from the server's point of view:
 * which channels are open, read-only or unavailable, who is assigned, unread
 * counts, and pickup readiness. Refetched on mount, on every socket
 * (re)connect, when the device comes back online / to the foreground, and on
 * any `communication:*` or `chat:message` ping for this order — so a stale
 * assignment cached on the device never drives the UI.
 */
export function useOrderCommunication(orderId, role) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(Boolean(orderId));
  const [error, setError] = useState(null);
  const inflight = useRef(null);

  const refresh = useCallback(async () => {
    if (!orderId) return null;
    if (inflight.current) return inflight.current;
    const run = (async () => {
      try {
        const res = await communicationApi.getState(orderId);
        const next = res.data?.result || null;
        setState(next);
        setError(null);
        return next;
      } catch (err) {
        const info = describeError(err);
        // Lost access: drop everything we knew, never keep stale controls.
        if (info.status === 404 || info.status === 403) setState(null);
        setError(info);
        return null;
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, [orderId]);

  useEffect(() => {
    setState(null);
    setLoading(Boolean(orderId));
    if (!orderId) return undefined;
    refresh();

    const getToken = socketTokenReaderFor(role);
    const matches = (payload) => !payload?.orderId || String(payload.orderId) === String(orderId);
    const ping = (payload) => {
      if (matches(payload)) refresh();
    };
    const offs = [
      onSocketEvent(getToken, "communication:state", ping),
      onSocketEvent(getToken, "communication:revoked", ping),
      onSocketEvent(getToken, "chat:message", ping),
      onSocketEvent(getToken, "order:status:update", ping),
      onSocketConnect(getToken, () => refresh()),
    ];
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [orderId, role, refresh]);

  const channel = useCallback(
    (name) => state?.channels?.find((c) => c.channel === name) || null,
    [state],
  );

  return { state, loading, error, refresh, channel };
}

export default useOrderCommunication;
