/**
 * Order communication (in-app chat + native-dialer calling) — the single
 * source of truth for who may talk to whom, and when.
 *
 * Customer, seller and rider apps never hardcode these rules: they read the
 * resolved config from GET /api/communication/config and the per-order
 * access decision from GET /api/communication/orders/:orderId. The server
 * re-checks the same rules on every chat, receipt, contact and issue call.
 *
 * Values here are defaults. Env vars override them per deployment, and the
 * admin-editable `Setting.communication` sub-document overrides both (see
 * services/communication/communicationConfig.js).
 */
import { WORKFLOW_STATUS } from "./orderWorkflow.js";

export const COMM_CHANNEL = Object.freeze({
  CUSTOMER_RIDER: "customer_rider",
  SELLER_RIDER: "seller_rider",
});

export const COMM_ROLE = Object.freeze({
  CUSTOMER: "customer",
  SELLER: "seller",
  RIDER: "delivery",
  ADMIN: "admin",
});

/** Which non-rider party sits on the other side of each channel. */
export const CHANNEL_COUNTERPART_ROLE = Object.freeze({
  [COMM_CHANNEL.CUSTOMER_RIDER]: COMM_ROLE.CUSTOMER,
  [COMM_CHANNEL.SELLER_RIDER]: COMM_ROLE.SELLER,
});

/**
 * Statuses in which a channel is open for new messages and calls. Both
 * channels additionally require a rider to be assigned to the order.
 */
export const DEFAULT_ACTIVE_STATUSES = Object.freeze({
  [COMM_CHANNEL.CUSTOMER_RIDER]: [
    WORKFLOW_STATUS.DELIVERY_ASSIGNED,
    WORKFLOW_STATUS.PICKUP_READY,
    WORKFLOW_STATUS.OUT_FOR_DELIVERY,
  ],
  [COMM_CHANNEL.SELLER_RIDER]: [
    WORKFLOW_STATUS.DELIVERY_ASSIGNED,
    WORKFLOW_STATUS.PICKUP_READY,
  ],
});

/**
 * Statuses in which an existing conversation stays visible as read-only
 * history to the parties who were on it at the end. Nobody can send.
 */
export const DEFAULT_HISTORY_STATUSES = Object.freeze({
  [COMM_CHANNEL.CUSTOMER_RIDER]: [
    WORKFLOW_STATUS.DELIVERED,
    WORKFLOW_STATUS.CANCELLED,
  ],
  [COMM_CHANNEL.SELLER_RIDER]: [
    WORKFLOW_STATUS.OUT_FOR_DELIVERY,
    WORKFLOW_STATUS.DELIVERED,
    WORKFLOW_STATUS.CANCELLED,
  ],
});

/** Seller may mark "Ready for Pickup" only while the order is still pre-pickup. */
export const SELLER_READY_ALLOWED_STATUSES = Object.freeze([
  WORKFLOW_STATUS.SELLER_ACCEPTED,
  WORKFLOW_STATUS.DELIVERY_SEARCH,
  WORKFLOW_STATUS.DELIVERY_ASSIGNED,
  WORKFLOW_STATUS.PICKUP_READY,
]);

/** Reasons offered by "Report Issue", per reporter role and channel. */
export const DEFAULT_ISSUE_REASONS = Object.freeze({
  [COMM_ROLE.CUSTOMER]: {
    [COMM_CHANNEL.CUSTOMER_RIDER]: [
      { code: "RIDER_UNREACHABLE", label: "Delivery partner is unreachable" },
      { code: "RIDER_NOT_ARRIVED", label: "Delivery partner has not arrived" },
      { code: "DELIVERY_PROBLEM", label: "Problem with my delivery" },
      { code: "INAPPROPRIATE_COMMUNICATION", label: "Inappropriate communication" },
      { code: "OTHER", label: "Other" },
    ],
  },
  [COMM_ROLE.RIDER]: {
    [COMM_CHANNEL.CUSTOMER_RIDER]: [
      { code: "CUSTOMER_UNREACHABLE", label: "Customer is unreachable" },
      { code: "ADDRESS_UNCLEAR", label: "Delivery address is unclear" },
      { code: "DELIVERY_NOT_POSSIBLE", label: "Delivery cannot be completed" },
      { code: "INAPPROPRIATE_COMMUNICATION", label: "Inappropriate communication" },
      { code: "OTHER", label: "Other" },
    ],
    [COMM_CHANNEL.SELLER_RIDER]: [
      { code: "ORDER_NOT_READY", label: "Order not ready" },
      { code: "SELLER_UNAVAILABLE", label: "Seller unavailable" },
      { code: "SHOP_CLOSED", label: "Shop closed" },
      { code: "PARCEL_ISSUE", label: "Parcel or item issue" },
      { code: "INAPPROPRIATE_COMMUNICATION", label: "Inappropriate communication" },
      { code: "OTHER", label: "Other" },
    ],
  },
  [COMM_ROLE.SELLER]: {
    [COMM_CHANNEL.SELLER_RIDER]: [
      { code: "RIDER_NOT_ARRIVED", label: "Rider has not arrived" },
      { code: "PICKUP_DELAYED", label: "Pickup is delayed" },
      { code: "PICKUP_PROBLEM", label: "Pickup-related problem" },
      { code: "INAPPROPRIATE_COMMUNICATION", label: "Inappropriate communication" },
      { code: "OTHER", label: "Other" },
    ],
  },
});

