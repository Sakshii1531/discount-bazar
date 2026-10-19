/**
 * Order communication: customer ↔ rider and seller ↔ rider chat, native-dialer
 * contact lookup, "Report Issue", seller "Ready for Pickup", and the lifecycle
 * hook that revokes/closes conversations when the order or rider changes.
 *
 * Every entry point re-loads the order and re-evaluates access from the live
 * assignment (communicationAccess.js). Nothing is authorized from a cached
 * conversation, a client-supplied sender, or a previously revealed number.
 */
import mongoose from "mongoose";
import Order from "../../models/order.js";
import Delivery from "../../models/delivery.js";
import Seller from "../../models/seller.js";
import Customer from "../../models/customer.js";
import Admin from "../../models/admin.js";
import Ticket from "../../models/ticket.js";
import OrderConversation from "../../models/orderConversation.js";
import OrderChatMessage from "../../models/orderChatMessage.js";
import CommunicationIssue from "../../models/communicationIssue.js";
import CommunicationEvent from "../../models/communicationEvent.js";
import {
  COMM_CHANNEL,
  COMM_EVENT,
  COMM_ROLE,
  PICKUP_DELAY_REASONS,
  SELLER_READY_ALLOWED_STATUSES,
} from "../../constants/orderCommunication.js";
import { WORKFLOW_STATUS } from "../../constants/orderWorkflow.js";
import {
  ACCESS_REASON,
  channelsForRole,
  evaluateChannelAccess,
  idString,
  normalizeCommRole,
  orderWorkflowStatus,
  partyCheck,
  receiptSideForRole,
} from "./communicationAccess.js";
import {
  getCommunicationConfig,
  publicCommunicationConfig,
} from "./communicationConfig.js";
import { orderMatchQueryFromRouteParam } from "../../utils/orderLookup.js";
import {
  emitToCustomer,
  emitToDelivery,
  emitToSeller,
} from "../orderSocketEmitter.js";
import { emitTicketCreated } from "../ticketSocketEmitter.js";
import { emitNotificationEvent } from "../../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../../modules/notifications/notification.constants.js";
import logger from "../logger.js";

const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
// Strip C0/C1 control chars except tab/newline; collapse 3+ blank lines.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

const ORDER_ACCESS_FIELDS =
  "orderId customer seller deliveryBoy workflowStatus workflowVersion status " +
  "assignmentVersion assignedAt sellerAcceptedAt sellerReadyAt sellerReadyEtaAt " +
  "pickupReadyAt pickupConfirmedAt outForDeliveryAt deliveredAt createdAt";

function svcErr(message, statusCode, code, extra = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  Object.assign(err, extra);
  return err;
}

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

// ---------------------------------------------------------------------------
// Loading + authorization
// ---------------------------------------------------------------------------

async function loadOrder(orderParam, extraFields = "") {
  const query = orderMatchQueryFromRouteParam(orderParam);
  if (!query) throw svcErr("Order not found", 404, "ORDER_NOT_FOUND");
  const order = await Order.findOne(query)
    .select(`${ORDER_ACCESS_FIELDS} ${extraFields}`.trim())
    .lean();
  if (!order) throw svcErr("Order not found", 404, "ORDER_NOT_FOUND");
  return order;
}

function requireRole(user) {
  const role = normalizeCommRole(user?.role);
  if (!role || role === COMM_ROLE.ADMIN || !user?.id) {
    throw svcErr("Access denied", 403, "ROLE_NOT_ALLOWED");
  }
  return role;
}

const DENIAL_MESSAGES = {
  [ACCESS_REASON.CHANNEL_INVALID]: "Unknown conversation type",
  [ACCESS_REASON.CHANNEL_NOT_FOR_ROLE]: "This conversation is not available to your account",
  [ACCESS_REASON.RIDER_NOT_ASSIGNED]: "A delivery partner has not been assigned to this order yet",
  [ACCESS_REASON.STATUS_NOT_ELIGIBLE]: "Messaging is not available at this stage of the order",
  [ACCESS_REASON.CHAT_DISABLED]: "In-app chat is currently disabled",
};

function throwDenied(decision) {
  // Non-parties get a 404 so order IDs cannot be probed for existence.
  if (
    decision.reason === ACCESS_REASON.NOT_A_PARTY ||
    decision.reason === ACCESS_REASON.NOT_ASSIGNED_RIDER
  ) {
    throw svcErr("Order not found", 404, "ACCESS_EXPIRED");
  }
  const status = decision.reason === ACCESS_REASON.CHANNEL_INVALID ? 400 : 403;
  throw svcErr(
    DENIAL_MESSAGES[decision.reason] || "Access denied",
    status,
    decision.reason || "ACCESS_DENIED",
    { access: decision },
  );
}

/**
 * Load the order and decide access for (user, channel).
 * `need`: "view" | "send" | "call".
 */
export async function authorize(user, orderParam, channel, need = "view", extraFields = "") {
  const role = requireRole(user);
  const [order, config] = await Promise.all([
    loadOrder(orderParam, extraFields),
    getCommunicationConfig(),
  ]);
  const decision = evaluateChannelAccess({
    role,
    userId: user.id,
    order,
    channel,
    config,
  });
  const ok =
    (need === "view" && decision.allowed) ||
    (need === "send" && decision.canSend) ||
    (need === "call" && decision.canCall);
  if (!ok) {
    if (decision.allowed && need !== "view") {
      // Visible but not writable: closed/read-only or the feature is off.
      const reason =
        need === "call" && !config.callEnabled ? "CALL_DISABLED" : decision.reason;
      throw svcErr(
        need === "call" && !config.callEnabled
          ? "Calling is currently disabled"
          : DENIAL_MESSAGES[decision.reason] || "This conversation is read-only",
        403,
        reason || "READ_ONLY",
        { access: decision },
      );
    }
    throwDenied(decision);
  }
  return { role, order, config, decision };
}

// ---------------------------------------------------------------------------
// Conversations + messages
// ---------------------------------------------------------------------------

function conversationKey(order, channel) {
  return {
    orderId: order.orderId,
    channel,
    riderId: new mongoose.Types.ObjectId(idString(order.deliveryBoy)),
  };
}

async function findConversation(order, channel) {
  if (!order.deliveryBoy) return null;
  return OrderConversation.findOne(conversationKey(order, channel)).lean();
}

