import axiosInstance from "@core/api/axios";
import { STORAGE_KEYS } from "@core/utils/storageKeys";
import { createSocketTokenReader, getStoredAuthToken } from "@core/utils/authStorage";
import { decodeToken } from "@core/utils/token";

/**
 * Order communication client — customer/seller ↔ rider chat, native-dialer
 * contact, Report Issue and seller "Ready for Pickup". Every call is
 * re-authorized by the server against the live order and rider assignment;
 * nothing here is cached across calls.
 */

export const CHANNELS = Object.freeze({
  CUSTOMER_RIDER: "customer_rider",
  SELLER_RIDER: "seller_rider",
});

const ROLE_TOKEN_KEY = {
  customer: STORAGE_KEYS.AUTH_CUSTOMER,
  seller: STORAGE_KEYS.AUTH_SELLER,
  delivery: STORAGE_KEYS.AUTH_DELIVERY,
};

export function socketTokenReaderFor(role) {
  return createSocketTokenReader(ROLE_TOKEN_KEY[role] || STORAGE_KEYS.AUTH_CUSTOMER);
}

/** Current account id for `role`, from its stored token (used to scope local drafts). */
export function currentUserIdFor(role) {
  const token = getStoredAuthToken(ROLE_TOKEN_KEY[role], { allowExpired: true });
  return token ? String(decodeToken(token)?.id || "") : "";
}

const enc = encodeURIComponent;
const base = (orderId) => `/communication/orders/${enc(orderId)}`;
const chat = (orderId, channel) => `${base(orderId)}/chats/${enc(channel)}`;

export const communicationApi = {
  getState: (orderId) => axiosInstance.get(base(orderId)),
  listMessages: (orderId, channel, params) =>
    axiosInstance.get(`${chat(orderId, channel)}/messages`, { params }),
  sendMessage: (orderId, channel, body) =>
    // Generous timeout: a timed-out send is reconciled by clientMessageId.
    axiosInstance.post(`${chat(orderId, channel)}/messages`, body, { timeout: 20000 }),
  updateReceipts: (orderId, channel, body) =>
    axiosInstance.post(`${chat(orderId, channel)}/receipts`, body),
  getContact: (orderId, channel) => axiosInstance.post(`${chat(orderId, channel)}/contact`),
  reportIssue: (orderId, body) => axiosInstance.post(`${base(orderId)}/issues`, body),
  markReadyForPickup: (orderId) => axiosInstance.post(`${base(orderId)}/ready-for-pickup`),
  setReadyEta: (orderId, minutes) => axiosInstance.post(`${base(orderId)}/ready-eta`, { minutes }),

  // Operations
  adminEvents: (params) => axiosInstance.get("/communication/admin/events", { params }),
  adminIssues: (params) => axiosInstance.get("/communication/admin/issues", { params }),
  adminUpdateIssue: (id, body) => axiosInstance.patch(`/communication/admin/issues/${enc(id)}`, body),
  adminConversations: (orderId) =>
    axiosInstance.get(`/communication/admin/orders/${enc(orderId)}/conversations`),
};

export function newClientId(prefix = "m") {
  const rand =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}_${rand}`.slice(0, 64);
}

/** Server error → { status, code, message }. status 0 means no response (offline/timeout). */
export function describeError(error) {
  const status = error?.response?.status || 0;
  const body = error?.response?.data || {};
  return {
    status,
    code: body?.result?.code || (status ? "REQUEST_FAILED" : "NETWORK"),
    message:
      body?.message ||
      (status ? "Something went wrong" : "You appear to be offline. Check your connection."),
  };
}

export const ACCESS_LOST_CODES = new Set([
  "ACCESS_EXPIRED",
  "NOT_ASSIGNED_RIDER",
  "RIDER_NOT_ASSIGNED",
  "STATUS_NOT_ELIGIBLE",
  "CONVERSATION_CLOSED",
  "CHAT_DISABLED",
  "READ_ONLY",
]);
