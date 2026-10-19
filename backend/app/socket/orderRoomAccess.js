/**
 * Authorization for `order:<id>` socket rooms. Knowing an order ID is not
 * enough to subscribe to its live updates: the socket's user must be a party
 * to the order right now. Room ids may be the human orderId, the Mongo _id,
 * or (for the customer's post-checkout screen) a checkoutGroupId.
 */
import mongoose from "mongoose";
import Order from "../models/order.js";
import { WORKFLOW_STATUS } from "../constants/orderWorkflow.js";

const RETURN_BROADCAST_STATUSES = ["return_approved", "return_pickup_assigned"];

function roomMatch(roomId) {
  const raw = String(roomId || "").trim();
  if (!raw || raw.length > 64) return null;
  const or = [{ orderId: raw }, { checkoutGroupId: raw }];
  if (mongoose.Types.ObjectId.isValid(raw) && String(new mongoose.Types.ObjectId(raw)) === raw) {
    or.push({ _id: new mongoose.Types.ObjectId(raw) });
  }
  return { $or: or };
}

function asObjectId(id) {
  const s = String(id || "");
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

/** True when `user` may receive live updates for `roomId`. */
export async function canJoinOrderRoom(user, roomId) {
  const role = String(user?.role || "").toLowerCase();
  if (role === "admin") return true;
  const match = roomMatch(roomId);
  const uid = asObjectId(user?.id);
  if (!match || !uid) return false;

  if (role === "customer" || role === "user") {
    return Boolean(await Order.exists({ ...match, customer: uid }));
  }
  if (role === "seller") {
    return Boolean(await Order.exists({ ...match, seller: uid }));
  }
  if (role === "delivery") {
    // Assigned (delivery or return) rider, or a rider looking at an order
    // that is still being offered to nearby riders. Once someone else wins,
    // `evictUnauthorizedFromOrderRoom` removes the losers.
    return Boolean(
      await Order.exists({
        ...match,
        $and: [
          {
            $or: [
              { deliveryBoy: uid },
              { returnDeliveryBoy: uid },
              { deliveryBoy: null, workflowStatus: WORKFLOW_STATUS.DELIVERY_SEARCH },
              { returnDeliveryBoy: null, returnStatus: { $in: RETURN_BROADCAST_STATUSES } },
            ],
          },
        ],
      }),
    );
  }
  return false;
}

/**
 * Re-check every socket in the order's rooms and drop the ones that are no
 * longer entitled (losing broadcast riders, a reassigned rider). Called after
 * each order status change.
 */
export async function evictUnauthorizedFromOrderRoom(io, order) {
  if (!io || !order) return 0;
  const rooms = [order.orderId, order._id && String(order._id)]
    .filter(Boolean)
    .map((id) => [id, `order:${id}`]);
  let evicted = 0;
  for (const [id, room] of rooms) {
    let sockets = [];
    try {
      sockets = await io.in(room).fetchSockets();
    } catch {
      continue;
    }
    for (const s of sockets) {
      if (String(s.data?.user?.role || "").toLowerCase() === "admin") continue;
      if (!(await canJoinOrderRoom(s.data?.user, id))) {
        s.leave(room);
        evicted += 1;
      }
    }
  }
  return evicted;
}
