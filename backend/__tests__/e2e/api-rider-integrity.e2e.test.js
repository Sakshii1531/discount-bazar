/**
 * API E2E — rider app integrity: sign-in, approval / online gating, offer
 * acceptance, the delivery hand-over OTP, COD and withdrawals, history.
 * Each block is a regression test for a defect found while testing the rider
 * flows (TESTING.md, "Rider app").
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import Order from "../../app/models/order.js";
import OrderOtp from "../../app/models/orderOtp.js";
import Delivery from "../../app/models/delivery.js";
import Transaction from "../../app/models/transaction.js";

jest.setTimeout(120000);

let app;
let n = 0;
let customer;
let seller;
let rider;
let rider2;
let auth;

const BANK = { accountHolder: "Test Rider", accountNumber: "123456789012", ifsc: "HDFC0001234" };

async function makeOrder(overrides = {}) {
  n += 1;
  const order = await Order.create({
    orderId: `ORDRI${Date.now()}${n}`,
    customer: customer._id,
    seller: seller._id,
    items: [{ product: seller._id, name: "Milk", quantity: 1, price: 50 }],
    address: { name: "Asha", address: "12 MG Road", city: "Indore", phone: "9876500001" },
    workflowVersion: 2,
    workflowStatus: "DELIVERY_SEARCH",
    status: "confirmed",
    ...overrides,
  });
  return order.toObject();
}

async function issueOtp(order, code = "4321") {
  await OrderOtp.create({
    orderId: order.orderId,
    orderMongoId: order._id,
    type: "delivery",
    code,
    codeHash: OrderOtp.hashCode(code),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    attempts: 0,
    maxAttempts: 3,
    lastGeneratedAt: new Date(),
  });
}

async function earning(riderId, type, amount, status = "Settled") {
  n += 1;
  return Transaction.create({
    user: riderId,
    userModel: "Delivery",
    type,
    amount,
    status,
    reference: `T-${type}-${Date.now()}-${n}`,
  });
}

beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterAll(stopTestApp);
beforeEach(async () => {
  customer = await fx.createCustomer();
  seller = await fx.createSeller();
  rider = await fx.createDelivery({ isOnline: true, ...BANK });
  rider2 = await fx.createDelivery({ isOnline: true });
  auth = {
    rider: bearer("delivery", rider._id),
    rider2: bearer("delivery", rider2._id),
    customer: bearer("customer", customer._id),
    admin: bearer("admin", rider2._id),
  };
});
afterEach(clearDatabase);

describe("sign-in and approval status", () => {
  it("a phone-number status lookup never hands out a token", async () => {
    const res = await request(app).get("/api/delivery/application-status").query({ phone: rider.phone });
    expect(res.status).toBe(200);
    expect(res.body.result).toEqual({ isApproved: true });

    const byId = await request(app).get("/api/delivery/application-status").query({ deliveryId: String(rider._id) });
    expect(byId.body.result.token).toBeUndefined();

    // The rider's own signed-in check may refresh their token.
    const self = await request(app).get("/api/delivery/application-status").set("Authorization", auth.rider);
    expect(self.body.result.token).toEqual(expect.any(String));
  });

  it("a pending rider's login response carries no account details", async () => {
    const pending = await fx.createDelivery({ isVerified: false, ...BANK });
    const res = await request(app).post("/api/delivery/send-login-otp").send({ phone: pending.phone });
    expect(res.status).toBe(403);
    expect(res.body.result.pendingApproval).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(BANK.accountNumber);
  });

  it("rejects query operators in place of the OTP", async () => {
    await request(app).post("/api/delivery/send-login-otp").send({ phone: rider.phone }).expect(200);
    const res = await request(app)
      .post("/api/delivery/verify-otp")
      .send({ phone: rider.phone, otp: { $ne: "x" } });
    expect(res.status).toBe(400);
    expect(res.body.result?.token).toBeUndefined();

    const anyPhone = await request(app)
      .post("/api/delivery/verify-otp")
      .send({ phone: { $gt: "" }, otp: "1234" });
    expect(anyPhone.status).toBe(400);
  });

  it("locks sign-in after repeated wrong codes, even for the right code", async () => {
    await request(app).post("/api/delivery/send-login-otp").send({ phone: rider.phone }).expect(200);
    const wrong = () => request(app).post("/api/delivery/verify-otp").send({ phone: rider.phone, otp: "0000" });
    const results = await Promise.all([1, 2, 3, 4, 5].map(wrong));
    expect(results.map((r) => r.status)).toContain(423);

    const right = await request(app).post("/api/delivery/verify-otp").send({ phone: rider.phone, otp: "1234" });
    expect(right.status).toBe(423);
    expect(right.body.result?.token).toBeUndefined();
  });
});

describe("new work needs an approved, active, online rider", () => {
  it("a pending rider cannot see or accept offers", async () => {
    const pending = await fx.createDelivery({ isVerified: false, isOnline: true });
    const order = await makeOrder();
    const who = bearer("delivery", pending._id);

    const list = await request(app).get("/api/orders/available").set("Authorization", who);
    expect(list.status).toBe(403);
    const accept = await request(app).put(`/api/orders/accept/${order.orderId}`).set("Authorization", who);
    expect(accept.status).toBe(403);
    expect((await Order.findById(order._id).lean()).deliveryBoy).toBeFalsy();
  });

  it("a suspended rider cannot accept, and suspension takes them offline", async () => {
    const order = await makeOrder();
    const res = await request(app)
      .put(`/api/admin/delivery-partners/${rider._id}`)
      .set("Authorization", auth.admin)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    const saved = await Delivery.findById(rider._id).lean();
    expect(saved.isActive).toBe(false);
    expect(saved.isOnline).toBe(false);

    await Delivery.updateOne({ _id: rider._id }, { $set: { isOnline: true } });
    const accept = await request(app).put(`/api/orders/accept/${order.orderId}`).set("Authorization", auth.rider);
    expect(accept.status).toBe(403);
    expect(accept.body.result.code).toBe("RIDER_SUSPENDED");
  });

  it("an offline rider gets an empty offer list and cannot accept", async () => {
    await Delivery.updateOne({ _id: rider._id }, { $set: { isOnline: false } });
    const order = await makeOrder();

    const list = await request(app).get("/api/orders/available").set("Authorization", auth.rider);
    expect(list.status).toBe(200);
    expect(list.body.results).toEqual([]);

    const accept = await request(app).put(`/api/orders/accept/${order.orderId}`).set("Authorization", auth.rider);
    expect(accept.status).toBe(409);
    expect(accept.body.result.code).toBe("RIDER_OFFLINE");
  });

  it("going offline mid-delivery keeps the order and says so", async () => {
    const order = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "OUT_FOR_DELIVERY", status: "out_for_delivery" });
    const res = await request(app).put("/api/delivery/profile").set("Authorization", auth.rider).send({ isOnline: false });
    expect(res.status).toBe(200);
    expect(res.body.result.activeOrders).toBe(1);
    expect(res.body.message).toMatch(/stay assigned/);
    const after = await Order.findById(order._id).lean();
    expect(String(after.deliveryBoy)).toBe(String(rider._id));
    expect(after.workflowStatus).toBe("OUT_FOR_DELIVERY");
  });
});

describe("offer acceptance", () => {
  it("an order the store has not accepted yet cannot be taken", async () => {
    for (const workflowStatus of ["CREATED", "SELLER_PENDING"]) {
      const order = await makeOrder({ workflowStatus, status: "pending" });
      const res = await request(app).put(`/api/orders/accept/${order.orderId}`).set("Authorization", auth.rider);
      expect(res.status).toBe(409);
      expect((await Order.findById(order._id).lean()).deliveryBoy).toBeFalsy();
    }
  });

  it("only one of two riders accepting at once wins", async () => {
    const order = await makeOrder();
    const [a, b] = await Promise.all([
      request(app).put(`/api/orders/accept/${order.orderId}`).set("Authorization", auth.rider),
      request(app).put(`/api/orders/accept/${order.orderId}`).set("Authorization", auth.rider2),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const saved = await Order.findById(order._id).lean();
    expect(saved.assignmentVersion).toBe(1);
  });

  it("an unaccepted offer does not show the customer's phone or email", async () => {
    const order = await makeOrder();
    const res = await request(app).get(`/api/orders/details/${order.orderId}`).set("Authorization", auth.rider2);
    expect(res.status).toBe(200);
    expect(res.body.result.address.phone).toBeUndefined();
    expect(res.body.result.customer.phone).toBeUndefined();
    expect(res.body.result.customer.email).toBeUndefined();
  });
});

describe("delivery hand-over OTP", () => {
  it("is never sent to the rider in the order details", async () => {
    const order = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "OUT_FOR_DELIVERY", status: "out_for_delivery" });
    await issueOtp(order);

    const asRider = await request(app).get(`/api/orders/details/${order.orderId}`).set("Authorization", auth.rider);
    expect(asRider.status).toBe(200);
    expect(asRider.body.result.deliveryOtp).toBeUndefined();
    expect(JSON.stringify(asRider.body)).not.toContain('"4321"');

    const asCustomer = await request(app).get(`/api/orders/details/${order.orderId}`).set("Authorization", auth.customer);
    expect(asCustomer.body.result.deliveryOtp).toBe("4321");
  });

  it("cannot be requested before pickup", async () => {
    const order = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "PICKUP_READY", status: "packed" });
    const res = await request(app)
      .post(`/api/orders/workflow/${order.orderId}/otp/request`)
      .set("Authorization", auth.rider)
      .send({ lat: 22.7196, lng: 75.8577 });
    expect(res.status).toBe(409);
    expect(await OrderOtp.countDocuments({ orderId: order.orderId })).toBe(0);
  });

  it("parallel wrong guesses never exceed the attempt limit", async () => {
    const order = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "OUT_FOR_DELIVERY", status: "out_for_delivery" });
    await issueOtp(order);
    const guesses = ["0001", "0002", "0003", "0004", "0005", "0006"];
    await Promise.all(
      guesses.map((otp) =>
        request(app).post(`/api/orders/workflow/${order.orderId}/otp/verify`).set("Authorization", auth.rider).send({ otp }),
      ),
    );
    const otp = await OrderOtp.findOne({ orderId: order.orderId }).lean();
    expect(otp.attempts).toBe(3);
    const right = await request(app)
      .post(`/api/orders/workflow/${order.orderId}/otp/verify`)
      .set("Authorization", auth.rider)
      .send({ otp: "4321" });
    expect(right.status).toBe(423);
    expect((await Order.findById(order._id).lean()).status).toBe("out_for_delivery");
  });

  it("a retry after a lost response reports the delivery instead of failing", async () => {
    const order = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "OUT_FOR_DELIVERY", status: "out_for_delivery" });
    await issueOtp(order);
    const verify = () =>
      request(app).post(`/api/orders/workflow/${order.orderId}/otp/verify`).set("Authorization", auth.rider).send({ otp: "4321" });

    expect((await verify()).status).toBe(200);
    const delivered = await Order.findById(order._id).lean();
    const again = await verify();
    expect(again.status).toBe(200);
    expect(again.body.result.duplicate).toBe(true);
    // The replay changes nothing: same delivery time, no second settlement.
    const after = await Order.findById(order._id).lean();
    expect(after.deliveredAt).toEqual(delivered.deliveredAt);
    expect(after.updatedAt).toEqual(delivered.updatedAt);
  });

  it("POST /orders/:id/delivered cannot skip the OTP", async () => {
    const order = await makeOrder({
      deliveryBoy: rider._id,
      workflowStatus: "OUT_FOR_DELIVERY",
      status: "out_for_delivery",
      paymentMode: "COD",
    });
    const res = await request(app).post(`/api/orders/${order.orderId}/delivered`).set("Authorization", auth.rider).send({});
    expect(res.status).toBe(409);
    const saved = await Order.findById(order._id).lean();
    expect(saved.status).toBe("out_for_delivery");
    expect(saved.financeFlags?.codMarkedCollected).toBeFalsy();

    // An order with no rider yet is not open to every rider.
    const open = await makeOrder({ paymentMode: "COD" });
    const other = await request(app).post(`/api/orders/${open.orderId}/delivered`).set("Authorization", auth.rider2).send({});
    expect(other.status).toBe(403);
  });

  it("a cancelled order cannot be settled as delivered", async () => {
    const order = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "CANCELLED", status: "cancelled" });
    const res = await request(app).post(`/api/orders/${order.orderId}/delivered`).set("Authorization", auth.admin).send({});
    expect(res.status).toBe(409);
    expect((await Order.findById(order._id).lean()).status).toBe("cancelled");
  });
});

describe("COD and withdrawals", () => {
  it("a rider cannot clear their own COD liability through reconcile", async () => {
    const order = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "DELIVERED", status: "delivered", paymentMode: "COD" });
    const res = await request(app)
      .post(`/api/orders/${order.orderId}/cod/reconcile`)
      .set("Authorization", auth.rider)
      .send({ amount: 10 });
    expect(res.status).toBe(403);
  });

  it("COD cash in hand is never withdrawable", async () => {
    await earning(rider._id, "Delivery Earning", 30);
    await earning(rider._id, "Cash Collection", 500);
    const withdraw = (amount) =>
      request(app).post("/api/delivery/request-withdrawal").set("Authorization", auth.rider).send({ amount });

    expect((await withdraw(100)).status).toBe(400);
    expect((await withdraw(30)).status).toBe(201);

    const earnings = await request(app).get("/api/delivery/earnings").set("Authorization", auth.rider);
    expect(earnings.body.result.availableBalance).toBe(0);
  });

  it("a double tap or retry creates one withdrawal", async () => {
    await earning(rider._id, "Delivery Earning", 30);
    const send = (key) =>
      request(app)
        .post("/api/delivery/request-withdrawal")
        .set("Authorization", auth.rider)
        .set("Idempotency-Key", key)
        .send({ amount: 20 });

    const first = await send("k1");
    const retry = await send("k1");
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(String(retry.body.result._id)).toBe(String(first.body.result._id));

    // Two different requests at once: the balance covers only one.
    await Transaction.deleteMany({ type: "Withdrawal" });
    const [a, b] = await Promise.all([send("k2"), send("k3")]);
    expect([a.status, b.status]).toContain(201);
    expect(await Transaction.countDocuments({ user: rider._id, type: "Withdrawal" })).toBe(1);
  });

  it("rejects a non-numeric amount and missing bank details", async () => {
    await earning(rider2._id, "Delivery Earning", 30);
    const bad = await request(app).post("/api/delivery/request-withdrawal").set("Authorization", auth.rider).send({ amount: "abc" });
    expect(bad.status).toBe(400);
    const noBank = await request(app).post("/api/delivery/request-withdrawal").set("Authorization", auth.rider2).send({ amount: 10 });
    expect(noBank.status).toBe(400);
    expect(noBank.body.message).toMatch(/bank/i);
  });
});

describe("order history", () => {
  it("the Cancelled and Returns tabs show the right orders, without customer phones", async () => {
    const cancelled = await makeOrder({ deliveryBoy: rider._id, workflowStatus: "CANCELLED", status: "cancelled" });
    const returned = await makeOrder({
      deliveryBoy: rider._id,
      workflowStatus: "DELIVERED",
      status: "delivered",
      returnStatus: "return_in_transit",
    });
    const history = (status) =>
      request(app).get("/api/delivery/order-history").query({ status }).set("Authorization", auth.rider);

    const c = await history("cancelled");
    expect(c.body.results.map((o) => o.orderId)).toEqual([cancelled.orderId]);
    const r = await history("returns");
    expect(r.body.results.map((o) => o.orderId)).toEqual([returned.orderId]);

    const all = await history("all");
    expect(JSON.stringify(all.body.results)).not.toContain("9876500001");
  });
});
