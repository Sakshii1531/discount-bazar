/**
 * A rider's in-progress assignments, straight from the order documents.
 *
 * This is the single source of truth the rider app uses to decide whether a
 * delivery is active and which screen to restore — never the screen that
 * happens to be open or anything cached on the device. Read-only: listing or
 * resuming an order never changes its status.
 */
import mongoose from "mongoose";
import Order from "../../models/order.js";
import { WORKFLOW_STATUS } from "../../constants/orderWorkflow.js";

/** v2 statuses in which the assigned rider still has work to do. */
export const RIDER_ACTIVE_WORKFLOW_STATUSES = Object.freeze([
  WORKFLOW_STATUS.DELIVERY_ASSIGNED,
  WORKFLOW_STATUS.PICKUP_READY,
  WORKFLOW_STATUS.OUT_FOR_DELIVERY,
]);
/** Legacy (v1) equivalents. */
const RIDER_ACTIVE_LEGACY_STATUSES = ["confirmed", "packed", "out_for_delivery"];
/** Return legs the assigned rider still has to complete. */
export const RIDER_ACTIVE_RETURN_STATUSES = Object.freeze([
  "return_pickup_assigned",
  "return_in_transit",
  "return_drop_pending",
]);

/**
 * Concurrent active deliveries a rider may hold. 0 = no limit (the platform's
 * current behaviour: riders may stack orders). Set RIDER_MAX_ACTIVE_ORDERS=1
 * to enforce one-at-a-time; acceptance is then refused server-side.
 */
export const riderMaxActiveOrders = () => {
  const n = parseInt(process.env.RIDER_MAX_ACTIVE_ORDERS || "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

function toOid(id) {
  const s = String(id || "");
  return mongoose.Types.ObjectId.isValid(s) ? new mongoose.Types.ObjectId(s) : null;
}

function activeDeliveryFilter(riderOid) {
  return {
    deliveryBoy: riderOid,
    $or: [
      {
        workflowVersion: { $gte: 2 },
        workflowStatus: { $in: RIDER_ACTIVE_WORKFLOW_STATUSES },
      },
      {
        workflowVersion: { $not: { $gte: 2 } },
        status: { $in: RIDER_ACTIVE_LEGACY_STATUSES },
      },
    ],
  };
}

function activeReturnFilter(riderOid) {
  return {
    returnDeliveryBoy: riderOid,
    returnStatus: { $in: RIDER_ACTIVE_RETURN_STATUSES },
  };
}

/** Stage the rider app should restore, derived only from server fields. */
export function deliveryStage(order) {
  const ws =
    order.workflowVersion >= 2
      ? order.workflowStatus
      : {
          confirmed: WORKFLOW_STATUS.DELIVERY_ASSIGNED,
          packed: WORKFLOW_STATUS.PICKUP_READY,
          out_for_delivery: WORKFLOW_STATUS.OUT_FOR_DELIVERY,
        }[order.status];
  if (ws === WORKFLOW_STATUS.OUT_FOR_DELIVERY) {
    return Number(order.deliveryRiderStep) >= 4 ? "AT_CUSTOMER" : "HEADING_TO_CUSTOMER";
  }
  if (ws === WORKFLOW_STATUS.PICKUP_READY) return "AT_STORE";
  return "HEADING_TO_STORE";
}

export function returnStage(order) {
  if (order.returnStatus === "return_drop_pending") return "RETURN_AT_STORE";
  if (order.returnStatus === "return_in_transit") return "RETURN_TO_STORE";
  return "RETURN_TO_CUSTOMER";
}

const PICKUP_PENDING_STAGES = new Set(["HEADING_TO_STORE", "AT_STORE"]);

function storeOf(order) {
  const seller = order.seller && typeof order.seller === "object" ? order.seller : null;
  return seller
    ? { name: seller.shopName || seller.name || "Store", address: seller.address || "" }
    : null;
}

function customerDropOf(order) {
  const a = order.address || {};
  return {
    name: a.name || "Customer",
    address: [a.address, a.city].filter(Boolean).join(", "),
  };
}

function serialize(order, kind) {
  const stage = kind === "return" ? returnStage(order) : deliveryStage(order);
  const pickupPending = kind === "delivery" && PICKUP_PENDING_STAGES.has(stage);
  return {
    orderId: order.orderId,
    kind,
    stage,
    workflowStatus: order.workflowStatus || null,
    status: order.status || null,
    returnStatus: kind === "return" ? order.returnStatus : null,
    assignmentVersion: order.assignmentVersion || 0,
    // Store details while the parcel still has to be collected (or, for a
    // return, where it is going); customer drop always — the assigned rider is
    // authorized for it. No phone numbers: those come from the contact API.
    store: kind === "return" || pickupPending ? storeOf(order) : null,
    customer: customerDropOf(order),
    paymentMethod: order.payment?.method || null,
    assignedAt: order.assignedAt || null,
    updatedAt: order.updatedAt || null,
    resumePath: `/delivery/order-details/${encodeURIComponent(order.orderId)}`,
  };
}

const LIST_FIELDS =
  "orderId seller address payment status workflowStatus workflowVersion deliveryRiderStep " +
  "returnStatus assignmentVersion assignedAt updatedAt deliveryBoy returnDeliveryBoy";

export async function getRiderActiveOrders(riderId) {
  const riderOid = toOid(riderId);
  if (!riderOid) return { orders: [], maxActiveOrders: riderMaxActiveOrders(), canAcceptMore: false };

  const [deliveries, returns] = await Promise.all([
    Order.find(activeDeliveryFilter(riderOid))
      .select(LIST_FIELDS)
      .populate("seller", "shopName name address")
      .sort({ assignedAt: 1, createdAt: 1 })
      .lean(),
    Order.find(activeReturnFilter(riderOid))
      .select(LIST_FIELDS)
      .populate("seller", "shopName name address")
      .sort({ updatedAt: 1 })
      .lean(),
  ]);

  const orders = [
    ...deliveries.map((o) => serialize(o, "delivery")),
    ...returns.map((o) => serialize(o, "return")),
  ];
  const max = riderMaxActiveOrders();
  return {
    orders,
    maxActiveOrders: max,
    canAcceptMore: !max || orders.length < max,
    serverTime: new Date().toISOString(),
  };
}

export async function countRiderActiveOrders(riderId, { excludeOrderId } = {}) {
  const riderOid = toOid(riderId);
  if (!riderOid) return 0;
  const exclude = excludeOrderId ? { orderId: { $ne: excludeOrderId } } : {};
  const [d, r] = await Promise.all([
    Order.countDocuments({ ...activeDeliveryFilter(riderOid), ...exclude }),
    Order.countDocuments({ ...activeReturnFilter(riderOid), ...exclude }),
  ]);
  return d + r;
}

/** Throws 409 RIDER_AT_CAPACITY when a one-at-a-time (or N) limit is configured and reached. */
export async function assertRiderCanTakeOrder(riderId, orderId) {
  const max = riderMaxActiveOrders();
  if (!max) return;
  const active = await countRiderActiveOrders(riderId, { excludeOrderId: orderId });
  if (active >= max) {
    const err = new Error(
      max === 1
        ? "Finish your current delivery before accepting a new order."
        : `You already have ${active} active deliveries.`,
    );
    err.statusCode = 409;
    err.code = "RIDER_AT_CAPACITY";
    throw err;
  }
}
