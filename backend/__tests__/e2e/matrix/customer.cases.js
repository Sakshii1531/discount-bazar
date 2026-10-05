/**
 * Customer endpoints: OTP auth (send + validation), profile, transactions,
 * cart, wishlist and support tickets. The full mock-mode login flow is
 * covered in api-customer.e2e.test.js.
 */
import { expect } from "@jest/globals";
import { listOf } from "../helpers/world.js";

const OID = "64b7f0c2a1b2c3d4e5f60718";
const cartIds = (res) => res.body.result.items.map((i) => String(i.productId?._id || i.productId));

export default [
  // ── OTP auth ──────────────────────────────────────────────────────────────
  {
    route: "POST /api/customer/send-signup-otp",
    body: { name: "New Shopper", phone: "9811122233" },
    check: (res) => expect(res.body.message).toMatch(/OTP/),
  },
  { route: "POST /api/customer/send-signup-otp", name: "validates name/phone", body: { name: "N", phone: "12" }, status: 400 },
  {
    route: "POST /api/customer/send-login-otp",
    body: (ctx) => ({ phone: ctx.customer.phone.slice(-10) }),
    check: (res) => expect(res.body.message).toMatch(/OTP/),
  },
  { route: "POST /api/customer/send-login-otp", name: "validates phone", body: { phone: "abc" }, status: 400 },
  { route: "POST /api/customer/verify-otp", name: "validates otp format", body: { phone: "9811122233", otp: "x" }, status: 400 },
  {
    route: "POST /api/customer/verify-otp",
    name: "rejects a wrong code",
    body: { phone: "9811122233", otp: "999999" },
    status: [400, 401],
    check: (res) => expect(res.body.result?.token).toBeUndefined(),
  },

  // ── Profile & transactions ────────────────────────────────────────────────
  {
    route: "GET /api/customer/profile",
    as: "customer",
    check: (res, ctx) => {
      expect(String(res.body.result._id)).toBe(String(ctx.customer._id));
      expect(res.body.result.addresses).toHaveLength(1);
      expect(res.body.result.otpHash).toBeUndefined();
    },
  },
  {
    route: "PUT /api/customer/profile",
    as: "customer",
    body: { name: "Renamed Customer", email: "main@e2e.test" },
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ name: "Renamed Customer", email: "main@e2e.test" })),
  },
  {
    route: "GET /api/customer/transactions",
    as: "customer",
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ items: [], total: 0 })),
  },

  // ── Cart ──────────────────────────────────────────────────────────────────
  {
    route: "GET /api/cart",
    as: "customer",
    check: (res) => expect(res.body.result.items).toEqual([]),
  },
  {
    route: "POST /api/cart/add",
    as: "customer",
    body: (ctx) => ({ productId: String(ctx.milk._id), quantity: 2 }),
    check: (res, ctx) => expect(cartIds(res)).toEqual([String(ctx.milk._id)]),
  },
  {
    route: "POST /api/cart/add",
    name: "a second seller's product conflicts",
    as: "customer",
    body: (ctx) => ({ productId: String(ctx.otherProduct._id), quantity: 1 }),
    status: 409,
    check: (res) => expect(res.body.result.code).toBe("SELLER_CONFLICT"),
  },
  { route: "POST /api/cart/add", name: "validates quantity", as: "customer", body: (ctx) => ({ productId: String(ctx.milk._id), quantity: 0 }), status: 400 },
  { route: "POST /api/cart/add", name: "unknown product", as: "customer", body: { productId: OID, quantity: 1 }, status: 404 },
  {
    route: "PUT /api/cart/update",
    as: "customer",
    body: (ctx) => ({ productId: String(ctx.milk._id), quantity: 5 }),
    check: (res) => expect(res.body.result.items[0].quantity).toBe(5),
  },
  { route: "PUT /api/cart/update", name: "item not in cart", as: "customer", body: (ctx) => ({ productId: String(ctx.bread._id), quantity: 1 }), status: 404 },
  {
    route: "POST /api/cart/replace",
    name: "switches to another seller",
    as: "customer",
    body: (ctx) => ({ productId: String(ctx.otherProduct._id), quantity: 1 }),
    check: (res, ctx) => expect(cartIds(res)).toEqual([String(ctx.otherProduct._id)]),
  },
  {
    route: "DELETE /api/cart/remove/:productId",
    as: "customer",
    params: (ctx) => ({ productId: ctx.otherProduct._id }),
    check: (res) => expect(res.body.result.items).toEqual([]),
  },
  {
    route: "DELETE /api/cart/clear",
    as: "customer",
    before: async () => {},
    check: (res) => expect(res.body.message).toMatch(/cleared/i),
  },

  // ── Wishlist ──────────────────────────────────────────────────────────────
  {
    route: "POST /api/wishlist/add",
    as: "customer",
    body: (ctx) => ({ productId: String(ctx.milk._id) }),
    check: (res, ctx) => expect(res.body.result.products.map((p) => String(p._id || p))).toContain(String(ctx.milk._id)),
  },
  {
    route: "POST /api/wishlist/toggle",
    as: "customer",
    body: (ctx) => ({ productId: String(ctx.bread._id) }),
  },
  {
    route: "GET /api/wishlist",
    as: "customer",
    query: { idsOnly: "true" },
    check: (res, ctx) =>
      expect(res.body.result.products.map(String).sort()).toEqual([String(ctx.milk._id), String(ctx.bread._id)].sort()),
  },
  {
    route: "POST /api/wishlist/toggle",
    name: "toggling again removes it",
    as: "customer",
    body: (ctx) => ({ productId: String(ctx.bread._id) }),
  },
  {
    route: "DELETE /api/wishlist/remove/:productId",
    as: "customer",
    params: (ctx) => ({ productId: ctx.milk._id }),
    check: (res) => expect(res.body.result.products).toEqual([]),
  },
  { route: "POST /api/wishlist/add", name: "validates productId", as: "customer", body: { productId: "x" }, status: 400 },

  // ── Support tickets ───────────────────────────────────────────────────────
  {
    route: "POST /api/tickets/create",
    as: "customer",
    body: { subject: "Late order", description: "My order is late" },
    status: 201,
    check: (res, ctx) => {
      expect(res.body.result).toEqual(expect.objectContaining({ status: "open", userType: "Customer", subject: "Late order" }));
      ctx.ticketId = res.body.result._id;
    },
  },
  {
    route: "POST /api/tickets/create",
    name: "requires subject/description",
    as: "customer",
    body: {},
    status: 400,
  },
  {
    route: "GET /api/tickets/my-tickets",
    as: "customer",
    check: (res, ctx) => expect(listOf(res).map((t) => t._id)).toEqual([ctx.ticketId]),
  },
  {
    route: "GET /api/tickets/my-tickets",
    name: "other customers don't see it",
    as: "otherCustomer",
    check: (res) => expect(listOf(res)).toEqual([]),
  },
  {
    route: "POST /api/tickets/reply/:id",
    as: "customer",
    params: (ctx) => ({ id: ctx.ticketId }),
    body: { text: "Any update?" },
    check: (res) => expect(res.body.result.messages.at(-1).text).toBe("Any update?"),
  },
  {
    route: "POST /api/tickets/reply/:id",
    name: "admin reply moves the ticket to processing",
    as: "admin",
    params: (ctx) => ({ id: ctx.ticketId }),
    body: { text: "Looking into it" },
    check: (res) => {
      expect(res.body.result.status).toBe("processing");
      expect(res.body.result.messages.at(-1).isAdmin).toBe(true);
    },
  },
  {
    route: "POST /api/tickets/reply/:id",
    name: "another customer cannot reply to someone else's ticket",
    as: "otherCustomer",
    params: (ctx) => ({ id: ctx.ticketId }),
    body: { text: "not my ticket" },
    status: [403, 404],
  },
  {
    route: "GET /api/tickets/admin/all",
    as: "admin",
    check: (res, ctx) => expect(listOf(res).map((t) => t._id)).toContain(ctx.ticketId),
  },
  { route: "GET /api/tickets/admin/all", name: "customers are denied", as: "customer", status: 403 },
  {
    route: "PATCH /api/tickets/admin/status/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.ticketId }),
    body: { status: "closed" },
    check: (res) => expect(res.body.result.status).toBe("closed"),
  },
  {
    route: "PATCH /api/tickets/admin/status/:id",
    name: "rejects unknown statuses",
    as: "admin",
    params: (ctx) => ({ id: ctx.ticketId }),
    body: { status: "banana" },
    status: 400,
  },
  {
    route: "POST /api/tickets/reply/:id",
    name: "a customer cannot pose as support staff",
    as: "customer",
    params: (ctx) => ({ id: ctx.ticketId }),
    body: { text: "Refund approved!", isAdmin: true },
    check: (res) => {
      const last = res.body.result.messages.at(-1);
      expect(last.isAdmin).toBe(false);
      expect(last.sender).not.toBe("Support Team");
    },
  },
  { route: "PATCH /api/tickets/admin/status/:id", name: "customers are denied", as: "customer", params: (ctx) => ({ id: ctx.ticketId }), body: { status: "closed" }, status: 403 },
];
