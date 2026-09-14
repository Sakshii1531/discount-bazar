/**
 * Emits Socket.IO events for order workflow. Safe if socket not initialized.
 */

import mongoose from "mongoose";
import Notification from "../models/notification.js";
import { 
  getDeliveryPartnerIdsWithinSellerRadius,
  getDeliveryPartnerIdsWithinCustomerRadius
} from "./deliveryNearbyService.js";
import { emitNotificationEvent } from "../modules/notifications/notification.emitter.js";
import { NOTIFICATION_EVENTS } from "../modules/notifications/notification.constants.js";

let _getIo = null;

export function registerOrderSocketGetter(fn) {
  _getIo = fn;
}

function getIo() {
  try {
    return _getIo ? _getIo() : null;
  } catch {
    return null;
  }
}

function normalizeSellerId(sellerId) {
  if (sellerId == null) return null;
  if (typeof sellerId === "object" && sellerId._id) {
    return sellerId._id.toString();
  }
  return String(sellerId);
}

function normalizeDeliveryId(deliveryId) {
  if (deliveryId == null) return null;
  if (typeof deliveryId === "object" && deliveryId._id) {
    return deliveryId._id.toString();
  }
  return String(deliveryId);
}

/**
 * Emit workflow status to the order room (clients that joined `join_order`)
 * and optionally to the customer’s personal room so the app updates even before
 * opening order details (e.g. checkout success overlay).
 */
export function emitOrderStatusUpdate(orderId, payload, customerId) {
  const s = getIo();
  if (!s) return;
  const body = {
    orderId,
    ...payload,
    at: new Date().toISOString(),
  };
  s.to(`order:${orderId}`).emit("order:status:update", body);
  const cid =
    customerId != null &&
    typeof customerId === "object" &&
    typeof customerId.toString === "function"
      ? customerId.toString()
      : customerId;
  if (cid) {
    s.to(`customer:${cid}`).emit("order:status:update", body);
  }
}

export function emitToSeller(sellerId, { event, payload }) {
  const s = getIo();
  if (!s || !sellerId) return;
  s.to(`seller:${sellerId}`).emit(event, payload);
}

/**
 * Emit `order:new` to the seller's room so their browser panel can
 * immediately ring the order-alert ringtone without waiting for polling.
 * The frontend DashboardLayout listens on this exact event via onSellerOrderNew().
 */
export function emitNewOrderToSeller(sellerId, payload = {}) {
  const s = getIo();
  const sid = normalizeSellerId(sellerId);
  if (!s || !sid) return;
  s.to(`seller:${sid}`).emit("order:new", {
    ...payload,
    at: new Date().toISOString(),
  });
}

export function emitToDelivery(deliveryId, { event, payload }) {
  const s = getIo();
  const id = normalizeDeliveryId(deliveryId);
  if (!s || !id) return;
  s.to(`delivery:${id}`).emit(event, payload);
}

/**
 * Emit a custom event to a single admin's per-admin room
 * (joined as `admin:<userId>` in socketManager.js). Used for
 * `notification:new` deltas that should only wake up the specific
 * admin who owns the Notification row.
 */
export function emitToAdmin(adminId, { event, payload }) {
  const s = getIo();
  if (!s || !adminId || !event) return;
  const id =
    adminId && typeof adminId === "object" && typeof adminId.toString === "function"
      ? adminId.toString()
      : String(adminId);
  s.to(`admin:${id}`).emit(event, payload);
}

/**
 * Emit updated pending seller & driver review counts to all connected admins
 */
export async function emitPendingReviewUpdateToAdmins(extraPayload = {}) {
  const s = getIo();
  if (!s) return;
  try {
    const [Seller, Delivery, Product, Transaction] = await Promise.all([
      import("../models/seller.js").then((m) => m.default),
      import("../models/delivery.js").then((m) => m.default),
      import("../models/product.js").then((m) => m.default),
      import("../models/transaction.js").then((m) => m.default),
    ]);
    const [pendingSellers, pendingDrivers, pendingProducts, pendingWithdrawals] = await Promise.all([
      Seller.countDocuments({
        isVerified: { $ne: true },
        $or: [
          { applicationStatus: "pending" },
          { applicationStatus: { $exists: false } },
          { applicationStatus: null },
        ],
      }),
      Delivery.countDocuments({
        isVerified: false,
      }),
      Product.countDocuments({
        approvalStatus: "pending",
      }),
      Transaction.countDocuments({
        type: "Withdrawal",
        status: "Pending",
      }),
    ]);
    const data = {
      pendingSellers,
      pendingDrivers,
      pendingProducts,
      pendingWithdrawals,
      totalPending: pendingSellers + pendingDrivers + pendingProducts + pendingWithdrawals,
      ...extraPayload,
      at: new Date().toISOString(),
    };
    s.to("admin:orders").emit("admin:pending:update", data);
  } catch (err) {
    // Non-blocking
  }
}

