/**
 * Platform endpoints: health/metrics, store settings, categories (both the
 * public and /admin mounts), maps, media uploads, generic OTP, push tokens
 * and in-app notifications.
 */
import { expect } from "@jest/globals";
import { listOf } from "../helpers/world.js";

const OID = "64b7f0c2a1b2c3d4e5f60718";

export default [
  // ── Health & metrics ──────────────────────────────────────────────────────
  {
    route: "GET /health",
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ status: "UP", role: "api" })),
  },
  {
    route: "GET /health/ready",
    check: (res) => {
      expect(res.body.result.ready).toBe(true);
      expect(res.body.result.checks.mongodb.status).toBe("UP");
    },
  },
  {
    route: "GET /metrics",
    envelope: false,
    check: (res) => {
      expect(res.text).toContain('dependency_up{dependency="mongodb"} 1');
      expect(res.text).toContain("process_uptime_seconds");
    },
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  {
    route: "GET /api/settings",
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ currencyCode: "INR", currencySymbol: "₹" })),
  },
  {
    route: "GET /api/settings/check-serviceability",
    query: { pincode: "452001" },
    check: (res) => expect(typeof res.body.result.serviceable).toBe("boolean"),
  },
  {
    route: "PUT /api/settings",
    as: "admin",
    body: { appName: "QA Bazar", supportPhone: "+919999999999" },
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ appName: "QA Bazar", supportPhone: "+919999999999" })),
  },
  { route: "PUT /api/settings", name: "customers are denied", as: "customer", body: { appName: "Hacked" }, status: 403 },
  {
    route: "GET /api/settings",
    name: "reflects the admin update",
    check: (res) => expect(res.body.result.appName).toBe("QA Bazar"),
  },
  {
    route: "POST /api/settings/upload",
    as: "admin",
    attach: { field: "image" },
    check: (res) => expect(res.body.result.url).toMatch(/\/uploads\/settings\/.+\.png$/),
  },
  { route: "POST /api/settings/upload", name: "requires a file", as: "admin", body: {}, status: 400 },

  // ── Categories (public mount) ─────────────────────────────────────────────
  {
    route: "GET /api/categories",
    check: (res, ctx) => {
      const ids = listOf(res).map((c) => String(c._id));
      expect(ids).toEqual(expect.arrayContaining([String(ctx.tree.category._id), String(ctx.tree.subcategory._id)]));
    },
  },
  {
    route: "GET /api/categories",
    name: "tree view nests children",
    query: { tree: "true" },
    check: (res, ctx) => {
      const header = listOf(res).find((h) => String(h._id) === String(ctx.tree.header._id));
      expect(header.children.map((c) => String(c._id))).toContain(String(ctx.tree.category._id));
    },
  },
  {
    route: "POST /api/categories",
    as: "admin",
    body: { name: "Snacks", slug: "snacks-e2e", type: "header" },
    status: 201,
    check: (res, ctx) => {
      expect(res.body.result).toEqual(expect.objectContaining({ name: "Snacks", slug: "snacks-e2e", type: "header", status: "active" }));
      ctx.publicCategoryId = res.body.result._id;
    },
  },
  { route: "POST /api/categories", name: "rejects duplicates/invalid input", as: "admin", body: { name: "" }, status: 400 },
  { route: "POST /api/categories", name: "sellers are denied", as: "seller", body: { name: "X", slug: "x", type: "header" }, status: 403 },
  {
    route: "PUT /api/categories/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.publicCategoryId }),
    body: { name: "Snacks & Namkeen" },
    check: (res) => expect(res.body.result.name).toBe("Snacks & Namkeen"),
  },
  {
    route: "DELETE /api/categories/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.publicCategoryId }),
    check: (res) => expect(res.body.message).toMatch(/deleted/i),
  },

  // ── Categories (/admin mount, multipart with image) ───────────────────────
  {
    route: "GET /api/admin/categories",
    query: { tree: "true" },
    check: (res) => expect(listOf(res).length).toBeGreaterThan(0),
  },
  {
    route: "POST /api/admin/categories",
    as: "admin",
    attach: { field: "image" },
    body: { name: "Beverages", slug: "beverages-e2e", type: "header" },
    status: 201,
    check: (res, ctx) => {
      expect(res.body.result.image).toMatch(/\/uploads\/categories\/.+\.png$/);
      ctx.adminCategoryId = res.body.result._id;
    },
  },
  {
    route: "PUT /api/admin/categories/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.adminCategoryId }),
    body: { name: "Cold Beverages", status: "inactive" },
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ name: "Cold Beverages", status: "inactive" })),
  },
  {
    route: "DELETE /api/admin/categories/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.adminCategoryId }),
  },
  {
    route: "DELETE /api/admin/categories/:id",
    name: "unknown id",
    as: "admin",
    params: { id: OID },
    status: 404,
  },

  // ── Maps ──────────────────────────────────────────────────────────────────
  {
    route: "GET /api/maps/geocode",
    name: "validates input",
    as: "customer",
    query: {},
    status: 400,
  },
  {
    route: "GET /api/maps/geocode",
    name: "reports a clear error when no Google key is configured",
    as: "customer",
    query: { address: "MG Road Indore" },
    status: [500, 503],
    check: (res) => expect(res.body.result.error.code).toBe("MAPS_KEY_MISSING"),
  },

  // ── Media ─────────────────────────────────────────────────────────────────
  {
    route: "POST /api/media/upload-intent",
    as: "seller",
    body: { entityType: "product", resourceType: "image", mimeType: "image/png", fileSize: 68, extension: "png" },
    check: (res, ctx) => {
      expect(res.body.result.intentId || res.body.result.publicId).toBeTruthy();
      ctx.mediaIntent = res.body.result;
    },
  },
  {
    route: "POST /api/media/upload-intent",
    name: "rejects unknown entity types",
    as: "seller",
    body: { entityType: "weapon", mimeType: "image/png", fileSize: 68, extension: "png" },
    status: 400,
  },
  {
    route: "POST /api/media/upload-url",
    as: "customer",
    body: { entityType: "profile", resourceType: "image", mimeType: "image/png", fileSize: 68, extension: "png" },
    check: (res) => expect(res.body.result.intentId || res.body.result.publicId).toBeTruthy(),
  },
  {
    route: "POST /api/media/confirm",
    as: "seller",
    body: (ctx) => ({
      intentId: ctx.mediaIntent.intentId,
      publicId: ctx.mediaIntent.publicId,
      secureUrl: "https://cdn.example.test/e2e.png",
      bytes: 68,
      mimeType: "image/png",
    }),
    check: (res) => expect(JSON.stringify(res.body.result)).toContain("confirmed"),
  },
  { route: "POST /api/media/confirm", name: "requires an intent", as: "seller", body: { secureUrl: "https://x" }, status: 400 },
  {
    route: "DELETE /api/media/*publicId",
    as: "seller",
    params: (ctx) => ({ publicId: ctx.mediaIntent.publicId }),
  },
  {
    route: "DELETE /api/media/*publicId",
    name: "already deleted",
    as: "seller",
    params: (ctx) => ({ publicId: ctx.mediaIntent.publicId }),
    status: 404,
  },
  {
    route: "POST /api/media/upload",
    as: "seller",
    attach: { field: "file" },
    check: (res) => expect(res.body.result.url).toMatch(/\/uploads\/media\/images\/.+\.png$/),
  },
  { route: "POST /api/media/upload", name: "requires a file", as: "seller", body: {}, status: 400 },

  // ── Generic OTP module ────────────────────────────────────────────────────
  {
    route: "POST /api/auth/otp/send",
    name: "unknown account",
    body: { mobile: "9876501234", userType: "Customer", purpose: "LOGIN" },
    status: 404,
  },
  {
    route: "POST /api/auth/otp/send",
    body: (ctx) => ({ mobile: ctx.customer.phone.slice(-10), userType: "Customer", purpose: "LOGIN" }),
    check: (res, ctx) => {
      expect(res.body.result).toEqual(expect.objectContaining({ sent: true, purpose: "LOGIN" }));
      // Mock mode echoes the generated code so tests can complete the flow.
      expect(res.body.result.mockOtp).toMatch(/^\d{4,8}$/);
      ctx.genericOtp = res.body.result.mockOtp;
    },
  },
  {
    route: "POST /api/auth/otp/verify",
    name: "rejects a wrong code",
    body: (ctx) => ({ mobile: ctx.customer.phone.slice(-10), otp: ctx.genericOtp === "0000" ? "1111" : "0000", userType: "Customer", purpose: "LOGIN" }),
    status: [400, 401],
  },
  {
    route: "POST /api/auth/otp/verify",
    body: (ctx) => ({ mobile: ctx.customer.phone.slice(-10), otp: ctx.genericOtp, userType: "Customer", purpose: "LOGIN" }),
    check: (res) => expect(res.body.success).toBe(true),
  },
  {
    route: "POST /api/auth/otp/send",
    name: "validates userType/purpose",
    body: { mobile: "9876501234", userType: "Hacker", purpose: "LOGIN" },
    status: 400,
  },

  // ── Push tokens & preferences ─────────────────────────────────────────────
  {
    route: "POST /api/push/register",
    as: "customer",
    body: { token: "fcm-e2e-token-1", platform: "web" },
    envelope: false, // intentionally returns a login-shaped { success, message, data } payload
    check: (res, ctx) => {
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.id).toBe(String(ctx.customer._id));
      expect(`Bearer ${res.body.data.token}`).toBe(ctx.auth.customer);
    },
  },
  { route: "POST /api/push/register", name: "requires a token", as: "customer", body: {}, status: 400 },
  { route: "POST /api/push/register", name: "validates platform", as: "customer", body: { token: "t", platform: "tv" }, status: 400 },
  {
    route: "GET /api/push/preferences",
    as: "customer",
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ orderUpdates: true, pushNotifications: true })),
  },
  {
    route: "PATCH /api/push/preferences",
    as: "customer",
    body: { orderUpdates: false },
    check: (res) => expect(res.body.result.orderUpdates).toBe(false),
  },
  {
    route: "POST /api/push/test",
    as: "customer",
    body: {},
    check: (res, ctx) => {
      expect(res.body.result.orderId).toMatch(/^TEST-/);
      ctx.pushTestOrderId = res.body.result.orderId;
    },
  },
  {
    route: "GET /api/push/test-status/:orderId",
    as: "customer",
    params: (ctx) => ({ orderId: ctx.pushTestOrderId }),
    check: (res, ctx) => expect(res.body.result.orderId).toBe(ctx.pushTestOrderId),
  },
  {
    route: "DELETE /api/push/remove",
    as: "customer",
    body: { token: "fcm-e2e-token-1" },
    check: (res) => expect(res.body.result.deletedTokens).toBe(1),
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  {
    route: "GET /api/notifications/broadcast/audience-stats",
    as: "admin",
    check: (res) =>
      expect(res.body.result).toEqual(expect.objectContaining({ customers: 2, sellers: 3, delivery: 2 })),
  },
  {
    route: "POST /api/notifications/broadcast",
    as: "admin",
    body: { title: "Weekend sale", message: "Flat 20% off", audience: "customers" },
    status: [200, 201, 202],
  },
  { route: "POST /api/notifications/broadcast", name: "requires a message", as: "admin", body: { title: "x" }, status: 400 },
  { route: "POST /api/notifications/broadcast", name: "customers are denied", as: "customer", body: { title: "x", message: "y" }, status: 403 },
  {
    route: "GET /api/notifications",
    as: "customer",
    check: (res, ctx) => {
      const items = res.body.result.items;
      expect(Array.isArray(items)).toBe(true);
      expect(typeof res.body.result.unreadCount).toBe("number");
      ctx.notificationId = items[0]?._id || OID;
    },
  },
  {
    route: "PUT /api/notifications/:id/read",
    as: "customer",
    params: (ctx) => ({ id: ctx.notificationId }),
    check: (res) => expect(typeof res.body.result.modifiedCount).toBe("number"),
  },
  {
    route: "PATCH /api/notifications/read/:id",
    as: "customer",
    params: (ctx) => ({ id: ctx.notificationId }),
    check: (res) => expect(typeof res.body.result.modifiedCount).toBe("number"),
  },
  {
    route: "PATCH /api/notifications/read",
    as: "customer",
    body: {},
    check: (res) => expect(typeof res.body.result.modifiedCount).toBe("number"),
  },
  {
    route: "PUT /api/notifications/mark-all-read",
    as: "customer",
    check: (res) => expect(typeof res.body.result.modifiedCount).toBe("number"),
  },
  {
    route: "GET /api/notifications",
    name: "nothing unread after mark-all-read",
    as: "customer",
    check: (res) => expect(res.body.result.unreadCount).toBe(0),
  },
];
