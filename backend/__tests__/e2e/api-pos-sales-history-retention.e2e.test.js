/**
 * API E2E — POS Sales History keeps every bill, however old.
 *
 * Regression: a TTL index on orders.placement.idempotencyKeyExpiry (set to
 * createdAt + 24h on every POS bill) made MongoDB delete each bill a day after
 * it was created, so Sales History only ever showed the last ~2 calendar days.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import Order from "../../app/models/order.js";
import { dropTtlIndexesOnPermanentRecords } from "../../app/services/databaseIndexManager.js";
import { startTestApp, stopTestApp, clearDatabase, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";

jest.setTimeout(120000);

let app;
let auth;
let milk;
let n = 0;
const key = () => `e2e-pos-retention-${Date.now()}-${(n += 1)}`.padEnd(32, "0");

// Bill dates (IST noon) spanning days, weeks, months and a previous year.
const DATES = ["2025-03-15", "2026-01-02", "2026-09-30", "2026-10-25", "2026-10-29", "2026-10-30", "2026-10-31"];
const istNoon = (d) => new Date(`${d}T12:00:00+05:30`);

beforeAll(async () => {
  app = await startTestApp();
  await fx.ensureIndexes();
});
afterAll(stopTestApp);
beforeEach(async () => {
  const seller = await fx.createSeller();
  auth = bearer("seller", seller._id);
  milk = await fx.createProduct(seller, await fx.createCategoryTree(), { name: "Fresh Milk", price: 60, salePrice: 50, stock: 500 });
});
afterEach(clearDatabase);

const sell = () =>
  request(app)
    .post("/api/seller/pos/sale")
    .set("Authorization", auth)
    .set("Idempotency-Key", key())
    .send({ items: [{ productId: String(milk._id), quantity: 1, price: 50 }], posPaymentMethod: "CASH" });

// One bill per date; createdAt and the idempotency expiry are moved back as if
// the bill had really been rung up that day.
const billOnEachDate = async () => {
  const ids = [];
  for (const d of DATES) {
    const res = await sell();
    expect([200, 201]).toContain(res.status);
    const order = res.body.result.order || res.body.result;
    const at = istNoon(d);
    await Order.collection.updateOne(
      { orderId: order.orderId },
      { $set: { createdAt: at, "placement.idempotencyKeyExpiry": new Date(at.getTime() + 864e5) } },
    );
    ids.push(order.orderId);
  }
  return ids;
};
const history = async (query = {}) =>
  (await request(app).get("/api/seller/pos/sales").query(query).set("Authorization", auth)).body.result;

describe("POS Sales History retention", () => {
  it("the orders collection carries no TTL index", async () => {
    await Order.syncIndexes();
    const ttl = (await Order.collection.indexes()).filter((i) => i.expireAfterSeconds !== undefined);
    expect(ttl).toEqual([]);
  });

  it("a stale TTL index left in the database is dropped without touching bills", async () => {
    await billOnEachDate();
    await Order.collection.createIndex(
      { "placement.idempotencyKeyExpiry": 1 },
      { expireAfterSeconds: 0, partialFilterExpression: { "placement.idempotencyKeyExpiry": { $type: "date" } } },
    );

    const dropped = await dropTtlIndexesOnPermanentRecords();
    expect(dropped).toContain(`${Order.collection.collectionName}.placement.idempotencyKeyExpiry_1`);
    const ttl = (await Order.collection.indexes()).filter((i) => i.expireAfterSeconds !== undefined);
    expect(ttl).toEqual([]);
    expect(await Order.countDocuments({ orderSource: "POS" })).toBe(DATES.length);
  });

  it("lists every bill across all dates, newest first, with no default date window", async () => {
    const ids = await billOnEachDate();
    const result = await history();
    expect(result.total).toBe(DATES.length);
    expect(result.items.map((o) => o.orderId)).toEqual([...ids].reverse());
  });

  it("filters by a single day and by a date range (seller business days)", async () => {
    const ids = await billOnEachDate();
    const oneDay = await history({ from: "2026-09-30", to: "2026-09-30" });
    expect(oneDay.items.map((o) => o.orderId)).toEqual([ids[2]]);

    const range = await history({ from: "2026-10-25", to: "2026-10-30" });
    expect(range.items.map((o) => o.orderId).sort()).toEqual([ids[3], ids[4], ids[5]].sort());

    const onlyFrom = await history({ from: "2026-10-30" });
    expect(onlyFrom.total).toBe(2);
    const onlyTo = await history({ to: "2026-01-02" });
    expect(onlyTo.items.map((o) => o.orderId).sort()).toEqual([ids[0], ids[1]].sort());
  });

  it("pages through all bills without gaps or repeats", async () => {
    const ids = await billOnEachDate();
    const seen = [];
    let page = 1;
    let totalPages = 1;
    do {
      const r = await history({ page, limit: 3 });
      totalPages = r.totalPages;
      seen.push(...r.items.map((o) => o.orderId));
      page += 1;
    } while (page <= totalPages);
    expect(totalPages).toBe(Math.ceil(DATES.length / 3));
    expect(seen).toEqual([...ids].reverse());
  });
});
