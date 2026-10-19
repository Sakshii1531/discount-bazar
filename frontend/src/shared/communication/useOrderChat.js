import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rawGet, rawSet, rawRemove } from "@core/utils/storage";
import { KEY_PREFIXES } from "@core/utils/storageKeys";
import {
  emitSocket,
  onSocketConnect,
  onSocketEvent,
} from "@core/services/orderSocket";
import {
  ACCESS_LOST_CODES,
  communicationApi,
  currentUserIdFor,
  describeError,
  newClientId,
  socketTokenReaderFor,
} from "./communicationApi";

/**
 * One order conversation (customer ↔ rider or seller ↔ rider).
 *
 * Correctness rules this hook follows:
 *  - Order comes from the server `seq`, never local time.
 *  - Messages are de-duplicated by server id, so repeated socket events,
 *    notifications and resyncs never produce copies.
 *  - A send keeps the same clientMessageId across retries; the server returns
 *    the already-stored copy instead of creating a second one.
 *  - After a reconnect we fetch everything after our last seq *before*
 *    retrying unsent messages, so a send whose response was lost is
 *    reconciled rather than resent.
 *  - "Delivered"/"Read" ticks come only from the recipient app's receipts.
 *  - Unsent drafts live in sessionStorage scoped to role + account + order,
 *    and are wiped on logout (clearOnLogout).
 */

const outboxKey = (role, userId, orderId, channel) =>
  `${KEY_PREFIXES.ORDER_CHAT_OUTBOX}${role}:${userId}:${orderId}:${channel}`;

function loadOutbox(key) {
  try {
    const raw = rawGet(key, { storage: "session" });
    const parsed = raw ? JSON.parse(raw) : [];
    // Anything that was mid-flight when the page died is now "unknown".
    return Array.isArray(parsed)
      ? parsed.map((m) => (m.status === "sending" ? { ...m, status: "unknown" } : m))
      : [];
  } catch {
    return [];
  }
}

function mergeMessages(prev, incoming) {
  if (!incoming.length) return prev;
  const byId = new Map(prev.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => a.seq - b.seq);
}

