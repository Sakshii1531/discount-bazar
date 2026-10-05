/**
 * Post-delivery endpoints on genuinely delivered orders (seeded through the
 * real API by helpers/flows.js): the full return chain (request → approve →
 * assign rider → pickup OTP → in transit → seller drop OTP → QC), return
 * rejection, product reviews, product ratings and delivery ratings.
 */
import { expect } from "@jest/globals";
import Order from "../../../app/models/order.js";
import { ALL_FEEDBACK_TAGS, RATING_STATUSES } from "../../../app/constants/deliveryRatingConstants.js";
import { createReturnableProduct, placeAndDeliverOrder, latestOtp, AT_CUSTOMER } from "../helpers/flows.js";
import { listOf } from "../helpers/world.js";

const OID = "64b7f0c2a1b2c3d4e5f60718";
const ret = (key) => (ctx) => ({ orderId: ctx[key] });

export async function seed(ctx, app) {
  process.env.RETURN_ELIGIBILITY_DELAY_MINUTES = "0";
  process.env.RETURN_WINDOW_MINUTES = "10080";
  ctx.shirt = await createReturnableProduct(ctx);
  ctx.returnOrder = await placeAndDeliverOrder(app, ctx, ctx.shirt._id);
  ctx.rejectOrder = await placeAndDeliverOrder(app, ctx, ctx.shirt._id);
  ctx.milkOrder = await placeAndDeliverOrder(app, ctx, ctx.milk._id);
  const milkOrder = await Order.findOne({ orderId: ctx.milkOrder }).lean();
  ctx.milkOrderItemId = String(milkOrder.items[0]._id);
}

