/**
 * API E2E — product-page reviews use order-item ratings: one review per
 * product per delivered order, so buying the same product again allows a
 * new review, while the same order item can never be reviewed twice. The
 * product page used to write to the legacy Review collection, which the page
 * never listed and the rating summary never counted.
 */
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp, clearDatabase } from "./helpers/testApp.js";
import { seedWorld } from "./helpers/world.js";
import { placeAndDeliverOrder, AT_CUSTOMER } from "./helpers/flows.js";
import Review from "../../app/models/review.js";
import ProductRating from "../../app/models/productRating.js";
import { migrateLegacyReviews } from "../../app/services/legacyReviewMigrationService.js";

jest.setTimeout(180000);

let app;
let ctx;
beforeAll(async () => {
  app = await startTestApp();
});
beforeEach(async () => {
  ctx = await seedWorld();
});
afterEach(clearDatabase);
afterAll(stopTestApp);

const productPage = (who = "customer") =>
  request(app).get(`/api/products/${ctx.milk._id}`).query(AT_CUSTOMER).set("Authorization", ctx.auth[who]);

const rate = (orderItemId, rating, comment) =>
  request(app)
    .post("/api/product-ratings")
    .set("Authorization", ctx.auth.customer)
    .send({ orderItemId: String(orderItemId), rating, comment });

const summary = async () =>
  (await request(app).get(`/api/product-ratings/products/${ctx.milk._id}/rating-summary`)).body.result;

describe("repeat purchase review eligibility", () => {
  it("no review form before the product is delivered", async () => {
    const res = await productPage();
    expect(res.status).toBe(200);
    expect(res.body.result).toMatchObject({ hasPurchased: false, hasReviewed: false, pendingRatingOrderItemId: null });
  });

  it("allows one review per delivered order and counts each in the summary", async () => {
    await placeAndDeliverOrder(app, ctx, ctx.milk._id);
    const first = (await productPage()).body.result;
    expect(first).toMatchObject({ hasPurchased: true, hasReviewed: false });
    expect(first.pendingRatingOrderItemId).toBeTruthy();

    expect((await rate(first.pendingRatingOrderItemId, 4, "Fresh")).status).toBe(201);
    // Same order item again: rejected, and the summary is unchanged
    expect((await rate(first.pendingRatingOrderItemId, 1, "Again")).status).toBe(409);
    expect(await summary()).toMatchObject({ count: 1, average: 4 });

    const afterFirst = (await productPage()).body.result;
    expect(afterFirst).toMatchObject({ hasReviewed: true, pendingRatingOrderItemId: null });

    // Second order for the same product opens a new review
    await placeAndDeliverOrder(app, ctx, ctx.milk._id);
    const second = (await productPage()).body.result;
    expect(second.hasReviewed).toBe(true);
    expect(second.pendingRatingOrderItemId).toBeTruthy();
    expect(String(second.pendingRatingOrderItemId)).not.toBe(String(first.pendingRatingOrderItemId));

    expect((await rate(second.pendingRatingOrderItemId, 2, "Leaked")).status).toBe(201);
    expect(await summary()).toMatchObject({ count: 2, average: 3 });
    expect((await productPage()).body.result.pendingRatingOrderItemId).toBeNull();
  });

  it("migrates legacy product-page reviews into order ratings once", async () => {
    await placeAndDeliverOrder(app, ctx, ctx.milk._id);
    await Review.create({ userId: ctx.customer._id, productId: ctx.milk._id, rating: 5, comment: "Old form", status: "pending" });
    // No delivered purchase: stays in the legacy collection
    await Review.create({ userId: ctx.otherCustomer._id, productId: ctx.milk._id, rating: 1, comment: "Never bought", status: "approved" });

    expect(await migrateLegacyReviews()).toEqual({ total: 2, migrated: 1, skipped: 1 });
    expect(await ProductRating.countDocuments()).toBe(0); // dry run writes nothing

    expect(await migrateLegacyReviews({ apply: true })).toEqual({ total: 2, migrated: 1, skipped: 1 });
    expect(await summary()).toMatchObject({ count: 1, average: 5 });
    const list = await request(app).get(`/api/product-ratings/products/${ctx.milk._id}/ratings`);
    expect(list.body.result.items.map((r) => r.comment)).toEqual(["Old form"]);
    expect((await productPage()).body.result).toMatchObject({ hasReviewed: true, pendingRatingOrderItemId: null });

    // Re-running only retries the unmigrated review
    expect(await migrateLegacyReviews({ apply: true })).toEqual({ total: 1, migrated: 0, skipped: 1 });
    expect(await ProductRating.countDocuments()).toBe(1);
  });

  it("another customer's delivered order does not make the product reviewable", async () => {
    await placeAndDeliverOrder(app, ctx, ctx.milk._id);
    const other = (await productPage("otherCustomer")).body.result;
    expect(other).toMatchObject({ hasPurchased: false, pendingRatingOrderItemId: null });
  });
});