/** Pickup-side reasons that start the escalation clock for operations. */
export const PICKUP_DELAY_REASONS = Object.freeze([
  "ORDER_NOT_READY",
  "SELLER_UNAVAILABLE",
  "SHOP_CLOSED",
  "PICKUP_DELAYED",
  "RIDER_NOT_ARRIVED",
]);

/** Audit-trail event types visible to Super Admin / operations. */
export const COMM_EVENT = Object.freeze({
  RIDER_ASSIGNED: "RIDER_ASSIGNED",
  RIDER_REASSIGNED: "RIDER_REASSIGNED",
  SELLER_MARKED_READY: "SELLER_MARKED_READY",
  SELLER_READY_ETA: "SELLER_READY_ETA",
  RIDER_ARRIVED_AT_PICKUP: "RIDER_ARRIVED_AT_PICKUP",
  PICKUP_CONFIRMED: "PICKUP_CONFIRMED",
  ISSUE_REPORTED: "ISSUE_REPORTED",
  ISSUE_ESCALATED: "ISSUE_ESCALATED",
  ISSUE_UPDATED: "ISSUE_UPDATED",
  ACCESS_REVOKED: "ACCESS_REVOKED",
  CONVERSATION_CLOSED: "CONVERSATION_CLOSED",
  CONTACT_NUMBER_REQUESTED: "CONTACT_NUMBER_REQUESTED",
  NOTIFICATION_SUPPRESSED: "NOTIFICATION_SUPPRESSED",
  NOTIFICATION_FAILED: "NOTIFICATION_FAILED",
  ADMIN_VIEWED_CONVERSATION: "ADMIN_VIEWED_CONVERSATION",
});

const intEnv = (name, fallback) => {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const boolEnv = (name, fallback) => {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return String(raw).toLowerCase() !== "false";
};

/** Env-level defaults; admin settings may override (see communicationConfig.js). */
export function communicationEnvDefaults() {
  return {
    chatEnabled: boolEnv("ORDER_CHAT_ENABLED", true),
    callEnabled: boolEnv("ORDER_CALL_ENABLED", true),
    messageMaxLength: intEnv("ORDER_CHAT_MAX_LENGTH", 500),
    sendRateLimitPerMinute: intEnv("ORDER_CHAT_SEND_PER_MINUTE", 20),
    contactRateLimitPerMinute: intEnv("ORDER_CONTACT_PER_MINUTE", 6),
    pushPreviewEnabled: boolEnv("ORDER_CHAT_PUSH_PREVIEW", true),
    pushPreviewMaxLength: intEnv("ORDER_CHAT_PUSH_PREVIEW_LENGTH", 80),
    messageRetentionDays: intEnv("ORDER_CHAT_RETENTION_DAYS", 90),
    riderAssignmentDelayMinutes: intEnv("ORDER_RIDER_ASSIGN_DELAY_MIN", 10),
    pickupDelayEscalationMinutes: intEnv("ORDER_PICKUP_ESCALATION_MIN", 15),
    historyPageSize: intEnv("ORDER_CHAT_PAGE_SIZE", 50),
    activeStatuses: DEFAULT_ACTIVE_STATUSES,
    historyStatuses: DEFAULT_HISTORY_STATUSES,
    issueReasons: DEFAULT_ISSUE_REASONS,
  };
}
