/**
 * API E2E — admin panel: login, profile, user/seller management,
 * seller approval flow, review queues, support tickets and settings.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";

jest.setTimeout(120000);

let app;
beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

describe("admin: authentication", () => {
  it("logs in with email and password", async () => {
    const admin = await fx.createAdmin();
    const res = await request(app).post("/api/admin/login").send({ email: admin.email, password: admin.plainPassword });
    expect(res.status).toBe(200);
    expect(res.body.result.token).toEqual(expect.any(String));
  });

  it("rejects wrong passwords", async () => {
    const admin = await fx.createAdmin();
    const res = await request(app).post("/api/admin/login").send({ email: admin.email, password: "nope" });
    expect(res.status).toBe(401);
  });

  it("public admin signup is disabled", async () => {
    const res = await request(app)
      .post("/api/admin/signup")
      .send({ name: "Mallory", email: "m@test.com", password: "Str0ngPassword1" });
    expect(res.status).toBe(403);
  });

  it("bootstrap is refused when not configured", async () => {
    const res = await request(app)
      .post("/api/admin/bootstrap")
      .send({ name: "Mallory", email: "m@test.com", password: "Str0ngPassword1" });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe("admin: management screens", () => {
  let admin;
  let auth;
  beforeEach(async () => {
    admin = await fx.createAdmin();
    auth = bearer("admin", admin._id);
  });

  it("fetches admin profile without password", async () => {
    const res = await request(app).get("/api/admin/profile").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.result.email).toBe(admin.email);
    expect(res.body.result.password).toBeUndefined();
  });

  it("lists customers", async () => {
    const customer = await fx.createCustomer();
    const res = await request(app).get("/api/admin/users").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.result.items.map((u) => String(u._id))).toContain(String(customer._id));
  });

  it("lists sellers and pending applications", async () => {
    await fx.createSeller();
    const pending = await fx.createSeller({ isVerified: false, applicationStatus: "pending" });
    const all = await request(app).get("/api/admin/sellers").set("Authorization", auth);
    expect(all.body.results).toHaveLength(2);
    const queue = await request(app).get("/api/admin/sellers/pending").set("Authorization", auth);
    expect(queue.body.result.items.map((s) => String(s.id))).toEqual([String(pending._id)]);
  });

  it("approves a pending seller who can then log in", async () => {
    const pending = await fx.createSeller({ isVerified: false, applicationStatus: "pending" });
    const before = await request(app)
      .post("/api/seller/login")
      .send({ email: pending.email, password: pending.plainPassword });
    expect(before.status).toBe(403);

    const approve = await request(app).patch(`/api/admin/sellers/approve/${pending._id}`).set("Authorization", auth);
    expect(approve.status).toBe(200);

    const after = await request(app)
      .post("/api/seller/login")
      .send({ email: pending.email, password: pending.plainPassword });
    expect(after.status).toBe(200);
  });

  it("reports pending review counts", async () => {
    await fx.createSeller({ isVerified: false, applicationStatus: "pending" });
    const res = await request(app).get("/api/admin/pending-review-counts").set("Authorization", auth);
    expect(res.status).toBe(200);
    expect(res.body.result.pendingSellers).toBe(1);
  });

  it("sees and resolves customer support tickets", async () => {
    const customer = await fx.createCustomer();
    const created = await request(app)
      .post("/api/tickets/create")
      .set("Authorization", bearer("customer", customer._id))
      .send({ subject: "Refund", description: "Need refund" });
    const ticketId = created.body.result._id;

    const queue = await request(app).get("/api/tickets/admin/all").set("Authorization", auth);
    expect(queue.status).toBe(200);
    expect(queue.body.result.items.map((t) => t._id)).toContain(ticketId);

    const update = await request(app)
      .patch(`/api/tickets/admin/status/${ticketId}`)
      .set("Authorization", auth)
      .send({ status: "closed" });
    expect(update.status).toBe(200);
  });

  it("updates store settings", async () => {
    const res = await request(app).put("/api/settings").set("Authorization", auth).send({ appName: "Discount Bazaar QA" });
    expect(res.status).toBe(200);
    const pub = await request(app).get("/api/settings");
    expect(pub.body.result.appName).toBe("Discount Bazaar QA");
  });

  it("creates and deletes a category", async () => {
    const create = await request(app)
      .post("/api/admin/categories")
      .set("Authorization", auth)
      .send({ name: "Snacks", slug: "snacks-e2e", type: "header" });
    expect(create.status).toBeLessThan(300);
    const id = create.body.result._id;
    const del = await request(app).delete(`/api/admin/categories/${id}`).set("Authorization", auth);
    expect(del.status).toBeLessThan(300);
  });
});

describe("admin: role isolation", () => {
  it.each(["customer", "seller", "delivery"])("%s tokens are denied admin endpoints", async (role) => {
    const res = await request(app).get("/api/admin/users").set("Authorization", bearer(role, "64b7f0c2a1b2c3d4e5f60718"));
    expect(res.status).toBe(403);
  });

  it("non-admins cannot change settings", async () => {
    const res = await request(app)
      .put("/api/settings")
      .set("Authorization", bearer("customer", "64b7f0c2a1b2c3d4e5f60718"))
      .send({ appName: "Hacked" });
    expect(res.status).toBe(403);
  });

  it("non-admins cannot create categories", async () => {
    const res = await request(app)
      .post("/api/admin/categories")
      .set("Authorization", bearer("seller", "64b7f0c2a1b2c3d4e5f60718"))
      .send({ name: "X", slug: "x", type: "header" });
    expect(res.status).toBe(403);
  });
});
