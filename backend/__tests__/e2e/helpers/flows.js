/**
 * Multi-step API flows reused by matrix suites that need orders in a
 * particular state (delivered, returnable, ...). Every step goes through the
 * real HTTP API, so the resulting state is exactly what production produces.
 */
import request from "supertest";
import OrderOtp from "../../../app/models/orderOtp.js";
import * as fx from "./fixtures.js";

export const AT_CUSTOMER = { lat: fx.STORE_LOCATION.lat, lng: fx.STORE_LOCATION.lng };

async function expectOk(promise, step) {
  const res = await promise;
  if (res.status >= 300) {
    throw new Error(`[flow] ${step} failed with HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`);
  }
  return res;
}

export async function latestOtp(orderId, type = "delivery") {
  const doc = await OrderOtp.findOne({ orderId, type, consumedAt: null }).sort({ createdAt: -1 }).lean();
  return doc?.code;
}

export async function createReturnableProduct(ctx, overrides = {}) {
  return fx.createProduct(ctx.seller, ctx.tree, {
    name: "Returnable Shirt",
    price: 500,
    salePrice: 400,
    stock: 50,
    returnPolicy: { isReturnable: true, returnWindowDays: 7, returnReasons: ["Damaged Product", "Wrong Product"] },
    ...overrides,
  });
}

/** Places a COD order for `productId` and walks it through to delivered. Returns the orderId. */
export async function placeAndDeliverOrder(app, ctx, productId, { quantity = 1, customer = "customer" } = {}) {
  const auth = ctx.auth;
  const created = await expectOk(
    request(app)
      .post("/api/orders")
      .set("Authorization", auth[customer])
      .send({
        items: [{ product: String(productId), quantity }],
        address: { name: "Main Customer", address: "12 MG Road, Indore", city: "Indore", phone: "9999999999", location: AT_CUSTOMER },
        paymentMode: "COD",
        timeSlot: "now",
      }),
    "create order",
  );
  const orderId = created.body.result.order.orderId;
  const steps = [
    ["put", `/api/orders/status/${orderId}`, auth.seller, { status: "confirmed" }, "seller accepts"],
    ["put", `/api/orders/accept/${orderId}`, auth.delivery, {}, "rider accepts"],
    ["post", `/api/orders/workflow/${orderId}/pickup/ready`, auth.delivery, AT_CUSTOMER, "arrive at store"],
    ["post", `/api/orders/workflow/${orderId}/pickup/confirm`, auth.delivery, AT_CUSTOMER, "pickup"],
    ["post", `/api/orders/workflow/${orderId}/otp/request`, auth.delivery, AT_CUSTOMER, "request OTP"],
  ];
  for (const [method, url, header, body, label] of steps) {
    await expectOk(request(app)[method](url).set("Authorization", header).send(body), label);
  }
  const otp = await latestOtp(orderId);
  await expectOk(
    request(app)
      .post(`/api/orders/workflow/${orderId}/otp/verify`)
      .set("Authorization", auth.delivery)
      .send({ otp, ...AT_CUSTOMER }),
    "verify OTP",
  );
  return orderId;
}