async function getOrCreateConversation(order, channel) {
  const key = conversationKey(order, channel);
  const insert = {
    ...key,
    orderMongoId: order._id,
    assignmentVersion: order.assignmentVersion || 0,
    status: "active",
  };
  if (channel === COMM_CHANNEL.CUSTOMER_RIDER) insert.customerId = order.customer;
  else insert.sellerId = order.seller;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await OrderConversation.findOneAndUpdate(
        key,
        { $setOnInsert: insert },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();
    } catch (error) {
      if (!isDuplicateKeyError(error) || attempt === 1) throw error;
    }
  }
  return null;
}

export function serializeMessage(message, viewerId) {
  const mine = String(message.senderId) === String(viewerId);
  return {
    id: String(message._id),
    conversationId: String(message.conversationId),
    orderId: message.orderId,
    channel: message.channel,
    seq: message.seq,
    senderRole: message.senderRole,
    mine,
    ...(mine ? { clientMessageId: message.clientMessageId } : {}),
    type: message.type || "text",
    text: message.text,
    createdAt: message.createdAt,
  };
}

function otherSide(side) {
  return side === "rider" ? "counterpart" : "rider";
}

function receiptView(conversation, viewerRole) {
  if (!conversation) return null;
  const mySide = receiptSideForRole(viewerRole);
  const r = conversation.receipts || {};
  return {
    // How far the *other* party has received/read — drives my ticks.
    peerDeliveredSeq: r[otherSide(mySide)]?.deliveredSeq || 0,
    peerReadSeq: r[otherSide(mySide)]?.readSeq || 0,
    myReadSeq: r[mySide]?.readSeq || 0,
  };
}

function conversationView(conversation, viewerRole) {
  if (!conversation) return null;
  return {
    id: String(conversation._id),
    status: conversation.status,
    lastSeq: conversation.lastSeq || 0,
    lastMessageAt: conversation.lastMessageAt || null,
    receipts: receiptView(conversation, viewerRole),
  };
}

export function validateMessageInput({ clientMessageId, text }, config) {
  if (typeof clientMessageId !== "string" || !CLIENT_ID_PATTERN.test(clientMessageId)) {
    throw svcErr("A valid clientMessageId is required", 400, "INVALID_CLIENT_ID");
  }
  if (typeof text !== "string") {
    throw svcErr("Only text messages are supported", 400, "UNSUPPORTED_CONTENT");
  }
  const cleaned = text
    .replace(CONTROL_CHARS, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) {
    throw svcErr("Message cannot be empty", 400, "EMPTY_MESSAGE");
  }
  if (cleaned.length > config.messageMaxLength) {
    throw svcErr(
      `Message is too long (max ${config.messageMaxLength} characters)`,
      400,
      "MESSAGE_TOO_LONG",
    );
  }
  return cleaned;
}

function emitToParty(role, userId, event, payload) {
  const id = String(userId || "");
  if (!id) return;
  if (role === COMM_ROLE.RIDER) emitToDelivery(id, { event, payload });
  else if (role === COMM_ROLE.SELLER) emitToSeller(id, { event, payload });
  else if (role === COMM_ROLE.CUSTOMER) emitToCustomer(id, { event, payload });
}

/** The (role, id) on the other end of `channel` from `role`'s perspective. */
function counterpartOf(role, channel, order) {
  if (role === COMM_ROLE.RIDER) {
    return channel === COMM_CHANNEL.CUSTOMER_RIDER
      ? { role: COMM_ROLE.CUSTOMER, id: idString(order.customer) }
      : { role: COMM_ROLE.SELLER, id: idString(order.seller) };
  }
  return { role: COMM_ROLE.RIDER, id: idString(order.deliveryBoy) };
}

export async function listMessages(user, orderParam, channel, opts = {}) {
  const { role, order, config, decision } = await authorize(user, orderParam, channel, "view");
  const conversation = await findConversation(order, channel);
  const limit = Math.min(
    Math.max(parseInt(opts.limit, 10) || config.historyPageSize, 1),
    100,
  );

  let messages = [];
  let hasMore = false;
  if (conversation) {
    const afterSeq = parseInt(opts.afterSeq, 10);
    const beforeSeq = parseInt(opts.beforeSeq, 10);
    const filter = { conversationId: conversation._id };
    if (Number.isFinite(afterSeq) && afterSeq >= 0) {
      // Forward sync after reconnect: oldest-first from the client's watermark.
      filter.seq = { $gt: afterSeq };
      const rows = await OrderChatMessage.find(filter)
        .sort({ seq: 1 })
        .limit(limit + 1)
        .lean();
      hasMore = rows.length > limit;
      messages = rows.slice(0, limit);
    } else {
      // Initial open / scroll-back: newest page, returned oldest-first.
      if (Number.isFinite(beforeSeq) && beforeSeq > 0) filter.seq = { $lt: beforeSeq };
      const rows = await OrderChatMessage.find(filter)
        .sort({ seq: -1 })
        .limit(limit + 1)
        .lean();
      hasMore = rows.length > limit;
      messages = rows.slice(0, limit).reverse();
    }
  }

  return {
    orderId: order.orderId,
    channel,
    access: publicDecision(decision),
    conversation: conversationView(conversation, role),
    messages: messages.map((m) => serializeMessage(m, user.id)),
    hasMore,
  };
}

