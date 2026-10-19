/**
 * Socket.IO — order rooms, role rooms, JWT auth.
 */
import { verifySocketToken } from "./socketAuth.js";
import mongoose from "mongoose";
import Ticket from "../models/ticket.js";
import { canJoinOrderRoom, evictUnauthorizedFromOrderRoom } from "./orderRoomAccess.js";

let _io = null;

const deliverySockets = new Map();

export const initSocket = (io) => {
  _io = io;

  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.query?.token ||
      null;
    if (!token) {
      socket.user = null;
      return next();
    }
    const user = verifySocketToken(token);
    if (!user) {
      return next(new Error("Unauthorized"));
    }
    socket.user = user;
    // Readable from fetchSockets() (RemoteSocket) for room re-validation.
    socket.data.user = { id: user.id, role: user.role };
    next();
  });

  io.on("connection", (socket) => {
    const { id: userId, role } = socket.user || {};
    if (!userId) {
      return;
    }

    if (role === "delivery") {
      const dId = userId.toString();
      deliverySockets.set(dId, socket.id);
      socket.join("delivery:online");
      socket.join(`delivery:${dId}`);
    }
    if (role === "seller") {
      socket.join(`seller:${userId}`);
    }
    if (role === "customer" || role === "user") {
      socket.join(`customer:${userId}`);
    }
    if (role === "admin") {
      socket.join("admin:orders");
      socket.join("admin:support");
      // Per-admin room — used by the notification service to push
      // `notification:new` deltas to the specific admin who owns the
      // Notification row, so the topbar can refresh without polling.
      socket.join(`admin:${userId}`);
    }

    socket.on("join_order", async (orderId, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      if (!orderId || typeof orderId !== "string") return reply({ ok: false });
      try {
        // Order rooms carry live status for that order; only its current
        // parties may subscribe, never someone who merely knows the ID.
        if (!(await canJoinOrderRoom(socket.user, orderId))) {
          return reply({ ok: false, code: "ACCESS_DENIED" });
        }
        socket.join(`order:${orderId}`);
        return reply({ ok: true });
      } catch {
        return reply({ ok: false });
      }
    });

    socket.on("leave_order", (orderId) => {
      if (!orderId) return;
      socket.leave(`order:${orderId}`);
    });

    socket.on("join_ticket", async (ticketId) => {
      const raw = typeof ticketId === "string" ? ticketId.trim() : "";
      if (!raw || !mongoose.Types.ObjectId.isValid(raw)) return;

      if (socket.user?.role === "admin") {
        socket.join(`ticket:${raw}`);
        return;
      }

      try {
        const ticket = await Ticket.findById(raw).select("userId").lean();
        if (!ticket?.userId) return;
        if (ticket.userId.toString() !== userId.toString()) return;
        socket.join(`ticket:${raw}`);
      } catch {
        /* ignore */
      }
    });

    socket.on("leave_ticket", (ticketId) => {
      if (!ticketId) return;
      socket.leave(`ticket:${String(ticketId).trim()}`);
    });

    // Order chat presence. The server authorizes against the live order and
    // current rider before joining; the room only suppresses redundant pushes
    // — message delivery itself goes to the user's role room.
    socket.on("chat:viewing", async (body, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const { orderId, channel } = body || {};
        if (typeof orderId !== "string" || typeof channel !== "string") {
          return reply({ ok: false });
        }
        const { authorizeViewing } = await import(
          "../services/communication/communicationService.js"
        );
        const room = await authorizeViewing(socket.user, orderId, channel);
        if (!room) return reply({ ok: false });
        for (const joined of socket.rooms) {
          if (joined.startsWith("chatview:")) socket.leave(joined);
        }
        socket.join(room);
        return reply({ ok: true });
      } catch (error) {
        return reply({ ok: false, code: error.code || "ACCESS_DENIED" });
      }
    });

    socket.on("chat:not_viewing", () => {
      for (const joined of socket.rooms) {
        if (joined.startsWith("chatview:")) socket.leave(joined);
      }
    });

    socket.on("register_delivery", (deliveryId) => {
      if (deliveryId && socket.user?.role === "delivery") {
        deliverySockets.set(deliveryId.toString(), socket.id);
      }
    });

    socket.on("disconnect", () => {
      for (const [id, sid] of deliverySockets.entries()) {
        if (sid === socket.id) {
          deliverySockets.delete(id);
          break;
        }
      }
    });
  });
};

export const getIO = () => {
  if (!_io) throw new Error("Socket.IO not initialized");
  return _io;
};

/**
 * True when the user has the conversation open on a connected device. Only
 * meaningful in the API process (where sockets live); elsewhere returns false
 * so the push still goes out.
 */
export async function isRecipientViewing(conversationId, userId) {
  if (!_io || !conversationId || !userId) return false;
  try {
    const sockets = await _io
      .in(`chatview:${conversationId}:${userId}`)
      .fetchSockets();
    return sockets.length > 0;
  } catch {
    return false;
  }
}

/** Drop sockets that lost their entitlement to an order's room (best-effort). */
export async function revalidateOrderRoom(order) {
  try {
    return await evictUnauthorizedFromOrderRoom(_io, order);
  } catch {
    return 0;
  }
}

export const notifyDeliveryPartners = (orderData) => {
  if (!_io) return;
  _io.to("delivery:online").emit("new_order_packed", orderData);
};
