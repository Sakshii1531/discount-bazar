/**
 * API E2E — order communication: customer ↔ rider and seller ↔ rider chat,
 * native-dialer contact lookup, seller "Ready for Pickup", Report Issue, and
 * the lifecycle rules (assignment, reassignment, pickup, completion).
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Order from "../../app/models/order.js";
import OrderConversation from "../../app/models/orderConversation.js";
import OrderChatMessage from "../../app/models/orderChatMessage.js";
import CommunicationIssue from "../../app/models/communicationIssue.js";
import CommunicationEvent from "../../app/models/communicationEvent.js";
import Ticket from "../../app/models/ticket.js";
import {
  syncCommunicationState,
  checkNotificationRelevance,
  escalateStalePickupIssues,
} from "../../app/services/communication/communicationService.js";
import {
  canJoinOrderRoom,
  evictUnauthorizedFromOrderRoom,
} from "../../app/socket/orderRoomAccess.js";

jest.setTimeout(120000);

const CR = "customer_rider";
const SR = "seller_rider";
const base = (orderId) => `/api/communication/orders/${orderId}`;
const chat = (orderId, channel) => `${base(orderId)}/chats/${channel}`;

let app;
let n = 0;
const cid = () => `msg_${Date.now()}_${(n += 1)}`;

let customer;
let otherCustomer;
let seller;
let otherSeller;
let rider;
let rider2;
let admin;
let auth;

async function makeOrder(overrides = {}) {
  n += 1;
  const order = await Order.create({
    orderId: `ORDCOMM${Date.now()}${n}`,
    customer: customer._id,
    seller: seller._id,
    items: [{ product: seller._id, name: "Milk", quantity: 1, price: 50 }],
    address: {
      name: "Asha",
      address: "12 MG Road",
      city: "Indore",
      phone: "9876500001",
      location: { lat: fx.STORE_LOCATION.lat, lng: fx.STORE_LOCATION.lng },
    },
    workflowVersion: 2,
    workflowStatus: "DELIVERY_SEARCH",
    status: "confirmed",
    sellerAcceptedAt: new Date(),
    ...overrides,
  });
  return order.toObject();
}

async function assign(order, riderDoc = rider, status = "DELIVERY_ASSIGNED") {
  await Order.updateOne(
    { _id: order._id },
    {
      $set: {
        deliveryBoy: riderDoc._id,
        workflowStatus: status,
        assignedAt: new Date(),
      },
      $inc: { assignmentVersion: 1 },
    },
  );
  await syncCommunicationState(order.orderId);
}

async function setStatus(order, workflowStatus, extra = {}) {
  await Order.updateOne({ _id: order._id }, { $set: { workflowStatus, ...extra } });
  await syncCommunicationState(order.orderId);
}

const send = (orderId, channel, who, body) =>
  request(app).post(`${chat(orderId, channel)}/messages`).set("Authorization", who).send(body);

beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
  await Promise.all([
    OrderConversation.init(),
    OrderChatMessage.init(),
    CommunicationIssue.init(),
    CommunicationEvent.init(),
  ]);
});
afterAll(stopTestApp);

beforeEach(async () => {
  customer = await fx.createCustomer({ name: "Asha" });
  otherCustomer = await fx.createCustomer({ name: "Mallory" });
  seller = await fx.createSeller({ shopName: "Main Mart" });
  otherSeller = await fx.createSeller({ shopName: "Other Mart" });
  rider = await fx.createDelivery({ name: "Ravi" });
  rider2 = await fx.createDelivery({ name: "Sunil" });
  admin = await fx.createAdmin();
  auth = {
    customer: bearer("customer", customer._id),
    otherCustomer: bearer("customer", otherCustomer._id),
    seller: bearer("seller", seller._id),
    otherSeller: bearer("seller", otherSeller._id),
    rider: bearer("delivery", rider._id),
    rider2: bearer("delivery", rider2._id),
    admin: bearer("admin", admin._id),
  };
});
afterEach(clearDatabase);

describe("before a rider is assigned", () => {
  it("shows a waiting state and no active contact options", async () => {
    const order = await makeOrder();
    const res = await request(app).get(base(order.orderId)).set("Authorization", auth.customer);
    expect(res.status).toBe(200);
    expect(res.body.result.assignment).toEqual(
      expect.objectContaining({ assigned: false, waitingForRider: true }),
    );
    const [cr] = res.body.result.channels;
    expect(cr).toEqual(
      expect.objectContaining({ channel: CR, allowed: false, canSend: false, canCall: false, reason: "RIDER_NOT_ASSIGNED" }),
    );
    expect(cr.counterpartName).toBeNull();
  });

  it("rejects chat and calls", async () => {
    const order = await makeOrder();
    const msg = await send(order.orderId, CR, auth.customer, { clientMessageId: cid(), text: "hi" });
    expect(msg.status).toBe(403);
    expect(msg.body.result.code).toBe("RIDER_NOT_ASSIGNED");
    const call = await request(app).post(`${chat(order.orderId, CR)}/contact`).set("Authorization", auth.customer);
    expect(call.status).toBe(403);
  });

  it("flags a delayed assignment after the configured wait", async () => {
    const order = await makeOrder({ sellerAcceptedAt: new Date(Date.now() - 60 * 60000) });
    const res = await request(app).get(base(order.orderId)).set("Authorization", auth.customer);
    expect(res.body.result.assignment.delayed).toBe(true);
  });
});

describe("customer ↔ rider chat", () => {
  it("stores a message once even when the send is retried", async () => {
    const order = await makeOrder();
    await assign(order);
    const id = cid();
    const first = await send(order.orderId, CR, auth.customer, { clientMessageId: id, text: "  Where are you?  " });
    expect(first.status).toBe(201);
    expect(first.body.result.message).toEqual(
      expect.objectContaining({ seq: 1, senderRole: "customer", mine: true, text: "Where are you?", orderId: order.orderId }),
    );
    const retry = await send(order.orderId, CR, auth.customer, { clientMessageId: id, text: "Where are you?" });
    expect(retry.status).toBe(200);
    expect(retry.body.result.duplicate).toBe(true);
    expect(retry.body.result.message.id).toBe(first.body.result.message.id);
    expect(await OrderChatMessage.countDocuments({ orderId: order.orderId })).toBe(1);
  });

  it("takes sender identity from the session, never the request body", async () => {
    const order = await makeOrder();
    await assign(order);
    const res = await send(order.orderId, CR, auth.customer, {
      clientMessageId: cid(),
      text: "I am the rider",
      senderRole: "delivery",
      senderId: String(rider._id),
    });
    expect(res.status).toBe(201);
    const stored = await OrderChatMessage.findOne({ orderId: order.orderId }).lean();
    expect(stored.senderRole).toBe("customer");
    expect(String(stored.senderId)).toBe(String(customer._id));
  });

  it("syncs both directions in server order with truthful receipts", async () => {
    const order = await makeOrder();
    await assign(order);
    await send(order.orderId, CR, auth.customer, { clientMessageId: cid(), text: "Please call me" });
    await send(order.orderId, CR, auth.rider, { clientMessageId: cid(), text: "5 minutes away" });

    const riderView = await request(app).get(`${chat(order.orderId, CR)}/messages`).set("Authorization", auth.rider);
    expect(riderView.status).toBe(200);
    expect(riderView.body.result.messages.map((m) => [m.seq, m.senderRole, m.mine])).toEqual([
      [1, "customer", false],
      [2, "delivery", true],
    ]);
    // Other party's clientMessageId is not leaked.
    expect(riderView.body.result.messages[0].clientMessageId).toBeUndefined();

    // Nothing is delivered or read until the rider's app confirms it —
    // not even by replying.
    let custView = await request(app).get(`${chat(order.orderId, CR)}/messages`).set("Authorization", auth.customer);
    expect(custView.body.result.conversation.receipts).toEqual(
      expect.objectContaining({ peerDeliveredSeq: 0, peerReadSeq: 0 }),
    );
    const r = await request(app)
      .post(`${chat(order.orderId, CR)}/receipts`)
      .set("Authorization", auth.rider)
      .send({ deliveredUpToSeq: 999, readUpToSeq: 1 });
    expect(r.status).toBe(200);
    custView = await request(app).get(`${chat(order.orderId, CR)}/messages`).set("Authorization", auth.customer);
    expect(custView.body.result.conversation.receipts).toEqual(
      // Delivered is clamped to the last real seq; read stays where the app put it.
      expect.objectContaining({ peerDeliveredSeq: 2, peerReadSeq: 1 }),
    );

    // Forward sync after reconnect returns only newer messages.
    const after = await request(app)
      .get(`${chat(order.orderId, CR)}/messages`)
      .query({ afterSeq: 1 })
      .set("Authorization", auth.customer);
    expect(after.body.result.messages.map((m) => m.seq)).toEqual([2]);
  });

  it("counts unread messages for the recipient only", async () => {
    const order = await makeOrder();
    await assign(order);
    await send(order.orderId, CR, auth.customer, { clientMessageId: cid(), text: "one" });
    await send(order.orderId, CR, auth.customer, { clientMessageId: cid(), text: "two" });
    const riderState = await request(app).get(base(order.orderId)).set("Authorization", auth.rider);
    const cr = riderState.body.result.channels.find((c) => c.channel === CR);
    expect(cr.unread).toBe(2);
    const custState = await request(app).get(base(order.orderId)).set("Authorization", auth.customer);
    expect(custState.body.result.channels[0].unread).toBe(0);
  });

  it.each([
    ["empty text", { text: "   " }, "EMPTY_MESSAGE"],
    ["too long", { text: "x".repeat(501) }, "MESSAGE_TOO_LONG"],
    ["non-text payload", { text: { file: "evil.exe" } }, "UNSUPPORTED_CONTENT"],
    ["missing clientMessageId", { clientMessageId: undefined, text: "hi" }, "INVALID_CLIENT_ID"],
  ])("rejects %s", async (_label, patch, code) => {
    const order = await makeOrder();
    await assign(order);
    const res = await send(order.orderId, CR, auth.customer, { clientMessageId: cid(), ...patch });
    expect(res.status).toBe(400);
    expect(res.body.result.code).toBe(code);
    expect(await OrderChatMessage.countDocuments({})).toBe(0);
  });

  it("denies unrelated users and wrong channels without revealing the order", async () => {
    const order = await makeOrder();
    await assign(order);
    await send(order.orderId, CR, auth.customer, { clientMessageId: cid(), text: "private" });

    const stranger = await request(app).get(`${chat(order.orderId, CR)}/messages`).set("Authorization", auth.otherCustomer);
    expect(stranger.status).toBe(404);
    const otherRider = await request(app).get(`${chat(order.orderId, CR)}/messages`).set("Authorization", auth.rider2);
    expect(otherRider.status).toBe(404);
    const sellerOnCustomerChat = await request(app).get(`${chat(order.orderId, CR)}/messages`).set("Authorization", auth.seller);
    expect(sellerOnCustomerChat.status).toBe(403);
    const customerOnPickupChat = await request(app).get(`${chat(order.orderId, SR)}/messages`).set("Authorization", auth.customer);
    expect(customerOnPickupChat.status).toBe(403);
    const otherSellerState = await request(app).get(base(order.orderId)).set("Authorization", auth.otherSeller);
    expect(otherSellerState.status).toBe(404);
    const bogus = await request(app).get(`${chat(order.orderId, "admin_rider")}/messages`).set("Authorization", auth.customer);
    expect(bogus.status).toBe(400);
  });

  it("becomes read-only history once the order is delivered", async () => {
    const order = await makeOrder();
    await assign(order);
    await send(order.orderId, CR, auth.customer, { clientMessageId: cid(), text: "thanks" });
    await setStatus(order, "DELIVERED", { deliveredAt: new Date() });

    const res = await send(order.orderId, CR, auth.customer, { clientMessageId: cid(), text: "one more" });
    expect(res.status).toBe(403);
    const history = await request(app).get(`${chat(order.orderId, CR)}/messages`).set("Authorization", auth.customer);
    expect(history.status).toBe(200);
    expect(history.body.result.access).toEqual(expect.objectContaining({ allowed: true, canSend: false, readOnly: true }));
    expect(history.body.result.messages).toHaveLength(1);
    const conv = await OrderConversation.findOne({ orderId: order.orderId, channel: CR }).lean();
    expect(conv.status).toBe("closed");
    const call = await request(app).post(`${chat(order.orderId, CR)}/contact`).set("Authorization", auth.customer);
    expect(call.status).toBe(403);
  });
});

describe("native-dialer contact", () => {
  it("returns the current counterpart's number with a disclosure, and audits the request", async () => {
    const order = await makeOrder();
    await assign(order);
    const res = await request(app).post(`${chat(order.orderId, CR)}/contact`).set("Authorization", auth.customer);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.result.phone).toBe(rider.phone);
    expect(res.body.result.disclosure).toMatch(/number will be visible/i);
    const riderSide = await request(app).post(`${chat(order.orderId, CR)}/contact`).set("Authorization", auth.rider);
    expect(riderSide.body.result.phone).toBe("9876500001");
    const events = await CommunicationEvent.find({ orderId: order.orderId, type: "CONTACT_NUMBER_REQUESTED" }).lean();
    expect(events).toHaveLength(2);
    expect(JSON.stringify(events)).not.toContain(rider.phone);
  });

  it("never ships the rider's phone inside order payloads", async () => {
    const order = await makeOrder();
    await assign(order);
    const detail = await request(app).get(`/api/orders/details/${order.orderId}`).set("Authorization", auth.customer);
    expect(detail.status).toBe(200);
    expect(detail.body.result.deliveryBoy.name).toBe("Ravi");
    expect(detail.body.result.deliveryBoy.phone).toBeUndefined();
  });
});

describe("rider reassignment", () => {
  it("moves access to the new rider and revokes the old one", async () => {
    const order = await makeOrder();
    await assign(order);
    await send(order.orderId, CR, auth.customer, { clientMessageId: cid(), text: "gate code is 1234" });

    const reassign = await request(app)
      .put(`/api/orders/status/${order.orderId}`)
      .set("Authorization", auth.admin)
      .send({ deliveryBoyId: String(rider2._id) });
    expect(reassign.status).toBe(200);
    await syncCommunicationState(order.orderId);

    const old = await OrderConversation.findOne({ orderId: order.orderId, riderId: rider._id }).lean();
    expect(old.status).toBe("revoked");
    expect(await CommunicationEvent.countDocuments({ orderId: order.orderId, type: "RIDER_REASSIGNED" })).toBe(1);
    expect(await CommunicationEvent.countDocuments({ orderId: order.orderId, type: "ACCESS_REVOKED" })).toBe(1);

    // Old rider: no reads, no sends, no number.
    expect((await request(app).get(`${chat(order.orderId, CR)}/messages`).set("Authorization", auth.rider)).status).toBe(404);
    expect((await send(order.orderId, CR, auth.rider, { clientMessageId: cid(), text: "still here" })).status).toBe(404);
    expect((await request(app).post(`${chat(order.orderId, CR)}/contact`).set("Authorization", auth.rider)).status).toBe(404);

    // New rider starts clean — no inherited private history.
    const fresh = await request(app).get(`${chat(order.orderId, CR)}/messages`).set("Authorization", auth.rider2);
    expect(fresh.status).toBe(200);
    expect(fresh.body.result.messages).toEqual([]);
    const state = await request(app).get(base(order.orderId)).set("Authorization", auth.rider2);
    expect(state.body.result.handover).toEqual(expect.objectContaining({ reassigned: true }));

    // Customer now reaches only the new rider.
    const call = await request(app).post(`${chat(order.orderId, CR)}/contact`).set("Authorization", auth.customer);
    expect(call.body.result.phone).toBe(rider2.phone);

    // Re-running the sync is a no-op.
    await syncCommunicationState(order.orderId);
    expect(await CommunicationEvent.countDocuments({ orderId: order.orderId, type: "RIDER_REASSIGNED" })).toBe(1);
  });

  it("suppresses queued notifications that belong to the old assignment", async () => {
    const order = await makeOrder();
    await assign(order);
    const check = {
      kind: "chat",
      orderId: order.orderId,
      channel: CR,
      riderId: String(rider._id),
      recipientRole: "delivery",
      recipientId: String(rider._id),
    };
    expect((await checkNotificationRelevance(check)).relevant).toBe(true);
    await Order.updateOne({ _id: order._id }, { $set: { deliveryBoy: rider2._id } });
    expect(await checkNotificationRelevance(check)).toEqual({ relevant: false, reason: "RIDER_REASSIGNED" });
  });

  it("only operations can reassign", async () => {
    const order = await makeOrder();
    await assign(order);
    const res = await request(app)
      .put(`/api/orders/status/${order.orderId}`)
      .set("Authorization", auth.seller)
      .send({ deliveryBoyId: String(rider2._id) });
    expect(res.status).toBe(403);
    const fresh = await Order.findById(order._id).lean();
    expect(String(fresh.deliveryBoy)).toBe(String(rider._id));
  });
});

describe("seller ↔ rider pickup flow", () => {
  it("retains Ready for Pickup until a rider is assigned, idempotently", async () => {
    const order = await makeOrder();
    const first = await request(app).post(`${base(order.orderId)}/ready-for-pickup`).set("Authorization", auth.seller);
    expect(first.status).toBe(200);
    expect(first.body.result.alreadyReady).toBe(false);
    const again = await request(app).post(`${base(order.orderId)}/ready-for-pickup`).set("Authorization", auth.seller);
    expect(again.body.result.alreadyReady).toBe(true);
    expect(await CommunicationEvent.countDocuments({ orderId: order.orderId, type: "SELLER_MARKED_READY" })).toBe(1);

    // The flag never changes the workflow status on its own.
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.workflowStatus).toBe("DELIVERY_SEARCH");
    expect(fresh.sellerReadyAt).toBeTruthy();

    await assign(order);
    const riderState = await request(app).get(base(order.orderId)).set("Authorization", auth.rider);
    expect(riderState.body.result.pickup.sellerReadyAt).toBeTruthy();
  });

  it("rejects Ready for Pickup from other sellers and on ineligible orders", async () => {
    const order = await makeOrder();
    expect((await request(app).post(`${base(order.orderId)}/ready-for-pickup`).set("Authorization", auth.otherSeller)).status).toBe(404);
    expect((await request(app).post(`${base(order.orderId)}/ready-for-pickup`).set("Authorization", auth.customer)).status).toBe(403);
    const cancelled = await makeOrder({ workflowStatus: "CANCELLED", status: "cancelled" });
    const res = await request(app).post(`${base(cancelled.orderId)}/ready-for-pickup`).set("Authorization", auth.seller);
    expect(res.status).toBe(409);
  });

  it("records a readiness estimate without marking the order picked up", async () => {
    const order = await makeOrder();
    await assign(order);
    const res = await request(app).post(`${base(order.orderId)}/ready-eta`).set("Authorization", auth.seller).send({ minutes: 10 });
    expect(res.status).toBe(200);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.sellerReadyEtaAt).toBeTruthy();
    expect(fresh.workflowStatus).toBe("DELIVERY_ASSIGNED");
  });

  it("opens seller ↔ rider chat on assignment and closes it after pickup", async () => {
    const order = await makeOrder();
    await assign(order);
    expect((await send(order.orderId, SR, auth.rider, { clientMessageId: cid(), text: "I have arrived" })).status).toBe(201);
    expect((await send(order.orderId, SR, auth.seller, { clientMessageId: cid(), text: "Coming" })).status).toBe(201);

    // Messaging alone never moves the order.
    expect((await Order.findById(order._id).lean()).workflowStatus).toBe("DELIVERY_ASSIGNED");

    await setStatus(order, "OUT_FOR_DELIVERY", { pickupConfirmedAt: new Date() });
    expect((await send(order.orderId, SR, auth.seller, { clientMessageId: cid(), text: "bye" })).status).toBe(403);
    // Customer delivery chat continues.
    expect((await send(order.orderId, CR, auth.customer, { clientMessageId: cid(), text: "ok" })).status).toBe(201);
    expect(await CommunicationEvent.countDocuments({ orderId: order.orderId, type: "PICKUP_CONFIRMED" })).toBe(1);

    // Seller and customer never see each other's conversation.
    const sellerState = await request(app).get(base(order.orderId)).set("Authorization", auth.seller);
    expect(sellerState.body.result.channels.map((c) => c.channel)).toEqual([SR]);
  });

  it("confirms pickup exactly once across retries", async () => {
    const order = await makeOrder();
    await assign(order);
    const body = { lat: fx.STORE_LOCATION.lat, lng: fx.STORE_LOCATION.lng };
    const url = `/api/orders/workflow/${order.orderId}/pickup/confirm`;
    const first = await request(app).post(url).set("Authorization", auth.rider).send(body);
    expect(first.status).toBe(200);
    const firstAt = (await Order.findById(order._id).lean()).pickupConfirmedAt;
    const retry = await request(app).post(url).set("Authorization", auth.rider).send(body);
    expect(retry.status).toBe(200);
    const fresh = await Order.findById(order._id).lean();
    expect(fresh.workflowStatus).toBe("OUT_FOR_DELIVERY");
    expect(fresh.pickupConfirmedAt.getTime()).toBe(firstAt.getTime());
    // A rider who is not assigned still cannot confirm.
    expect((await request(app).post(url).set("Authorization", auth.rider2).send(body)).status).toBe(409);
  });
});

describe("Report Issue", () => {
  it("records a pickup issue, routes it to support, and dedupes retries", async () => {
    const order = await makeOrder();
    await assign(order);
    const body = { channel: SR, reason: "ORDER_NOT_READY", note: "Waiting 10 min", clientRequestId: cid() };
    const res = await request(app).post(`${base(order.orderId)}/issues`).set("Authorization", auth.rider).send(body);
    expect(res.status).toBe(201);
    expect(res.body.result.issue).toEqual(
      expect.objectContaining({ reason: "ORDER_NOT_READY", isPickupDelay: true, status: "open", reporterRole: "delivery" }),
    );
    expect(res.body.result.issue.ticketId).toBeTruthy();
    expect(await Ticket.countDocuments({})).toBe(1);

    const retry = await request(app).post(`${base(order.orderId)}/issues`).set("Authorization", auth.rider).send(body);
    expect(retry.status).toBe(200);
    expect(retry.body.result.issue.id).toBe(res.body.result.issue.id);
    expect(await CommunicationIssue.countDocuments({})).toBe(1);

    // Reporting never changes the order.
    expect((await Order.findById(order._id).lean()).workflowStatus).toBe("DELIVERY_ASSIGNED");
  });

  it("validates reason and reporter relationship", async () => {
    const order = await makeOrder();
    await assign(order);
    const bad = await request(app)
      .post(`${base(order.orderId)}/issues`)
      .set("Authorization", auth.customer)
      .send({ channel: CR, reason: "ORDER_NOT_READY" });
    expect(bad.status).toBe(400);
    const wrongChannel = await request(app)
      .post(`${base(order.orderId)}/issues`)
      .set("Authorization", auth.customer)
      .send({ channel: SR, reason: "OTHER" });
    expect(wrongChannel.status).toBe(403);
    const stranger = await request(app)
      .post(`${base(order.orderId)}/issues`)
      .set("Authorization", auth.otherCustomer)
      .send({ channel: CR, reason: "OTHER" });
    expect(stranger.status).toBe(404);
  });

  it("escalates a stale pickup delay to operations once", async () => {
    const order = await makeOrder();
    await assign(order);
    const res = await request(app)
      .post(`${base(order.orderId)}/issues`)
      .set("Authorization", auth.rider)
      .send({ channel: SR, reason: "SHOP_CLOSED" });
    await CommunicationIssue.collection.updateOne(
      { _id: new (await import("mongoose")).default.Types.ObjectId(res.body.result.issue.id) },
      { $set: { createdAt: new Date(Date.now() - 60 * 60000) } },
    );
    expect(await escalateStalePickupIssues()).toEqual({ escalated: 1 });
    expect(await escalateStalePickupIssues()).toEqual({ escalated: 0 });
  });
});

describe("operations review", () => {
  it("lists events/issues and audit-logs conversation reads", async () => {
    const order = await makeOrder();
    await assign(order);
    await send(order.orderId, CR, auth.customer, { clientMessageId: cid(), text: "hello" });

    const events = await request(app)
      .get("/api/communication/admin/events")
      .query({ orderId: order.orderId })
      .set("Authorization", auth.admin);
    expect(events.status).toBe(200);
    expect(events.body.result.items.map((e) => e.type)).toContain("RIDER_ASSIGNED");

    const convs = await request(app)
      .get(`/api/communication/admin/orders/${order.orderId}/conversations`)
      .set("Authorization", auth.admin);
    expect(convs.status).toBe(200);
    expect(convs.body.result.conversations[0].messages[0].text).toBe("hello");
    expect(await CommunicationEvent.countDocuments({ orderId: order.orderId, type: "ADMIN_VIEWED_CONVERSATION" })).toBe(1);

    const denied = await request(app)
      .get(`/api/communication/admin/orders/${order.orderId}/conversations`)
      .set("Authorization", auth.customer);
    expect(denied.status).toBe(403);
  });
});

describe("order live-update rooms", () => {
  const as = (role, doc) => ({ role, id: String(doc._id) });

  it("lets only the order's current parties subscribe", async () => {
    const order = await makeOrder({ checkoutGroupId: `CHK-${Date.now()}` });
    // Broadcast phase: any rider may look at the offer.
    expect(await canJoinOrderRoom(as("delivery", rider2), order.orderId)).toBe(true);

    await assign(order);
    for (const id of [order.orderId, String(order._id), order.checkoutGroupId]) {
      expect(await canJoinOrderRoom(as("customer", customer), id)).toBe(true);
    }
    expect(await canJoinOrderRoom(as("seller", seller), order.orderId)).toBe(true);
    expect(await canJoinOrderRoom(as("delivery", rider), order.orderId)).toBe(true);
    expect(await canJoinOrderRoom({ role: "admin", id: String(admin._id) }, order.orderId)).toBe(true);

    // Knowing the ID is not enough.
    expect(await canJoinOrderRoom(as("customer", otherCustomer), order.orderId)).toBe(false);
    expect(await canJoinOrderRoom(as("customer", otherCustomer), order.checkoutGroupId)).toBe(false);
    expect(await canJoinOrderRoom(as("seller", otherSeller), order.orderId)).toBe(false);
    expect(await canJoinOrderRoom(as("delivery", rider2), order.orderId)).toBe(false);
    expect(await canJoinOrderRoom(null, order.orderId)).toBe(false);
    expect(await canJoinOrderRoom(as("customer", customer), "ORD-DOES-NOT-EXIST")).toBe(false);
  });

  it("evicts riders who lost the broadcast or were reassigned", async () => {
    const order = await makeOrder();
    await assign(order);
    const left = [];
    const fakeSocket = (role, doc) => ({
      data: { user: as(role, doc) },
      leave: (room) => left.push([String(doc._id), room]),
    });
    const members = [
      fakeSocket("delivery", rider),
      fakeSocket("delivery", rider2), // joined during broadcast, lost
      fakeSocket("customer", customer),
    ];
    const io = { in: () => ({ fetchSockets: async () => members }) };

    expect(await evictUnauthorizedFromOrderRoom(io, order)).toBe(2); // orderId room + _id room
    expect(left.every(([id]) => id === String(rider2._id))).toBe(true);
  });
});