/**
 * Emit withdrawal request notification and real-time alert to all connected admins
 */
export async function emitWithdrawalRequestedToAdmins({ withdrawal, user, userModel, amount }) {
  const s = getIo();
  try {
    const [Admin, Notification] = await Promise.all([
      import("../models/admin.js").then((m) => m.default),
      import("../models/notification.js").then((m) => m.default),
    ]);

    const admins = await Admin.find().select("_id").lean();
    const userName = (user?.shopName || user?.name || (userModel === "Seller" ? "Seller" : "Delivery Partner")).trim();
    const tab = userModel === "Seller" ? "sellers" : "delivery";
    const title = `New Money Request 💸`;
    const message = `${userName} requested a withdrawal of ₹${amount}.`;

    if (admins.length > 0) {
      const notifDocs = admins.map((a) => ({
        userId: a._id,
        role: "admin",
        recipient: a._id,
        recipientModel: "Admin",
        type: "WITHDRAWAL_REQUESTED",
        title,
        body: message,
        message,
        data: {
          tab,
          amount,
          userModel,
          userId: user?._id,
          transactionId: withdrawal?._id,
          link: `/admin/withdrawals?tab=${tab}`,
        },
        status: "sent",
        channel: "in_app",
        provider: "internal",
      }));
      await Notification.insertMany(notifDocs);
    }

    const payload = {
      id: withdrawal?._id,
      amount,
      userModel,
      userName,
      reference: withdrawal?.reference,
      tab,
      link: `/admin/withdrawals?tab=${tab}`,
      createdAt: withdrawal?.createdAt || new Date().toISOString(),
    };

    if (s) {
      s.to("admin:orders").emit("admin:withdrawal:new", payload);

      s.to("admin:orders").emit("notification:new", {
        title,
        message,
        data: payload,
      });
    }

    await emitPendingReviewUpdateToAdmins({
      type: "withdrawal",
      action: "requested",
      withdrawalId: withdrawal?._id,
    });
  } catch (err) {
    console.error("[orderSocketEmitter] emitWithdrawalRequestedToAdmins error:", err.message);
  }
}

/**
 * Emit a custom event to everyone who has joined the order room
 * (via `join_order`). Used for events that aren't pure workflow
 * status updates — e.g. `delivery:otp:validated`, `delivery:otp:generated`.
 */
export function emitToOrder(orderId, { event, payload }) {
  const s = getIo();
  if (!s || !orderId || !event) return;
  s.to(`order:${orderId}`).emit(event, payload);
}

/**
 * Notify only delivery partners whose live location is within the seller's
 * service radius (see Delivery model location + Seller.serviceRadius).
 */
export async function emitDeliveryBroadcastForSeller(sellerId, payload) {
  const s = getIo();
  const sid = normalizeSellerId(sellerId);
  if (!sid) return;

  const ids = await getDeliveryPartnerIdsWithinSellerRadius(sid);
  const body = { ...payload, at: new Date().toISOString() };

  if (s) {
    // Always broadcast to delivery:online room so all connected delivery partners receive instant alert & ring
    s.to("delivery:online").emit("delivery:broadcast", body);

    for (const id of ids) {
      s.to(`delivery:${id}`).emit("delivery:broadcast", body);
    }
  }

  // Trigger Push Notifications for nearby riders
  if (ids.length > 0 && !payload.retryAttempt) {
    emitNotificationEvent(NOTIFICATION_EVENTS.NEW_DELIVERY_BROADCAST, {
      orderId: payload.orderId,
      deliveryIds: ids,
    });
  }

  // Avoid duplicate DB rows when delivery search retries with wider ring
  if (!payload.retryAttempt) {
    try {
      await Notification.insertMany(
        ids.map((id) => ({
          recipient: new mongoose.Types.ObjectId(id),
          recipientModel: "Delivery",
          title: "New delivery order",
          message: `Order ${payload.orderId} — tap Accept on the alert or open this list.`,
          type: "order",
          data: {
            orderId: payload.orderId,
            preview: payload.preview || null,
            deliverySearchExpiresAt: payload.deliverySearchExpiresAt || null,
          },
        })),
        { ordered: false },
      );
    } catch (e) {
      console.warn("[emitDeliveryBroadcastForSeller] notifications", e.message);
    }
  }
}

/**
 * Retract an order request from every delivery partner except the winner.
 * This clears stale push/in-app notifications and closes any open popup.
 */