export function useOrderChat({ orderId, channel, role, enabled = true, onAccessLost }) {
  const userId = useMemo(() => currentUserIdFor(role), [role]);
  const key = outboxKey(role, userId, orderId, channel);
  const getToken = useMemo(() => socketTokenReaderFor(role), [role]);

  const [messages, setMessages] = useState([]);
  const [outbox, setOutbox] = useState(() => (userId ? loadOutbox(key) : []));
  const [conversation, setConversation] = useState(null);
  const [access, setAccess] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const outboxRef = useRef(outbox);
  outboxRef.current = outbox;
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;
  const lastReceiptRef = useRef({ delivered: 0, read: 0 });
  const onAccessLostRef = useRef(onAccessLost);
  onAccessLostRef.current = onAccessLost;

  const persistOutbox = useCallback(
    (updater) => {
      setOutbox((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater;
        try {
          if (next.length) rawSet(key, JSON.stringify(next), { storage: "session" });
          else rawRemove(key, { storage: "session" });
        } catch {
          /* storage unavailable — keep in memory */
        }
        return next;
      });
    },
    [key],
  );

  /** Drop drafts the server already stored (matched by clientMessageId). */
  const reconcileOutbox = useCallback(
    (serverMessages) => {
      const stored = new Set(
        serverMessages.filter((m) => m.mine && m.clientMessageId).map((m) => m.clientMessageId),
      );
      if (!stored.size) return;
      persistOutbox((prev) => prev.filter((o) => !stored.has(o.clientMessageId)));
    },
    [persistOutbox],
  );

  const handleAccessError = useCallback((info) => {
    if (info.status === 404 || ACCESS_LOST_CODES.has(info.code)) {
      onAccessLostRef.current?.(info);
      return true;
    }
    return false;
  }, []);

  const sendReceipts = useCallback(
    async (list) => {
      const peerMax = list.filter((m) => !m.mine).reduce((max, m) => Math.max(max, m.seq), 0);
      if (!peerMax) return;
      const visible = typeof document === "undefined" || document.visibilityState === "visible";
      const body = {};
      if (peerMax > lastReceiptRef.current.delivered) body.deliveredUpToSeq = peerMax;
      if (visible && peerMax > lastReceiptRef.current.read) body.readUpToSeq = peerMax;
      if (!Object.keys(body).length) return;
      try {
        const res = await communicationApi.updateReceipts(orderId, channel, body);
        lastReceiptRef.current = {
          delivered: Math.max(lastReceiptRef.current.delivered, body.deliveredUpToSeq || 0),
          read: Math.max(lastReceiptRef.current.read, body.readUpToSeq || 0),
        };
        if (res.data?.result?.conversation) setConversation(res.data.result.conversation);
      } catch {
        /* receipts are best-effort; the next sync retries */
      }
    },
    [orderId, channel],
  );

  /** Initial page (no cursor) or forward sync after `afterSeq`. */
  const sync = useCallback(
    async ({ afterSeq } = {}) => {
      if (!orderId || !enabled) return false;
      setSyncing(true);
      try {
        let cursor = afterSeq;
        let collected = [];
        // Forward sync pages until caught up; initial load takes the newest page.
        for (let page = 0; page < 20; page += 1) {
          const params = cursor != null ? { afterSeq: cursor } : {};
          const res = await communicationApi.listMessages(orderId, channel, params);
          const result = res.data?.result || {};
          const rows = result.messages || [];
          collected = collected.concat(rows);
          setAccess(result.access || null);
          setConversation(result.conversation || null);
          if (cursor == null) setHasMore(Boolean(result.hasMore));
          if (cursor == null || !result.hasMore || !rows.length) break;
          cursor = rows[rows.length - 1].seq;
        }
        setMessages((prev) => (afterSeq == null ? mergeMessages([], collected) : mergeMessages(prev, collected)));
        reconcileOutbox(collected);
        setError(null);
        sendReceipts(afterSeq == null ? collected : mergeMessages(messagesRef.current, collected));
        return true;
      } catch (err) {
        const info = describeError(err);
        if (!handleAccessError(info)) setError(info);
        return false;
      } finally {
        setSyncing(false);
        setLoading(false);
      }
    },
    [orderId, channel, enabled, reconcileOutbox, sendReceipts, handleAccessError],
  );

  const deliver = useCallback(
    async (entry) => {
      persistOutbox((prev) =>
        prev.map((o) => (o.clientMessageId === entry.clientMessageId ? { ...o, status: "sending", error: null } : o)),
      );
      try {
        const res = await communicationApi.sendMessage(orderId, channel, {
          clientMessageId: entry.clientMessageId,
          text: entry.text,
        });
        const message = res.data?.result?.message;
        if (message) setMessages((prev) => mergeMessages(prev, [message]));
        persistOutbox((prev) => prev.filter((o) => o.clientMessageId !== entry.clientMessageId));
        return true;
      } catch (err) {
        const info = describeError(err);
        const lost = handleAccessError(info);
        persistOutbox((prev) =>
          prev.map((o) =>
            o.clientMessageId === entry.clientMessageId
              ? {
                  ...o,
                  // No response: the server may or may not have stored it.
                  status: info.status === 0 ? "unknown" : "failed",
                  retryable: !lost && (info.status === 0 || info.status === 429 || info.status >= 500),
                  error: info.message,
                }
              : o,
          ),
        );
        return false;
      }
    },
    [orderId, channel, persistOutbox, handleAccessError],
  );

  const send = useCallback(
    (text) => {
      const trimmed = String(text || "").trim();
      if (!trimmed) return false;
      const entry = {
        clientMessageId: newClientId("m"),
        text: trimmed,
        status: "sending",
        createdAt: new Date().toISOString(),
      };
      persistOutbox((prev) => [...prev, entry]);
      deliver(entry);
      return true;
    },
    [persistOutbox, deliver],
  );

  const retry = useCallback(
    async (clientMessageId) => {
      const entry = outboxRef.current.find((o) => o.clientMessageId === clientMessageId);
      if (!entry) return;
      // Reconcile first: the "failed" send may already be on the server.
      const lastSeq = messagesRef.current.reduce((max, m) => Math.max(max, m.seq), 0);
      await sync({ afterSeq: lastSeq });
      if (outboxRef.current.some((o) => o.clientMessageId === clientMessageId)) {
        await deliver(entry);
      }
    },
    [sync, deliver],
  );

  const discard = useCallback(
    (clientMessageId) => persistOutbox((prev) => prev.filter((o) => o.clientMessageId !== clientMessageId)),
    [persistOutbox],
  );

  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current[0]?.seq;
    if (!oldest || oldest <= 1) return;
    try {
      const res = await communicationApi.listMessages(orderId, channel, { beforeSeq: oldest });
      const result = res.data?.result || {};
      setMessages((prev) => mergeMessages(prev, result.messages || []));
      setHasMore(Boolean(result.hasMore));
    } catch (err) {
      setError(describeError(err));
    }
  }, [orderId, channel]);

  // Initial load + realtime wiring.
  useEffect(() => {
    if (!orderId || !enabled || !userId) return undefined;
    setLoading(true);
    setMessages([]);
    lastReceiptRef.current = { delivered: 0, read: 0 };
    sync();

    const viewing = () => emitSocket(getToken, "chat:viewing", { orderId, channel });
    viewing();

    const isThisChat = (p) => String(p?.orderId) === String(orderId) && p?.channel === channel;
    const resyncForward = async () => {
      const lastSeq = messagesRef.current.reduce((max, m) => Math.max(max, m.seq), 0);
      const ok = await sync({ afterSeq: lastSeq });
      // Only now — after reconciling — retry what is still unsent.
      if (ok) {
        for (const entry of outboxRef.current) {
          if (entry.status === "unknown" || (entry.status === "failed" && entry.retryable)) {
            await deliver(entry);
          }
        }
      }
    };

    const offMessage = onSocketEvent(getToken, "chat:message", (msg) => {
      if (!isThisChat(msg)) return;
      const conv = conversationRef.current;
      if (conv && conv.id !== msg.conversationId) {
        // Belongs to a different assignment's thread — re-ask the server.
        sync();
        return;
      }
      const lastSeq = messagesRef.current.reduce((max, m) => Math.max(max, m.seq), 0);
      setMessages((prev) => mergeMessages(prev, [msg]));
      if (msg.mine) reconcileOutbox([msg]);
      else sendReceipts([msg]);
      // A gap means we missed something while the socket was flaky.
      if (lastSeq && msg.seq > lastSeq + 1) resyncForward();
    });
    const offReceipt = onSocketEvent(getToken, "chat:receipt", (r) => {
      if (!isThisChat(r)) return;
      setConversation((prev) => {
        if (!prev || prev.id !== r.conversationId) return prev;
        const mySide = role === "delivery" ? "rider" : "counterpart";
        if (r.side === mySide) {
          return { ...prev, receipts: { ...prev.receipts, myReadSeq: Math.max(prev.receipts?.myReadSeq || 0, r.readSeq) } };
        }
        return {
          ...prev,
          receipts: {
            ...prev.receipts,
            peerDeliveredSeq: Math.max(prev.receipts?.peerDeliveredSeq || 0, r.deliveredSeq),
            peerReadSeq: Math.max(prev.receipts?.peerReadSeq || 0, r.readSeq),
          },
        };
      });
    });
    const offConnect = onSocketConnect(getToken, () => {
      viewing();
      resyncForward();
    });
    const goOnline = () => {
      setOnline(true);
      resyncForward();
    };
    const goOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        viewing();
        sendReceipts(messagesRef.current);
      } else {
        emitSocket(getToken, "chat:not_viewing");
      }
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      emitSocket(getToken, "chat:not_viewing");
      offMessage();
      offReceipt();
      offConnect();
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, channel, enabled, userId]);

  /** Status of one of *my* stored messages, from the peer's receipts only. */
  const statusOf = useCallback(
    (message) => {
      if (!message.mine) return null;
      const r = conversation?.receipts || {};
      if (message.seq <= (r.peerReadSeq || 0)) return "read";
      if (message.seq <= (r.peerDeliveredSeq || 0)) return "delivered";
      return "sent";
    },
    [conversation],
  );

  return {
    messages,
    outbox,
    conversation,
    access,
    loading,
    syncing,
    hasMore,
    error,
    online,
    send,
    retry,
    discard,
    loadOlder,
    resync: () => sync(),
    statusOf,
  };
}

export default useOrderChat;
