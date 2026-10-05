/**
 * Delivery-partner endpoints: registration OTP, login OTP validation,
 * application status, profile, stats/earnings/wallet, withdrawals, COD cash,
 * live location and order history. The full OTP login flow lives in
 * api-delivery.e2e.test.js; order hand-over steps are in orders.cases.js.
 */
import { expect } from "@jest/globals";
import { listOf } from "../helpers/world.js";

export default [
  // ── Registration & login ──────────────────────────────────────────────────
  {
    route: "POST /api/delivery/send-signup-otp",
    body: { name: "New Rider", phone: "9822200022", vehicleType: "bike", vehicleNumber: "MP09AB1111" },
    check: (res) => expect(res.body.message).toMatch(/OTP sent/),
  },
  { route: "POST /api/delivery/send-signup-otp", name: "requires name and phone", body: {}, status: 400 },
  {
    route: "POST /api/delivery/send-signup-otp",
    name: "an existing verified rider cannot re-register",
    body: (ctx) => ({ name: "Dup", phone: ctx.rider.phone }),
    status: 400,
  },
  { route: "POST /api/delivery/send-login-otp", body: (ctx) => ({ phone: ctx.rider.phone }), check: (res) => expect(res.body.message).toMatch(/OTP sent/) },
  { route: "POST /api/delivery/send-login-otp", name: "unknown rider", body: { phone: "7000000009" }, status: 404 },
  { route: "POST /api/delivery/verify-otp", name: "rejects a wrong code", body: (ctx) => ({ phone: ctx.rider.phone, otp: "000000" }), status: 400 },
  { route: "POST /api/delivery/verify-otp", name: "requires phone and otp", body: {}, status: 400 },
  {
    route: "GET /api/delivery/application-status",
    as: "pendingDelivery",
    optionalAuth: true,
    check: (res) => expect(res.body.result.isApproved).toBe(false),
  },

  // ── Profile & dashboard ───────────────────────────────────────────────────
  {
    route: "GET /api/delivery/profile",
    as: "delivery",
    check: (res, ctx) => expect(String(res.body.result._id)).toBe(String(ctx.rider._id)),
  },
  {
    route: "PUT /api/delivery/profile",
    as: "delivery",
    body: { vehicleNumber: "MP09XY9999" },
    check: (res) => expect(res.body.result.vehicleNumber).toBe("MP09XY9999"),
  },
  {
    route: "GET /api/delivery/stats",
    as: "delivery",
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ today: 0, deliveries: 0, cashCollected: 0 })),
  },
  { route: "GET /api/delivery/earnings", as: "delivery", check: (res) => expect(res.body.result.totalEarnings).toBe(0) },
  {
    route: "GET /api/delivery/wallet/summary",
    as: "delivery",
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ availableBalance: 0, cashInHand: 0 })),
  },
  { route: "GET /api/delivery/wallet/summary", name: "customers are denied", as: "customer", status: 403 },
  { route: "GET /api/delivery/withdrawals", as: "delivery", check: (res) => expect(listOf(res)).toEqual([]) },
  {
    route: "POST /api/delivery/request-withdrawal",
    name: "cannot withdraw more than the balance",
    as: "delivery",
    body: { amount: 100 },
    status: 400,
    check: (res) => expect(res.body.message).toMatch(/Insufficient balance/),
  },

  // ── COD cash ──────────────────────────────────────────────────────────────
  {
    route: "GET /api/delivery/cod/summary",
    as: "delivery",
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ cashInHand: 0, toRemit: [], toCollect: [] })),
  },
  {
    route: "POST /api/delivery/cod/pay",
    name: "nothing to submit yet",
    as: "delivery",
    body: { amount: 50 },
    status: 400,
  },
  { route: "POST /api/delivery/cod/pay", name: "customers are denied", as: "customer", body: { amount: 1 }, status: 403 },

  // ── Live location & history ───────────────────────────────────────────────
  {
    route: "POST /api/delivery/location",
    as: "delivery",
    body: (ctx) => ({ lat: ctx.location.lat, lng: ctx.location.lng, accuracy: 10 }),
    check: (res, ctx) => expect(res.body.result.location.coordinates).toEqual([ctx.location.lng, ctx.location.lat]),
  },
  { route: "POST /api/delivery/location", name: "rejects non-numeric coordinates", as: "delivery", body: { lat: "x", lng: 1 }, status: 400 },
  { route: "POST /api/delivery/location", name: "rejects out-of-range coordinates", as: "delivery", body: { lat: 999, lng: 75.85 }, status: 400 },
  {
    route: "GET /api/delivery/order-history",
    as: "delivery",
    query: { status: "all" },
    check: (res) => expect(listOf(res)).toEqual([]),
  },
];
