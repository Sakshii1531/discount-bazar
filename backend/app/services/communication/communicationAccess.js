/**
 * Pure access rules for order communication. No I/O — every input comes from
 * the live order document and the resolved config, so the same function backs
 * the HTTP routes, socket joins, and the notification relevance re-check.
 */
import {
  COMM_CHANNEL,
  COMM_ROLE,
} from "../../constants/orderCommunication.js";
import { workflowFromLegacyStatus } from "../../constants/orderWorkflow.js";

export const ACCESS_REASON = Object.freeze({
  CHANNEL_INVALID: "CHANNEL_INVALID",
  CHANNEL_NOT_FOR_ROLE: "CHANNEL_NOT_FOR_ROLE",
  NOT_A_PARTY: "NOT_A_PARTY",
  NOT_ASSIGNED_RIDER: "NOT_ASSIGNED_RIDER",
  RIDER_NOT_ASSIGNED: "RIDER_NOT_ASSIGNED",
  STATUS_NOT_ELIGIBLE: "STATUS_NOT_ELIGIBLE",
  CHAT_DISABLED: "CHAT_DISABLED",
});

export function normalizeCommRole(role) {
  const r = String(role || "").toLowerCase();
  if (r === "user" || r === "customer") return COMM_ROLE.CUSTOMER;
  if (r === "seller") return COMM_ROLE.SELLER;
  if (r === "delivery") return COMM_ROLE.RIDER;
  if (r === "admin") return COMM_ROLE.ADMIN;
  return null;
}

export function idString(ref) {
  if (!ref) return "";
  if (typeof ref === "object" && ref._id) return String(ref._id);
  return String(ref);
}

export function orderWorkflowStatus(order) {
  if (order?.workflowVersion >= 2 && order.workflowStatus) return order.workflowStatus;
  return order?.workflowStatus || workflowFromLegacyStatus(order?.status);
}

/** Channels a role participates in, in display order. */
export function channelsForRole(role) {
  if (role === COMM_ROLE.CUSTOMER) return [COMM_CHANNEL.CUSTOMER_RIDER];
  if (role === COMM_ROLE.SELLER) return [COMM_CHANNEL.SELLER_RIDER];
  if (role === COMM_ROLE.RIDER) {
    return [COMM_CHANNEL.SELLER_RIDER, COMM_CHANNEL.CUSTOMER_RIDER];
  }
  return [];
}

/**
 * Is `role`/`userId` a party to `channel` on this order right now?
 * Independent of order status — used by issue reporting, which stays open
 * even after chat closes.
 */
export function partyCheck({ role, userId, order, channel }) {
  if (!Object.values(COMM_CHANNEL).includes(channel)) {
    return ACCESS_REASON.CHANNEL_INVALID;
  }
  if (!channelsForRole(role).includes(channel)) {
    return ACCESS_REASON.CHANNEL_NOT_FOR_ROLE;
  }
  const uid = String(userId || "");
  if (!uid) return ACCESS_REASON.NOT_A_PARTY;

  if (role === COMM_ROLE.CUSTOMER && idString(order.customer) !== uid) {
    return ACCESS_REASON.NOT_A_PARTY;
  }
  if (role === COMM_ROLE.SELLER && idString(order.seller) !== uid) {
    return ACCESS_REASON.NOT_A_PARTY;
  }
  if (role === COMM_ROLE.RIDER && idString(order.deliveryBoy) !== uid) {
    // Covers riders who were reassigned away and riders who were never on it.
    return ACCESS_REASON.NOT_ASSIGNED_RIDER;
  }
  return null;
}

/**
 * Full access decision for one channel.
 *  - allowed:  may read the current assignment's conversation
 *  - canSend:  may post messages (active stage only)
 *  - canCall:  may fetch the counterpart's number for the native dialer
 */
export function evaluateChannelAccess({ role, userId, order, channel, config }) {
  const base = {
    channel,
    allowed: false,
    canSend: false,
    canCall: false,
    readOnly: false,
    reason: null,
    riderId: idString(order?.deliveryBoy) || null,
    workflowStatus: orderWorkflowStatus(order),
  };

  const partyReason = partyCheck({ role, userId, order, channel });
  if (partyReason) return { ...base, reason: partyReason };

  if (!base.riderId) {
    return { ...base, reason: ACCESS_REASON.RIDER_NOT_ASSIGNED };
  }

  const ws = base.workflowStatus;
  const active = config.activeStatuses?.[channel] || [];
  const history = config.historyStatuses?.[channel] || [];

  if (active.includes(ws)) {
    if (!config.chatEnabled && !config.callEnabled) {
      return { ...base, reason: ACCESS_REASON.CHAT_DISABLED };
    }
    return {
      ...base,
      allowed: true,
      canSend: Boolean(config.chatEnabled),
      canCall: Boolean(config.callEnabled),
      reason: config.chatEnabled ? null : ACCESS_REASON.CHAT_DISABLED,
    };
  }

  if (history.includes(ws)) {
    return {
      ...base,
      allowed: true,
      readOnly: true,
      reason: ACCESS_REASON.STATUS_NOT_ELIGIBLE,
    };
  }

  return { ...base, reason: ACCESS_REASON.STATUS_NOT_ELIGIBLE };
}

/** Which receipt bucket on the conversation belongs to this role. */
export function receiptSideForRole(role) {
  return role === COMM_ROLE.RIDER ? "rider" : "counterpart";
}