export async function sendMessage(user, orderParam, channel, body = {}) {
  const config = await getCommunicationConfig();
  // Validate payload before touching the order so malformed requests are cheap.
  const text = validateMessageInput(body, config);
  const { role, order } = await authorize(user, orderParam, channel, "send");

  const conversation = await getOrCreateConversation(order, channel);
  if (!conversation || conversation.status !== "active") {
    throw svcErr("This conversation is closed", 409, "CONVERSATION_CLOSED");
  }

  const senderId = new mongoose.Types.ObjectId(String(user.id));
  const existing = await OrderChatMessage.findOne({
    conversationId: conversation._id,
    senderId,
    clientMessageId: body.clientMessageId,
  }).lean();
  if (existing) {
    return { message: serializeMessage(existing, user.id), duplicate: true };
  }

  const now = new Date();
  const bumped = await OrderConversation.findOneAndUpdate(
    { _id: conversation._id, status: "active" },
    { $inc: { lastSeq: 1 }, $set: { lastMessageAt: now } },
    { new: true },
  ).lean();
  if (!bumped) {
    throw svcErr("This conversation is closed", 409, "CONVERSATION_CLOSED");
  }

  let created;
  try {
    created = await OrderChatMessage.create({
      conversationId: conversation._id,
      orderId: order.orderId,
      channel,
      seq: bumped.lastSeq,
      senderRole: role,
      senderId,
      clientMessageId: body.clientMessageId,
      type: "text",
      text,
      expiresAt: new Date(now.getTime() + config.messageRetentionDays * 86400000),
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    // Concurrent retry won the race — return the stored copy (leaves a seq gap,
    // which clients tolerate because they sync by `seq > watermark`).
    const raced = await OrderChatMessage.findOne({
      conversationId: conversation._id,
      senderId,
      clientMessageId: body.clientMessageId,
    }).lean();
    if (raced) return { message: serializeMessage(raced, user.id), duplicate: true };
    throw error;
  }

  // Receipts are only ever advanced by the recipient's app (updateReceipts);
  // sending does not imply the sender has read anything.
  const counterpart = counterpartOf(role, channel, order);
  const plain = created.toObject();
  // Real-time fan-out: recipient's devices + sender's other devices.
  emitToParty(counterpart.role, counterpart.id, "chat:message", serializeMessage(plain, counterpart.id));
  emitToParty(role, user.id, "chat:message", serializeMessage(plain, user.id));

  await queueChatNotification({ order, channel, role, counterpart, message: plain, config });

  return { message: serializeMessage(plain, user.id), duplicate: false };
}

async function senderDisplayName(role, order) {
  try {
    if (role === COMM_ROLE.RIDER) {
      const rider = await Delivery.findById(order.deliveryBoy).select("name").lean();
      return rider?.name ? `${rider.name} (Delivery partner)` : "Your delivery partner";
    }
    if (role === COMM_ROLE.SELLER) {
      const seller = await Seller.findById(order.seller).select("shopName").lean();
      return seller?.shopName || "Store";
    }
    return "Customer";
  } catch {
    return role === COMM_ROLE.RIDER ? "Delivery partner" : role === COMM_ROLE.SELLER ? "Store" : "Customer";
  }
}

async function queueChatNotification({ order, channel, role, counterpart, message, config }) {
  if (!counterpart.id) return;
  const preview = config.pushPreviewEnabled
    ? String(message.text).slice(0, config.pushPreviewMaxLength)
    : "";
  emitNotificationEvent(NOTIFICATION_EVENTS.CHAT_MESSAGE, {
    // Dedupe key: one notification per stored message, however often the
    // event is replayed.
    messageId: String(message._id),
    orderId: order.orderId,
    channel,
    recipientRole: counterpart.role,
    recipientId: counterpart.id,
    senderRole: role,
    senderName: await senderDisplayName(role, order),
    preview,
    data: {
      conversationId: String(message.conversationId),
      messageId: String(message._id),
      channel,
      seq: message.seq,
      commCheck: {
        kind: "chat",
        orderId: order.orderId,
        channel,
        riderId: idString(order.deliveryBoy),
        recipientRole: counterpart.role,
        recipientId: counterpart.id,
        conversationId: String(message.conversationId),
      },
    },
  });
}

export async function updateReceipts(user, orderParam, channel, body = {}) {
  const { role, order } = await authorize(user, orderParam, channel, "view");
  const conversation = await findConversation(order, channel);
  if (!conversation) return { conversation: null };

  const clamp = (v) => {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(n, conversation.lastSeq || 0);
  };
  const readSeq = clamp(body.readUpToSeq);
  // Reading implies delivery.
  const deliveredSeq = Math.max(clamp(body.deliveredUpToSeq), readSeq);
  if (!deliveredSeq) {
    return { conversation: conversationView(conversation, role) };
  }

  const side = receiptSideForRole(role);
  const $max = { [`receipts.${side}.deliveredSeq`]: deliveredSeq };
  if (readSeq) $max[`receipts.${side}.readSeq`] = readSeq;
  const updated = await OrderConversation.findOneAndUpdate(
    { _id: conversation._id },
    { $max },
    { new: true },
  ).lean();

  const payload = {
    orderId: order.orderId,
    channel,
    conversationId: String(conversation._id),
    side,
    deliveredSeq: updated.receipts?.[side]?.deliveredSeq || 0,
    readSeq: updated.receipts?.[side]?.readSeq || 0,
  };
  const counterpart = counterpartOf(role, channel, order);
  emitToParty(counterpart.role, counterpart.id, "chat:receipt", payload);
  emitToParty(role, user.id, "chat:receipt", payload);

  return { conversation: conversationView(updated, role) };
}

// ---------------------------------------------------------------------------
// State for the order screens
// ---------------------------------------------------------------------------

function publicDecision(decision) {
  return {
    allowed: decision.allowed,
    canSend: decision.canSend,
    canCall: decision.canCall,
    readOnly: decision.readOnly,
    reason: decision.reason,
  };
}

const COUNTERPART_LABEL = {
  [COMM_ROLE.RIDER]: "Delivery partner",
  [COMM_ROLE.CUSTOMER]: "Customer",
  [COMM_ROLE.SELLER]: "Store",
};

async function counterpartNames(order, role) {
  const names = {};
  if (role === COMM_ROLE.RIDER) {
    const [customer, seller, full] = await Promise.all([
      Customer.findById(order.customer).select("name").lean(),
      Seller.findById(order.seller).select("shopName").lean(),
      Order.findById(order._id).select("address.name").lean(),
    ]);
    names[COMM_CHANNEL.CUSTOMER_RIDER] = full?.address?.name || customer?.name || "Customer";
    names[COMM_CHANNEL.SELLER_RIDER] = seller?.shopName || "Store";
  } else if (order.deliveryBoy) {
    const rider = await Delivery.findById(order.deliveryBoy)
      .select("name profileImage vehicleType")
      .lean();
    const label = rider?.name || "Delivery partner";
    names[COMM_CHANNEL.CUSTOMER_RIDER] = label;
    names[COMM_CHANNEL.SELLER_RIDER] = label;
    names.rider = rider
      ? { name: rider.name || "Delivery partner", profileImage: rider.profileImage || null, vehicleType: rider.vehicleType || null }
      : null;
  }
  return names;
}

async function unreadCount(conversation, role, userId) {
  if (!conversation) return 0;
  const myRead = conversation.receipts?.[receiptSideForRole(role)]?.readSeq || 0;
  if ((conversation.lastSeq || 0) <= myRead) return 0;
  return OrderChatMessage.countDocuments({
    conversationId: conversation._id,
    seq: { $gt: myRead },
    senderId: { $ne: new mongoose.Types.ObjectId(String(userId)) },
  });
}

/**
 * Everything an order screen needs to render its contact controls. Clients
 * call this before opening chat or the dialer, and on every reconnect /
 * `communication:state` ping, so stale cached assignments never drive UI.
 */
export async function getCommunicationState(user, orderParam) {
  const role = requireRole(user);
  const [order, config] = await Promise.all([loadOrder(orderParam), getCommunicationConfig()]);

  // Must be a party to *some* channel on this order (or 404).
  const channels = channelsForRole(role);
  const anyParty = channels.some(
    (channel) => !partyCheck({ role, userId: user.id, order, channel }),
  );
  if (!anyParty) throw svcErr("Order not found", 404, "ACCESS_EXPIRED");

  const ws = orderWorkflowStatus(order);
  const names = await counterpartNames(order, role);

  const channelStates = [];
  for (const channel of channels) {
    const decision = evaluateChannelAccess({ role, userId: user.id, order, channel, config });
    const conversation = decision.allowed ? await findConversation(order, channel) : null;
    const counterpartRole = role === COMM_ROLE.RIDER ? (channel === COMM_CHANNEL.CUSTOMER_RIDER ? COMM_ROLE.CUSTOMER : COMM_ROLE.SELLER) : COMM_ROLE.RIDER;
    channelStates.push({
      channel,
      counterpartRole,
      counterpartLabel: COUNTERPART_LABEL[counterpartRole],
      counterpartName: decision.riderId || role === COMM_ROLE.RIDER ? (names[channel] || null) : null,
      ...publicDecision(decision),
      // Read-only history only makes sense if something was said.
      ...(decision.readOnly && !conversation ? { allowed: false } : {}),
      conversation: conversationView(conversation, role),
      unread: decision.allowed ? await unreadCount(conversation, role, user.id) : 0,
    });
  }

  const preAssignment = [
    WORKFLOW_STATUS.CREATED,
    WORKFLOW_STATUS.SELLER_PENDING,
    WORKFLOW_STATUS.SELLER_ACCEPTED,
    WORKFLOW_STATUS.DELIVERY_SEARCH,
  ].includes(ws);
  const searchStartedAt = order.sellerAcceptedAt || order.createdAt;
  const assignmentDelayed =
    !order.deliveryBoy &&
    ws === WORKFLOW_STATUS.DELIVERY_SEARCH &&
    searchStartedAt &&
    Date.now() - new Date(searchStartedAt).getTime() >
      config.riderAssignmentDelayMinutes * 60000;

  const reasons = config.issueReasons?.[role] || {};
  const openIssues = await CommunicationIssue.find({
    orderId: order.orderId,
    reporterId: user.id,
    status: { $ne: "resolved" },
  })
    .select("channel reason status createdAt")
    .sort({ createdAt: -1 })
    .limit(10)
    .lean();

  const state = {
    orderId: order.orderId,
    role,
    workflowStatus: ws,
    assignment: {
      assigned: Boolean(order.deliveryBoy),
      waitingForRider: !order.deliveryBoy && preAssignment,
      delayed: Boolean(assignmentDelayed),
      assignmentVersion: order.assignmentVersion || 0,
      rider: role !== COMM_ROLE.RIDER ? names.rider || null : undefined,
    },
    pickup: {
      sellerReadyAt: order.sellerReadyAt || null,
      sellerReadyEtaAt: order.sellerReadyEtaAt || null,
      riderArrivedAt: order.pickupReadyAt || null,
      pickupConfirmedAt: order.pickupConfirmedAt || null,
      canMarkReady:
        role === COMM_ROLE.SELLER &&
        !order.sellerReadyAt &&
        SELLER_READY_ALLOWED_STATUSES.includes(ws),
    },
    channels: channelStates,
    issueReasons: reasons,
    openIssues: openIssues.map((i) => ({
      id: String(i._id),
      channel: i.channel,
      reason: i.reason,
      status: i.status,
      createdAt: i.createdAt,
    })),
    config: publicCommunicationConfig(config),
  };

  if (role === COMM_ROLE.RIDER && (order.assignmentVersion || 0) > 1) {
    // Limited handover context for a reassigned order — never the previous
    // rider's private chat, only operational facts.
    const priorIssues = await CommunicationIssue.find({
      orderId: order.orderId,
      status: { $ne: "resolved" },
    })
      .select("reason reporterRole createdAt")
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    state.handover = {
      reassigned: true,
      sellerReadyAt: order.sellerReadyAt || null,
      openIssues: priorIssues.map((i) => ({
        reason: i.reason,
        reporterRole: i.reporterRole,
        createdAt: i.createdAt,
      })),
    };
  }

  return state;
}

// ---------------------------------------------------------------------------
// Native-dialer contact
// ---------------------------------------------------------------------------

const CALL_DISCLOSURE =
  "This is a normal phone call through your mobile network. Your phone number will be visible to the person you call. Calls are not recorded or tracked by the app.";

export async function getContactForCall(user, orderParam, channel) {
  const { role, order } = await authorize(user, orderParam, channel, "call");
  const counterpart = counterpartOf(role, channel, order);

  let phone = "";
  let name = "";
  if (counterpart.role === COMM_ROLE.RIDER) {
    const rider = await Delivery.findById(counterpart.id).select("name phone").lean();
    phone = rider?.phone || "";
    name = rider?.name || "Delivery partner";
  } else if (counterpart.role === COMM_ROLE.SELLER) {
    const seller = await Seller.findById(counterpart.id).select("shopName phone").lean();
    phone = seller?.phone || "";
    name = seller?.shopName || "Store";
  } else {
    // Delivery contact on the order wins over the account phone.
    const [full, customer] = await Promise.all([
      Order.findById(order._id).select("address.phone address.name").lean(),
      Customer.findById(counterpart.id).select("name phone").lean(),
    ]);
    phone = full?.address?.phone || customer?.phone || "";
    name = full?.address?.name || customer?.name || "Customer";
  }

  const dialable = String(phone).replace(/[^\d+]/g, "");
  await recordEvent({
    orderId: order.orderId,
    type: COMM_EVENT.CONTACT_NUMBER_REQUESTED,
    actorRole: role,
    actorId: user.id,
    meta: { channel, counterpartRole: counterpart.role, available: Boolean(dialable) },
  });

  if (dialable.replace(/\D/g, "").length < 6) {
    throw svcErr(
      "A contact number is not available. You can still use in-app chat.",
      404,
      "CONTACT_UNAVAILABLE",
    );
  }

  return { phone: dialable, name, disclosure: CALL_DISCLOSURE };
}

// ---------------------------------------------------------------------------
// Report Issue
// ---------------------------------------------------------------------------

const TICKET_USER_TYPE = {
  [COMM_ROLE.CUSTOMER]: "User",
  [COMM_ROLE.SELLER]: "Seller",
  [COMM_ROLE.RIDER]: "Delivery",
};

async function adminIds() {
  const admins = await Admin.find().select("_id").lean();
  return admins.map((a) => a._id);
}

export async function reportIssue(user, orderParam, body = {}) {
  const role = requireRole(user);
  const { channel, reason } = body;
  const note = typeof body.note === "string" ? body.note.replace(CONTROL_CHARS, "").trim() : "";
  const clientRequestId =
    typeof body.clientRequestId === "string" && CLIENT_ID_PATTERN.test(body.clientRequestId)
      ? body.clientRequestId
      : undefined;

  if (note.length > 500) throw svcErr("Note is too long (max 500 characters)", 400, "NOTE_TOO_LONG");

  const [order, config] = await Promise.all([loadOrder(orderParam), getCommunicationConfig()]);
  const partyReason = partyCheck({ role, userId: user.id, order, channel });
  if (partyReason) throwDenied({ reason: partyReason });

  const allowedReasons = config.issueReasons?.[role]?.[channel] || [];
  const reasonDef = allowedReasons.find((r) => r.code === reason);
  if (!reasonDef) throw svcErr("Please choose a valid reason", 400, "INVALID_REASON");

  if (clientRequestId) {
    const existing = await CommunicationIssue.findOne({ reporterId: user.id, clientRequestId }).lean();
    if (existing) return { issue: serializeIssue(existing), duplicate: true };
  }

  let issue;
  try {
    issue = await CommunicationIssue.create({
      orderMongoId: order._id,
      orderId: order.orderId,
      channel,
      reporterRole: role,
      reporterId: user.id,
      riderId: order.deliveryBoy || undefined,
      reason,
      note,
      clientRequestId,
      isPickupDelay: channel === COMM_CHANNEL.SELLER_RIDER && PICKUP_DELAY_REASONS.includes(reason),
    });
  } catch (error) {
    if (isDuplicateKeyError(error) && clientRequestId) {
      const existing = await CommunicationIssue.findOne({ reporterId: user.id, clientRequestId }).lean();
      if (existing) return { issue: serializeIssue(existing), duplicate: true };
    }
    throw error;
  }

  // Route into the existing support desk so operations work it in one place.
  try {
    const ticket = await Ticket.create({
      userId: user.id,
      userType: TICKET_USER_TYPE[role],
      subject: `[Order ${order.orderId}] ${reasonDef.label}`,
      description: note || reasonDef.label,
      priority: issue.isPickupDelay ? "high" : "medium",
      messages: [
        {
          sender: COUNTERPART_LABEL[role] || "User",
          senderId: user.id,
          senderType: "User",
          text: note || reasonDef.label,
        },
      ],
    });
    await CommunicationIssue.updateOne({ _id: issue._id }, { $set: { ticketId: ticket._id } });
    issue.ticketId = ticket._id;
    emitTicketCreated(ticket);
  } catch (error) {
    logger.warn("Communication issue: support ticket creation failed", {
      orderId: order.orderId,
      message: error.message,
    });
  }

  await recordEvent({
    orderId: order.orderId,
    type: COMM_EVENT.ISSUE_REPORTED,
    actorRole: role,
    actorId: user.id,
    eventKey: `issue:${issue._id}`,
    meta: { issueId: String(issue._id), channel, reason },
  });

  emitNotificationEvent(NOTIFICATION_EVENTS.COMMUNICATION_ISSUE_REPORTED, {
    eventId: `issue:${issue._id}`,
    orderId: order.orderId,
    adminIds: await adminIds(),
    // A rider's pickup problem is the seller's to act on; nothing else
    // fans out to the other party.
    sellerId:
      role === COMM_ROLE.RIDER && channel === COMM_CHANNEL.SELLER_RIDER
        ? idString(order.seller)
        : null,
    reporterRole: role,
    reasonLabel: reasonDef.label,
  });

  return { issue: serializeIssue(issue.toObject ? issue.toObject() : issue), duplicate: false };
}

function serializeIssue(issue) {
  return {
    id: String(issue._id),
    orderId: issue.orderId,
    channel: issue.channel,
    reporterRole: issue.reporterRole,
    reason: issue.reason,
    note: issue.note,
    status: issue.status,
    isPickupDelay: issue.isPickupDelay,
    escalatedAt: issue.escalatedAt || null,
    resolvedAt: issue.resolvedAt || null,
    resolutionNote: issue.resolutionNote || "",
    ticketId: issue.ticketId ? String(issue.ticketId) : null,
    createdAt: issue.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Seller "Ready for Pickup" + readiness ETA
// ---------------------------------------------------------------------------

function notifyRiderPickupReady(order, riderId) {
  if (!riderId) return;
  emitNotificationEvent(NOTIFICATION_EVENTS.SELLER_READY_FOR_PICKUP, {
    // Keyed per rider so a reassigned rider still gets it, but replays don't.
    eventId: `ready:${order.orderId}:${riderId}`,
    orderId: order.orderId,
    deliveryId: riderId,
    data: {
      commCheck: { kind: "rider_pickup", orderId: order.orderId, riderId },
    },
  });
  emitToDelivery(riderId, {
    event: "communication:state",
    payload: { orderId: order.orderId, reason: "SELLER_READY" },
  });
}

export async function sellerMarkReady(user, orderParam) {
  if (normalizeCommRole(user?.role) !== COMM_ROLE.SELLER) {
    throw svcErr("Access denied", 403, "ROLE_NOT_ALLOWED");
  }
  const order = await loadOrder(orderParam);
  if (idString(order.seller) !== String(user.id)) {
    throw svcErr("Order not found", 404, "ORDER_NOT_FOUND");
  }
  if (order.sellerReadyAt) {
    return { orderId: order.orderId, sellerReadyAt: order.sellerReadyAt, alreadyReady: true };
  }
  const ws = orderWorkflowStatus(order);
  if (!SELLER_READY_ALLOWED_STATUSES.includes(ws)) {
    throw svcErr(
      ws === WORKFLOW_STATUS.CANCELLED
        ? "This order was cancelled"
        : ws === WORKFLOW_STATUS.SELLER_PENDING || ws === WORKFLOW_STATUS.CREATED
        ? "Accept the order before marking it ready"
        : "This order has already been picked up",
      409,
      "STATUS_NOT_ELIGIBLE",
    );
  }

  const now = new Date();
  const updated = await Order.findOneAndUpdate(
    {
      _id: order._id,
      seller: order.seller,
      workflowStatus: { $in: SELLER_READY_ALLOWED_STATUSES },
      sellerReadyAt: null,
    },
    { $set: { sellerReadyAt: now }, $unset: { sellerReadyEtaAt: 1 } },
    { new: true },
  )
    .select(ORDER_ACCESS_FIELDS)
    .lean();

  if (!updated) {
    // Lost a race with a double tap or a status change — report the truth.
    const fresh = await loadOrder(order._id.toString());
    if (fresh.sellerReadyAt) {
      return { orderId: fresh.orderId, sellerReadyAt: fresh.sellerReadyAt, alreadyReady: true };
    }
    throw svcErr("Order status changed — please refresh", 409, "STATUS_CHANGED");
  }

  await recordEvent({
    orderId: updated.orderId,
    type: COMM_EVENT.SELLER_MARKED_READY,
    actorRole: COMM_ROLE.SELLER,
    actorId: user.id,
    eventKey: `ready:${updated.orderId}`,
    meta: { riderAssigned: Boolean(updated.deliveryBoy) },
  });

  // No rider yet → the flag is retained and delivered on assignment
  // (see onRiderAssigned).
  notifyRiderPickupReady(updated, idString(updated.deliveryBoy));
  emitToSeller(String(user.id), {
    event: "communication:state",
    payload: { orderId: updated.orderId, reason: "SELLER_READY" },
  });

  return { orderId: updated.orderId, sellerReadyAt: updated.sellerReadyAt, alreadyReady: false };
}

export async function sellerSetReadyEta(user, orderParam, body = {}) {
  if (normalizeCommRole(user?.role) !== COMM_ROLE.SELLER) {
    throw svcErr("Access denied", 403, "ROLE_NOT_ALLOWED");
  }
  const minutes = parseInt(body.minutes, 10);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) {
    throw svcErr("Estimated time must be between 1 and 240 minutes", 400, "INVALID_ETA");
  }
  const order = await loadOrder(orderParam);
  if (idString(order.seller) !== String(user.id)) {
    throw svcErr("Order not found", 404, "ORDER_NOT_FOUND");
  }
  const ws = orderWorkflowStatus(order);
  if (order.sellerReadyAt || !SELLER_READY_ALLOWED_STATUSES.includes(ws)) {
    throw svcErr("A readiness estimate is no longer needed for this order", 409, "STATUS_NOT_ELIGIBLE");
  }

  const etaAt = new Date(Date.now() + minutes * 60000);
  await Order.updateOne({ _id: order._id, sellerReadyAt: null }, { $set: { sellerReadyEtaAt: etaAt } });
  await recordEvent({
    orderId: order.orderId,
    type: COMM_EVENT.SELLER_READY_ETA,
    actorRole: COMM_ROLE.SELLER,
    actorId: user.id,
    meta: { minutes },
  });

  const riderId = idString(order.deliveryBoy);
  if (riderId) {
    emitNotificationEvent(NOTIFICATION_EVENTS.PICKUP_ETA_UPDATED, {
      eventId: `eta:${order.orderId}:${etaAt.getTime()}`,
      orderId: order.orderId,
      deliveryId: riderId,
      minutes,
      data: { commCheck: { kind: "rider_pickup", orderId: order.orderId, riderId } },
    });
    emitToDelivery(riderId, {
      event: "communication:state",
      payload: { orderId: order.orderId, reason: "SELLER_ETA" },
    });
  }
  return { orderId: order.orderId, sellerReadyEtaAt: etaAt };
}

/** Called when a rider wins the assignment. */
export async function onRiderAssigned(orderId) {
  try {
    const order = await loadOrder(orderId);
    if (order.sellerReadyAt && order.deliveryBoy) {
      notifyRiderPickupReady(order, idString(order.deliveryBoy));
    }
  } catch (error) {
    logger.warn("onRiderAssigned communication hook failed", { orderId, message: error.message });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle: revoke / close / audit on order + assignment changes
// ---------------------------------------------------------------------------

export async function recordEvent({ orderId, type, actorRole = "system", actorId, eventKey, meta = {} }) {
  try {
    await CommunicationEvent.create({
      orderId,
      type,
      actorRole,
      actorId: actorId && mongoose.Types.ObjectId.isValid(String(actorId)) ? actorId : undefined,
      eventKey,
      meta,
    });
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    logger.warn("Communication event write failed", { orderId, type, message: error.message });
    return false;
  }
}

/**
 * Reconcile conversations and the audit trail with the order's current state.
 * Idempotent — safe to run on every status emit, any number of times.
 */
export async function syncCommunicationState(orderId) {
  const order = await Order.findOne({ orderId }).select(ORDER_ACCESS_FIELDS).lean();
  if (!order) return;
  const config = await getCommunicationConfig();
  const ws = orderWorkflowStatus(order);
  const currentRider = idString(order.deliveryBoy);

  // 1. Assignment audit (first assignment vs reassignment).
  if (currentRider) {
    const last = await CommunicationEvent.findOne({
      orderId,
      type: { $in: [COMM_EVENT.RIDER_ASSIGNED, COMM_EVENT.RIDER_REASSIGNED] },
    })
      .sort({ createdAt: -1 })
      .lean();
    const lastRider = last?.meta?.riderId || null;
    if (lastRider !== currentRider) {
      await recordEvent({
        orderId,
        type: lastRider ? COMM_EVENT.RIDER_REASSIGNED : COMM_EVENT.RIDER_ASSIGNED,
        eventKey: `assign:${orderId}:${order.assignmentVersion || 0}:${currentRider}`,
        meta: { riderId: currentRider, previousRiderId: lastRider },
      });
      if (lastRider) {
        emitToDelivery(lastRider, {
          event: "communication:revoked",
          payload: { orderId, reason: "RIDER_REASSIGNED" },
        });
      }
    }
  }

  if (ws === WORKFLOW_STATUS.PICKUP_READY && currentRider) {
    await recordEvent({
      orderId,
      type: COMM_EVENT.RIDER_ARRIVED_AT_PICKUP,
      eventKey: `arrived:${orderId}:${currentRider}`,
      meta: { riderId: currentRider },
    });
  }
  if (order.pickupConfirmedAt) {
    await recordEvent({
      orderId,
      type: COMM_EVENT.PICKUP_CONFIRMED,
      eventKey: `pickup:${orderId}`,
      meta: { riderId: currentRider },
    });
  }

  // 2. Revoke conversations owned by a rider who is no longer assigned, and
  //    close channels whose stage has ended.
  const open = await OrderConversation.find({ orderId, status: "active" }).lean();
  for (const conv of open) {
    const convRider = String(conv.riderId);
    if (convRider !== currentRider) {
      const res = await OrderConversation.updateOne(
        { _id: conv._id, status: "active" },
        { $set: { status: "revoked", closedAt: new Date(), closedReason: "RIDER_REASSIGNED" } },
      );
      if (res.modifiedCount) {
        await recordEvent({
          orderId,
          type: COMM_EVENT.ACCESS_REVOKED,
          eventKey: `revoke:${conv._id}`,
          meta: { channel: conv.channel, riderId: convRider, reason: "RIDER_REASSIGNED" },
        });
        emitToDelivery(convRider, {
          event: "communication:revoked",
          payload: { orderId, channel: conv.channel, reason: "RIDER_REASSIGNED" },
        });
      }
      continue;
    }
    const active = config.activeStatuses?.[conv.channel] || [];
    if (!active.includes(ws)) {
      const res = await OrderConversation.updateOne(
        { _id: conv._id, status: "active" },
        { $set: { status: "closed", closedAt: new Date(), closedReason: `ORDER_${ws}` } },
      );
      if (res.modifiedCount) {
        await recordEvent({
          orderId,
          type: COMM_EVENT.CONVERSATION_CLOSED,
          eventKey: `close:${conv._id}`,
          meta: { channel: conv.channel, workflowStatus: ws },
        });
      }
    }
  }

  // 3. Order rooms: drop sockets of riders who lost the broadcast or were
  //    reassigned, so they stop receiving this order's live updates.
  try {
    const { revalidateOrderRoom } = await import("../../socket/socketManager.js");
    await revalidateOrderRoom(order);
  } catch {
    /* socket layer absent (worker/scheduler process) */
  }

  // 4. Nudge every current party to refetch state (removes stale buttons).
  const ping = { orderId, workflowStatus: ws, reason: "ORDER_UPDATED" };
  emitToCustomer(idString(order.customer), { event: "communication:state", payload: ping });
  emitToSeller(idString(order.seller), { event: "communication:state", payload: ping });
  if (currentRider) emitToDelivery(currentRider, { event: "communication:state", payload: ping });
}

// ---------------------------------------------------------------------------
// Notification relevance (checked by the worker right before push delivery)
// ---------------------------------------------------------------------------

/**
 * Re-validate a queued notification against the *current* order. A chat
 * notification for a reassigned rider, a closed order, or a recipient who has
 * lost access is suppressed instead of inviting them into a dead conversation.
 */
export async function checkNotificationRelevance(commCheck) {
  if (!commCheck?.orderId) return { relevant: true };
  const order = await Order.findOne({ orderId: commCheck.orderId })
    .select(ORDER_ACCESS_FIELDS)
    .lean();
  if (!order) return { relevant: false, reason: "ORDER_NOT_FOUND" };

  if (commCheck.kind === "rider_pickup") {
    const ws = orderWorkflowStatus(order);
    if (idString(order.deliveryBoy) !== String(commCheck.riderId)) {
      return { relevant: false, reason: "RIDER_REASSIGNED" };
    }
    if (!SELLER_READY_ALLOWED_STATUSES.includes(ws)) {
      return { relevant: false, reason: `ORDER_${ws}` };
    }
    return { relevant: true };
  }

  if (commCheck.kind === "chat") {
    if (idString(order.deliveryBoy) !== String(commCheck.riderId)) {
      return { relevant: false, reason: "RIDER_REASSIGNED" };
    }
    const config = await getCommunicationConfig();
    const decision = evaluateChannelAccess({
      role: commCheck.recipientRole,
      userId: commCheck.recipientId,
      order,
      channel: commCheck.channel,
      config,
    });
    if (!decision.canSend) {
      return { relevant: false, reason: decision.reason || "ACCESS_EXPIRED" };
    }
    return { relevant: true };
  }

  return { relevant: true };
}

// ---------------------------------------------------------------------------
// Presence (lets the worker skip a redundant push while the chat is open)
// ---------------------------------------------------------------------------

export function viewingRoom(conversationId, userId) {
  return `chatview:${conversationId}:${userId}`;
}

export async function authorizeViewing(user, orderParam, channel) {
  const { order } = await authorize(user, orderParam, channel, "view");
  const conversation = await getOrCreateConversationIfActive(order, channel, user);
  return conversation ? viewingRoom(String(conversation._id), user.id) : null;
}

async function getOrCreateConversationIfActive(order, channel, user) {
  const config = await getCommunicationConfig();
  const decision = evaluateChannelAccess({
    role: normalizeCommRole(user.role),
    userId: user.id,
    order,
    channel,
    config,
  });
  if (decision.canSend) return getOrCreateConversation(order, channel);
  return findConversation(order, channel);
}

// ---------------------------------------------------------------------------
// Admin / operations
// ---------------------------------------------------------------------------

export async function adminListEvents({ orderId, type, page = 1, limit = 50 } = {}) {
  const filter = {};
  if (orderId) filter.orderId = String(orderId).trim();
  if (type && Object.values(COMM_EVENT).includes(type)) filter.type = type;
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const [items, total] = await Promise.all([
    CommunicationEvent.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    CommunicationEvent.countDocuments(filter),
  ]);

  let notificationFailures = [];
  if (filter.orderId) {
    const Notification = mongoose.model("Notification");
    notificationFailures = await Notification.find({
      "data.orderId": filter.orderId,
      status: { $in: ["failed", "skipped"] },
    })
      .select("type role status failureReason createdAt")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
  }

  return {
    items: items.map((e) => ({
      id: String(e._id),
      orderId: e.orderId,
      type: e.type,
      actorRole: e.actorRole,
      actorId: e.actorId ? String(e.actorId) : null,
      meta: e.meta || {},
      createdAt: e.createdAt,
    })),
    notificationFailures: notificationFailures.map((n) => ({
      id: String(n._id),
      type: n.type,
      role: n.role,
      status: n.status,
      reason: n.failureReason || "",
      createdAt: n.createdAt,
    })),
    page: safePage,
    limit: safeLimit,
    total,
  };
}

export async function adminListIssues({ status, orderId, page = 1, limit = 50 } = {}) {
  const filter = {};
  if (status && ["open", "acknowledged", "resolved"].includes(status)) filter.status = status;
  if (orderId) filter.orderId = String(orderId).trim();
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const [items, total] = await Promise.all([
    CommunicationIssue.find(filter)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * safeLimit)
      .limit(safeLimit)
      .lean(),
    CommunicationIssue.countDocuments(filter),
  ]);
  return { items: items.map(serializeIssue), page: safePage, limit: safeLimit, total };
}

export async function adminUpdateIssue(admin, issueId, body = {}) {
  if (!mongoose.Types.ObjectId.isValid(String(issueId))) {
    throw svcErr("Issue not found", 404, "ISSUE_NOT_FOUND");
  }
  const status = body.status;
  if (!["open", "acknowledged", "resolved"].includes(status)) {
    throw svcErr("Invalid status", 400, "INVALID_STATUS");
  }
  const $set = { status };
  if (status === "resolved") $set.resolvedAt = new Date();
  if (typeof body.resolutionNote === "string") {
    $set.resolutionNote = body.resolutionNote.replace(CONTROL_CHARS, "").trim().slice(0, 500);
  }
  const issue = await CommunicationIssue.findByIdAndUpdate(issueId, { $set }, { new: true }).lean();
  if (!issue) throw svcErr("Issue not found", 404, "ISSUE_NOT_FOUND");
  await recordEvent({
    orderId: issue.orderId,
    type: COMM_EVENT.ISSUE_UPDATED,
    actorRole: COMM_ROLE.ADMIN,
    actorId: admin.id,
    meta: { issueId: String(issue._id), status },
  });
  return serializeIssue(issue);
}

/** Admin read of an order's conversations. Every call is audit-logged. */
export async function adminGetConversations(admin, orderParam) {
  const order = await loadOrder(orderParam);
  const conversations = await OrderConversation.find({ orderId: order.orderId })
    .sort({ createdAt: 1 })
    .lean();
  const result = [];
  for (const conv of conversations) {
    const messages = await OrderChatMessage.find({ conversationId: conv._id })
      .sort({ seq: 1 })
      .limit(500)
      .lean();
    result.push({
      id: String(conv._id),
      channel: conv.channel,
      riderId: String(conv.riderId),
      status: conv.status,
      closedReason: conv.closedReason || null,
      createdAt: conv.createdAt,
      messages: messages.map((m) => ({
        id: String(m._id),
        seq: m.seq,
        senderRole: m.senderRole,
        text: m.text,
        createdAt: m.createdAt,
      })),
    });
  }
  await recordEvent({
    orderId: order.orderId,
    type: COMM_EVENT.ADMIN_VIEWED_CONVERSATION,
    actorRole: COMM_ROLE.ADMIN,
    actorId: admin.id,
    meta: { conversations: result.length },
  });
  return { orderId: order.orderId, conversations: result };
}

/** Scheduler: escalate pickup delays that stay open past the threshold. */
export async function escalateStalePickupIssues() {
  const config = await getCommunicationConfig();
  const cutoff = new Date(Date.now() - config.pickupDelayEscalationMinutes * 60000);
  const stale = await CommunicationIssue.find({
    status: "open",
    isPickupDelay: true,
    escalatedAt: null,
    createdAt: { $lte: cutoff },
  })
    .limit(100)
    .lean();
  let escalated = 0;
  for (const issue of stale) {
    const res = await CommunicationIssue.updateOne(
      { _id: issue._id, escalatedAt: null },
      { $set: { escalatedAt: new Date() } },
    );
    if (!res.modifiedCount) continue;
    escalated += 1;
    await recordEvent({
      orderId: issue.orderId,
      type: COMM_EVENT.ISSUE_ESCALATED,
      eventKey: `escalate:${issue._id}`,
      meta: { issueId: String(issue._id), reason: issue.reason },
    });
    emitNotificationEvent(NOTIFICATION_EVENTS.COMMUNICATION_ISSUE_ESCALATED, {
      eventId: `escalate:${issue._id}`,
      orderId: issue.orderId,
      adminIds: await adminIds(),
      reason: issue.reason,
      minutes: config.pickupDelayEscalationMinutes,
    });
  }
  return { escalated };
}

export default {
  authorize,
  listMessages,
  sendMessage,
  updateReceipts,
  getCommunicationState,
  getContactForCall,
  reportIssue,
  sellerMarkReady,
  sellerSetReadyEta,
  onRiderAssigned,
  syncCommunicationState,
  checkNotificationRelevance,
  authorizeViewing,
  viewingRoom,
  adminListEvents,
  adminListIssues,
  adminUpdateIssue,
  adminGetConversations,
  escalateStalePickupIssues,
  recordEvent,
};