export default [
  // ── Return request ────────────────────────────────────────────────────────
  {
    route: "POST /api/orders/:orderId/returns",
    name: "non-returnable items are refused",
    as: "customer",
    params: ret("milkOrder"),
    body: { items: [{ itemIndex: 0, quantity: 1 }], reason: "Damaged Product" },
    status: 400,
    check: (res) => expect(res.body.message).toMatch(/not eligible for return: Non Returnable/),
  },
  { route: "POST /api/orders/:orderId/returns", name: "requires items", as: "customer", params: ret("returnOrder"), body: { reason: "x" }, status: 400 },
  {
    route: "POST /api/orders/:orderId/returns",
    name: "another customer cannot request it",
    as: "otherCustomer",
    params: ret("returnOrder"),
    body: { items: [{ itemIndex: 0, quantity: 1 }], reason: "Damaged Product" },
    status: [403, 404],
  },
  {
    route: "POST /api/orders/:orderId/returns",
    as: "customer",
    params: ret("returnOrder"),
    body: { items: [{ itemIndex: 0, quantity: 1 }], reason: "Damaged Product", reasonDetail: "Torn seam" },
    check: (res) => expect(res.body.result.returnStatus).toBe("return_requested"),
  },
  {
    route: "GET /api/orders/:orderId/returns",
    as: "customer",
    params: ret("returnOrder"),
    check: (res) =>
      expect(res.body.result).toEqual(
        expect.objectContaining({ returnStatus: "return_requested", returnReason: "Damaged Product", returnReasonDetail: "Torn seam" }),
      ),
  },
  {
    route: "GET /api/orders/seller-returns",
    as: "seller",
    check: (res, ctx) => expect(listOf(res).map((o) => o.orderId)).toContain(ctx.returnOrder),
  },
  { route: "PUT /api/orders/returns/:orderId/approve", name: "other sellers cannot approve", as: "otherSeller", params: ret("returnOrder"), body: {}, status: [403, 404] },
  {
    route: "PUT /api/orders/returns/:orderId/approve",
    as: "seller",
    params: ret("returnOrder"),
    body: {},
    check: (res) => expect(res.body.result.returnStatus).toBe("return_approved"),
  },
  {
    route: "PUT /api/orders/returns/:orderId/assign-delivery",
    as: "seller",
    params: ret("returnOrder"),
    body: (ctx) => ({ deliveryBoyId: String(ctx.rider._id) }),
    check: (res) => expect(res.body.result.returnStatus).toBe("return_pickup_assigned"),
  },
  {
    route: "PUT /api/orders/returns/:orderId/accept-pickup",
    as: "delivery",
    params: ret("returnOrder"),
    check: (res) => expect(res.body.message).toMatch(/accepted/i),
  },

  // ── Pickup from the customer ──────────────────────────────────────────────
  {
    route: "POST /api/orders/workflow/:orderId/return-otp/request",
    as: "delivery",
    params: ret("returnOrder"),
    body: AT_CUSTOMER,
    check: async (res, ctx) => {
      ctx.returnPickupOtp = await latestOtp(ctx.returnOrder, "return_pickup");
      expect(ctx.returnPickupOtp).toMatch(/^\d{4}$/);
    },
  },
  {
    route: "POST /api/orders/workflow/:orderId/return-otp/verify",
    name: "rejects a wrong code",
    as: "delivery",
    params: ret("returnOrder"),
    body: (ctx) => ({ otp: ctx.returnPickupOtp === "0000" ? "1111" : "0000" }),
    status: [400, 403],
  },
  {
    route: "POST /api/orders/returns/:orderId/pickup-proof",
    as: "delivery",
    params: ret("returnOrder"),
    body: { images: ["https://cdn.example.test/proof.png"] },
    check: (res) => expect(res.body.result.returnPickupImages).toEqual(["https://cdn.example.test/proof.png"]),
  },
  {
    route: "POST /api/orders/workflow/:orderId/return-otp/verify",
    as: "delivery",
    params: ret("returnOrder"),
    body: (ctx) => ({ otp: ctx.returnPickupOtp }),
    check: async (res, ctx) => {
      const order = await Order.findOne({ orderId: ctx.returnOrder }).lean();
      expect(order.returnStatus).not.toBe("return_pickup_assigned");
    },
  },
  { route: "PUT /api/orders/return-status/:orderId", name: "requires returnStatus", as: "delivery", params: ret("returnOrder"), body: {}, status: 400 },
  {
    route: "PUT /api/orders/return-status/:orderId",
    as: "delivery",
    params: ret("returnOrder"),
    body: { returnStatus: "return_in_transit" },
    status: [200, 400],
    check: async (res, ctx) => {
      const order = await Order.findOne({ orderId: ctx.returnOrder }).lean();
      expect(order.returnStatus).toBe("return_in_transit");
    },
  },

  // ── Drop at the seller ────────────────────────────────────────────────────
  {
    route: "POST /api/orders/workflow/:orderId/return-drop-otp/request",
    as: "delivery",
    params: ret("returnOrder"),
    body: AT_CUSTOMER,
    check: async (res, ctx) => {
      ctx.returnDropOtp = await latestOtp(ctx.returnOrder, "return_drop");
      expect(ctx.returnDropOtp).toMatch(/^\d{4}$/);
    },
  },
  {
    route: "POST /api/orders/workflow/:orderId/return-drop-otp/verify",
    as: "delivery",
    params: ret("returnOrder"),
    body: (ctx) => ({ code: ctx.returnDropOtp }), // the rider app sends `code` here
    check: async (res, ctx) => {
      const order = await Order.findOne({ orderId: ctx.returnOrder }).lean();
      expect(order.returnStatus).toBe("returned");
    },
  },
  { route: "PUT /api/orders/returns/:orderId/qc", name: "validates qcStatus", as: "admin", params: ret("returnOrder"), body: { qcStatus: "maybe" }, status: 400 },
  { route: "PUT /api/orders/returns/:orderId/qc", name: "sellers are denied", as: "seller", params: ret("returnOrder"), body: { qcStatus: "qc_passed" }, status: 403 },
  {
    route: "PUT /api/orders/returns/:orderId/qc",
    as: "admin",
    params: ret("returnOrder"),
    body: { qcStatus: "qc_passed", note: "Item intact" },
    check: async (res, ctx) => {
      const order = await Order.findOne({ orderId: ctx.returnOrder }).lean();
      expect(["qc_passed", "refund_completed"]).toContain(order.returnStatus);
    },
  },

  // ── Rejected return ───────────────────────────────────────────────────────
  {
    route: "POST /api/orders/:orderId/returns",
    name: "second return request (to reject)",
    as: "customer",
    params: ret("rejectOrder"),
    body: { items: [{ itemIndex: 0, quantity: 1 }], reason: "Wrong Product" },
  },
  {
    route: "PUT /api/orders/returns/:orderId/reject",
    as: "seller",
    params: ret("rejectOrder"),
    body: { reason: "Item was used" },
    check: (res) => expect(res.body.result.returnStatus).toBe("return_rejected"),
  },
  {
    route: "PUT /api/orders/returns/:orderId/reject-pickup",
    name: "rider declines a pickup that was never assigned to them",
    as: "delivery",
    params: ret("rejectOrder"),
    status: [200, 400, 403, 404],
  },

  // ── Product reviews ───────────────────────────────────────────────────────
  {
    route: "POST /api/reviews/submit",
    name: "only buyers can review",
    as: "otherCustomer",
    body: (ctx) => ({ productId: String(ctx.milk._id), rating: 5, comment: "Never bought it" }),
    status: 403,
  },
  {
    route: "POST /api/reviews/submit",
    as: "customer",
    body: (ctx) => ({ productId: String(ctx.milk._id), rating: 4, comment: "Fresh and cold" }),
    status: [200, 201],
    check: (res, ctx) => {
      ctx.reviewId = res.body.result._id;
      expect(res.body.result.rating).toBe(4);
    },
  },
  {
    route: "GET /api/reviews/admin/pending",
    as: "admin",
    check: (res, ctx) => expect(listOf(res).map((r) => String(r._id))).toContain(String(ctx.reviewId)),
  },
  {
    route: "PATCH /api/reviews/admin/status/:id",
    name: "validates status",
    as: "admin",
    params: (ctx) => ({ id: ctx.reviewId }),
    body: { status: "maybe" },
    status: 400,
  },
  {
    route: "PATCH /api/reviews/admin/status/:id",
    name: "invalid id",
    as: "admin",
    params: { id: "not-an-id" },
    body: { status: "approved" },
    status: [400, 404],
  },
  {
    route: "PATCH /api/reviews/admin/status/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.reviewId }),
    body: { status: "approved" },
    check: (res) => expect(res.body.result.status).toBe("approved"),
  },
  {
    route: "GET /api/reviews/product/:productId",
    params: (ctx) => ({ productId: ctx.milk._id }),
    check: (res) => expect(listOf(res).map((r) => r.comment)).toContain("Fresh and cold"),
  },

  // ── Product ratings ───────────────────────────────────────────────────────
  {
    route: "GET /api/product-ratings/eligibility/:orderId",
    as: "customer",
    params: ret("milkOrder"),
    check: (res) => expect(JSON.stringify(res.body.result)).toContain("Fresh Milk"),
  },
  { route: "POST /api/product-ratings", name: "requires orderItemId", as: "customer", body: { rating: 5 }, status: 400 },
  {
    route: "POST /api/product-ratings",
    as: "customer",
    body: (ctx) => ({ orderItemId: ctx.milkOrderItemId, rating: 5, comment: "Excellent" }),
    status: [200, 201],
    check: (res, ctx) => {
      ctx.productRatingId = res.body.result._id || res.body.result.rating?._id;
      expect(ctx.productRatingId).toBeTruthy();
    },
  },
  {
    route: "POST /api/product-ratings",
    name: "cannot rate the same item twice",
    as: "customer",
    body: (ctx) => ({ orderItemId: ctx.milkOrderItemId, rating: 1 }),
    status: [400, 409],
  },
  {
    route: "GET /api/product-ratings/orders/:orderId",
    as: "customer",
    params: ret("milkOrder"),
    check: (res) => expect(JSON.stringify(res.body)).toContain("Excellent"),
  },
  {
    route: "GET /api/product-ratings/products/:productId/ratings",
    params: (ctx) => ({ productId: ctx.milk._id }),
    check: (res) => expect(JSON.stringify(res.body.result)).toContain("Excellent"),
  },
  {
    route: "GET /api/product-ratings/products/:productId/rating-summary",
    params: (ctx) => ({ productId: ctx.milk._id }),
    check: (res) => expect(JSON.stringify(res.body.result)).toMatch(/"(ratingAverage|averageRating|average)":5/),
  },
  { route: "GET /api/product-ratings/products/:productId/rating-summary", name: "invalid id", params: { productId: "x" }, status: 400 },
  {
    route: "GET /api/product-ratings/admin",
    as: "admin",
    check: (res, ctx) => expect(JSON.stringify(res.body.result)).toContain(String(ctx.productRatingId)),
  },
  { route: "GET /api/product-ratings/admin", name: "customers are denied", as: "customer", status: 403 },
  {
    route: "PATCH /api/product-ratings/admin/:id/status",
    as: "admin",
    params: (ctx) => ({ id: ctx.productRatingId }),
    body: { status: "HIDDEN" },
    check: (res) => expect(JSON.stringify(res.body.result)).toContain("HIDDEN"),
  },

  // ── Delivery ratings ──────────────────────────────────────────────────────
  {
    route: "GET /api/delivery-ratings/eligibility/:orderId",
    as: "customer",
    params: ret("milkOrder"),
    check: (res) => expect(JSON.stringify(res.body.result)).toMatch(/eligible"?:true/i),
  },
  {
    route: "POST /api/delivery-ratings",
    name: "validates rating",
    as: "customer",
    body: (ctx) => ({ orderId: ctx.milkOrder, rating: 9 }),
    status: 400,
  },
  {
    route: "POST /api/delivery-ratings",
    as: "customer",
    body: (ctx) => ({ orderId: ctx.milkOrder, rating: 5, feedbackTags: ALL_FEEDBACK_TAGS.slice(0, 1), comment: "Polite rider" }),
    status: [200, 201],
    check: (res, ctx) => {
      ctx.deliveryRatingId = res.body.result.id;
      expect(res.body.result).toEqual(expect.objectContaining({ rating: 5, comment: "Polite rider" }));
      expect(ctx.deliveryRatingId).toBeTruthy();
    },
  },
  {
    route: "POST /api/delivery-ratings",
    name: "cannot rate the same order twice",
    as: "customer",
    body: (ctx) => ({ orderId: ctx.milkOrder, rating: 4 }),
    status: [400, 409],
  },
  {
    route: "GET /api/orders/:orderId/delivery-rating",
    as: "customer",
    params: ret("milkOrder"),
    check: (res) => expect(JSON.stringify(res.body.result)).toContain("Polite rider"),
  },
  {
    route: "GET /api/delivery-partners/me/rating",
    as: "delivery",
    check: (res) => expect(res.body.result).toEqual(expect.objectContaining({ ratingCount: 1, ratingAverage: 5 })),
  },
  {
    route: "GET /api/delivery-partners/me/ratings",
    as: "delivery",
    check: (res) => expect(JSON.stringify(res.body.result)).toContain("Polite rider"),
  },
  {
    route: "GET /api/admin/delivery-ratings",
    as: "admin",
    check: (res, ctx) => expect(JSON.stringify(res.body.result)).toContain(String(ctx.deliveryRatingId)),
  },
  {
    route: "GET /api/admin/delivery-ratings/:id",
    as: "admin",
    params: (ctx) => ({ id: ctx.deliveryRatingId }),
    check: (res) => expect(JSON.stringify(res.body.result)).toContain("Polite rider"),
  },
  { route: "GET /api/admin/delivery-ratings/:id", name: "unknown id", as: "admin", params: { id: OID }, status: 404 },
  {
    route: "PATCH /api/admin/delivery-ratings/:id/status",
    as: "admin",
    params: (ctx) => ({ id: ctx.deliveryRatingId }),
    body: { status: RATING_STATUSES.FLAGGED, reason: "Review" },
    check: (res) => expect(JSON.stringify(res.body.result)).toContain(RATING_STATUSES.FLAGGED),
  },
];
