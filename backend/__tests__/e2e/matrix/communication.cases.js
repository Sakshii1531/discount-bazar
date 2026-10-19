/**
 * Order communication endpoints (customer/seller ↔ rider chat, contact,
 * Report Issue, Ready for Pickup, operations review). Flow-level behaviour is
 * covered in api-order-communication.e2e.test.js; this matrix pins every
 * route's status and role gating.
 */
import { expect } from "@jest/globals";
import Order from "../../../app/models/order.js";

const CR = "customer_rider";
const SR = "seller_rider";
const order = (ctx) => ({ orderId: ctx.commOrderId });
const cr = (ctx) => ({ orderId: ctx.commOrderId, channel: CR });
const sr = (ctx) => ({ orderId: ctx.commOrderId, channel: SR });

export async function seed(ctx) {
  const doc = await Order.create({
    orderId: `ORDMATRIXCOMM${Date.now()}`,
    customer: ctx.customer._id,
    seller: ctx.seller._id,
    deliveryBoy: ctx.rider._id,
    items: [{ product: ctx.milk._id, name: "Fresh Milk", quantity: 1, price: 55 }],
    address: { name: "Main Customer", address: "12 MG Road", city: "Indore", phone: "9876500002" },
    workflowVersion: 2,
    workflowStatus: "DELIVERY_ASSIGNED",
    status: "confirmed",
    assignmentVersion: 1,
  });
  ctx.commOrderId = doc.orderId;
}

export default [
  {
    route: "GET /api/communication/config",
    as: "customer",
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ chatEnabled: true, messageMaxLength: 500 })),
  },
  {
    route: "GET /api/communication/orders/:orderId",
    as: "customer",
    params: order,
    check: (res) => expect(res.body.result.channels[0]).toEqual(expect.objectContaining({ channel: CR, canSend: true })),
  },
  { route: "GET /api/communication/orders/:orderId", name: "strangers get 404", as: "otherCustomer", params: order, status: 404 },
  {
    route: "POST /api/communication/orders/:orderId/chats/:channel/messages",
    as: "customer",
    params: cr,
    body: { clientMessageId: "matrix_msg_0001", text: "Where are you?" },
    status: 201,
    check: (res) => expect(res.body.result.message.seq).toBe(1),
  },
  {
    route: "POST /api/communication/orders/:orderId/chats/:channel/messages",
    name: "seller cannot post to the customer chat",
    as: "seller",
    params: cr,
    body: { clientMessageId: "matrix_msg_0002", text: "hi" },
    status: 403,
  },
  {
    route: "GET /api/communication/orders/:orderId/chats/:channel/messages",
    as: "delivery",
    params: cr,
    check: (res) => expect(res.body.result.messages).toHaveLength(1),
  },
  {
    route: "POST /api/communication/orders/:orderId/chats/:channel/receipts",
    as: "delivery",
    params: cr,
    body: { readUpToSeq: 1 },
    check: (res) => expect(res.body.result.conversation.receipts.myReadSeq).toBe(1),
  },
  {
    route: "POST /api/communication/orders/:orderId/chats/:channel/contact",
    as: "seller",
    params: sr,
    check: (res) => expect(res.body.result.phone).toEqual(expect.any(String)),
  },
  {
    route: "POST /api/communication/orders/:orderId/issues",
    as: "delivery",
    params: order,
    body: { channel: SR, reason: "ORDER_NOT_READY", note: "Waiting at counter" },
    status: 201,
    check: (res, ctx) => {
      ctx.commIssueId = res.body.result.issue.id;
    },
  },
  {
    route: "POST /api/communication/orders/:orderId/ready-eta",
    as: "seller",
    params: order,
    body: { minutes: 5 },
  },
  {
    route: "POST /api/communication/orders/:orderId/ready-for-pickup",
    as: "seller",
    params: order,
    check: (res) => expect(res.body.result.alreadyReady).toBe(false),
  },
  { route: "POST /api/communication/orders/:orderId/ready-for-pickup", name: "customers are denied", as: "customer", params: order, status: 403 },
  {
    route: "GET /api/communication/admin/events",
    as: "admin",
    query: (ctx) => ({ orderId: ctx.commOrderId }),
    check: (res) => expect(res.body.result.items.length).toBeGreaterThan(0),
  },
  { route: "GET /api/communication/admin/events", name: "non-admins are denied", as: "seller", status: 403 },
  {
    route: "GET /api/communication/admin/issues",
    as: "admin",
    check: (res) => expect(res.body.result.items[0].reason).toBe("ORDER_NOT_READY"),
  },
  {
    route: "PATCH /api/communication/admin/issues/:issueId",
    as: "admin",
    params: (ctx) => ({ issueId: ctx.commIssueId }),
    body: { status: "resolved", resolutionNote: "Seller handed over" },
    check: (res) => expect(res.body.result.status).toBe("resolved"),
  },
  {
    route: "GET /api/communication/admin/orders/:orderId/conversations",
    as: "admin",
    params: order,
    check: (res) => expect(res.body.result.conversations[0].messages[0].text).toBe("Where are you?"),
  },
];