export async function retractDeliveryBroadcastForOrder(orderId, winnerDeliveryId) {
  const s = getIo();
  const winnerId = normalizeDeliveryId(winnerDeliveryId);
  const winnerObjectId =
    winnerId && mongoose.Types.ObjectId.isValid(winnerId)
      ? new mongoose.Types.ObjectId(winnerId)
      : null;

  try {
    const query = {
      recipientModel: "Delivery",
      type: "order",
      "data.orderId": orderId,
    };

    if (winnerObjectId) {
      query.recipient = { $ne: winnerObjectId };
    }

    const notifications = await Notification.find(query)
      .select("_id recipient")
      .lean();

    if (!notifications.length) {
      if (s) {
        s.to("delivery:online").emit("delivery:broadcast:withdrawn", {
          orderId,
          winnerDeliveryId: winnerId,
          at: new Date().toISOString(),
        });
      }
      return { removedCount: 0 };
    }

    const recipientIds = [
      ...new Set(
        notifications
          .map((n) => n.recipient?.toString?.() || String(n.recipient || ""))
          .filter(Boolean),
      ),
    ];

    if (s) {
      for (const recipientId of recipientIds) {
        s.to(`delivery:${recipientId}`).emit("delivery:broadcast:withdrawn", {
          orderId,
          winnerDeliveryId: winnerId,
          at: new Date().toISOString(),
        });
      }
    }

    await Notification.deleteMany({
      recipientModel: "Delivery",
      type: "order",
      "data.orderId": orderId,
      ...(winnerObjectId ? { recipient: { $ne: winnerObjectId } } : {}),
    });

    return { removedCount: notifications.length };
  } catch (error) {
    console.warn(
      "[retractDeliveryBroadcastForOrder] failed",
      orderId,
      error.message,
    );
    return { removedCount: 0 };
  }
}

/** Broadcast to all sockets in delivery:online (legacy / dev only). */
export function emitDeliveryBroadcast(payload) {
  const s = getIo();
  if (!s) return;
  s.to("delivery:online").emit("delivery:broadcast", {
    ...payload,
    at: new Date().toISOString(),
  });
}

export function emitToCustomer(customerId, { event, payload }) {
  const s = getIo();
  if (!s || !customerId) return;
  s.to(`customer:${customerId}`).emit(event, payload);
}

/**
 * Notify delivery partners near a CUSTOMER for return pickups.
 * Sends both Socket events (for open app) and Push (for background).
 */
export async function emitReturnBroadcastForCustomer(customerLocation, payload) {
  const s = getIo();
  if (!customerLocation) return;

  const ids = await getDeliveryPartnerIdsWithinCustomerRadius(customerLocation);
  if (!ids.length) {
    if (process.env.NODE_ENV !== "production" && s) {
      s.to("delivery:online").emit("delivery:broadcast", { ...payload, at: new Date().toISOString() });
    }
    return;
  }

  const body = { ...payload, at: new Date().toISOString() };

  if (s) {
    for (const id of ids) {
      s.to(`delivery:${id}`).emit("delivery:broadcast", body);
    }
  }

  // Send Push Notification
  emitNotificationEvent(NOTIFICATION_EVENTS.NEW_RETURN_BROADCAST, {
    orderId: payload.orderId,
    deliveryIds: ids,
  });

  // DB Sync for in-app notification list
  try {
    await Notification.insertMany(
      ids.map((id) => ({
        recipient: new mongoose.Types.ObjectId(id),
        recipientModel: "Delivery",
        title: "New Return Pickup Task",
        message: `Return pickup ${payload.orderId} nearby — tap to Accept.`,
        type: "order",
        data: {
          orderId: payload.orderId,
          type: "RETURN_PICKUP",
          preview: payload.preview || null,
        },
      })),
      { ordered: false }
    );
  } catch (err) {
    console.warn("[emitReturnBroadcastForCustomer] DB error", err.message);
  }
}

export function emitSellerApproved(sellerId, sellerData = {}) {
  const s = getIo();
  if (!s || !sellerId) return;
  const sid = normalizeSellerId(sellerId);
  const payload = {
    sellerId: sid,
    status: "approved",
    isVerified: true,
    isActive: true,
    seller: sellerData,
    at: new Date().toISOString(),
  };
  s.to(`seller:${sid}`).emit("seller:approved", payload);
  s.emit(`seller:approved:${sid}`, payload);
  s.emit("seller:approved", payload);
}

export function emitDeliveryApproved(deliveryId, deliveryData = {}) {
  const s = getIo();
  if (!s || !deliveryId) return;
  const did = normalizeDeliveryId(deliveryId);
  const phone = deliveryData?.phone ? String(deliveryData.phone).replace(/\D/g, "") : "";
  const payload = {
    deliveryId: did,
    phone,
    status: "approved",
    isVerified: true,
    delivery: deliveryData,
    at: new Date().toISOString(),
  };
  s.to(`delivery:${did}`).emit("delivery:approved", payload);
  s.emit(`delivery:approved:${did}`, payload);
  if (phone) {
    s.emit(`delivery:approved:${phone}`, payload);
  }
  s.emit("delivery:approved", payload);
}

