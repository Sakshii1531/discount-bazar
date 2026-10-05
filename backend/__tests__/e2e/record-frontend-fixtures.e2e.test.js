/**
 * Records real API responses from the backend (in-memory Mongo + seeded
 * data) into frontend/e2e/fixtures/recorded.json, which the Playwright mock
 * API serves for read-only endpoints. Keeps frontend E2E stubs in sync with
 * the real response shapes.
 *
 * Skipped by default. Regenerate after changing an API response:
 *   CAPTURE_E2E_FIXTURES=1 npm run record:e2e-fixtures   (PowerShell: $env:CAPTURE_E2E_FIXTURES=1; npm run record:e2e-fixtures)
 */
import { jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import request from "supertest";
import { startTestApp, stopTestApp, bearer } from "./helpers/testApp.js";
import * as fx from "./helpers/fixtures.js";
import FAQ from "../../app/models/faq.js";

jest.setTimeout(180000);

const ENABLED = process.env.CAPTURE_E2E_FIXTURES === "1";
const OUT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../frontend/e2e/fixtures/recorded.json",
);

(ENABLED ? describe : describe.skip)("record frontend E2E fixtures", () => {
  let app;
  beforeAll(async () => {
    app = await startTestApp();
    await fx.ensureIndexes();
  });
  afterAll(stopTestApp);

  it("captures read-only endpoint responses", async () => {
    const admin = await fx.createAdmin({ name: "E2E Admin" });
    const seller = await fx.createSeller({ name: "E2E Seller", shopName: "E2E Mart" });
    const rider = await fx.createDelivery({ name: "E2E Rider" });
    await fx.createDelivery({ name: "Pending Rider", isVerified: false });
    await fx.createSeller({ name: "Ravi", shopName: "Pending Kirana", isVerified: false, applicationStatus: "pending" });
    const customer = await fx.createCustomer({ name: "E2E Customer" });
    const tree = await fx.createCategoryTree();
    const product = await fx.createProduct(seller, tree, { name: "Fresh Milk" });
    await FAQ.create({ question: "How fast is delivery?", answer: "Usually 12-15 minutes.", category: "Customer" });

    const as = {
      admin: bearer("admin", admin._id),
      seller: bearer("seller", seller._id),
      delivery: bearer("delivery", rider._id),
      customer: bearer("customer", customer._id),
    };

    // [role, path] — keys are stored without the /api prefix.
    const endpoints = [
      ["seller", "/seller/business/purchases"],
      ["seller", "/seller/business/suppliers"],
      ["seller", "/seller/business/customers"],
      ["seller", "/seller/business/dashboard"],
      ["seller", "/seller/business/settings"],
      ["seller", "/seller/business/cash-register/today"],
      ["seller", "/seller/business/reports/sales"],
      ["seller", "/seller/pos/catalog"],
      ["seller", "/seller/pos/sales"],
      ["seller", "/seller/pos/returns"],
      ["seller", "/seller/stats"],
      ["seller", "/seller/earnings"],
      ["seller", "/seller/wallet/summary"],
      ["admin", "/admin/stats"],
      ["admin", "/admin/sellers/active"],
      ["admin", "/admin/sellers/pending"],
      ["admin", "/admin/delivery-partners?verified=false"],
      ["admin", "/admin/delivery-partners?verified=true"],
      ["admin", "/admin/users"],
      ["admin", "/admin/faqs"],
      ["admin", "/admin/finance/summary"],
      ["admin", "/admin/finance/ledger"],
      ["admin", "/admin/finance/payouts"],
      ["admin", "/admin/seller-withdrawals"],
      ["admin", "/admin/delivery-withdrawals"],
      ["admin", "/admin/coupons"],
      ["admin", "/admin/pending-review-counts"],
      ["admin", "/tickets/admin/all"],
      ["delivery", "/delivery/stats"],
      ["delivery", "/delivery/earnings"],
      ["delivery", "/delivery/cod/summary"],
      ["delivery", "/delivery/order-history"],
      ["delivery", "/delivery/withdrawals"],
      ["delivery", "/delivery-partners/me/rating"],
      ["delivery", "/orders/available"],
      ["customer", "/customer/transactions"],
      ["customer", "/notifications"],
      [null, `/product-ratings/products/${product._id}/rating-summary`],
      [null, `/product-ratings/products/${product._id}/ratings`],
    ];

    const recorded = {};
    for (const [role, url] of endpoints) {
      let req = request(app).get(`/api${url}`);
      if (role) req = req.set("Authorization", as[role]);
      const res = await req;
      expect(res.status).toBe(200);
      const key = url.replace(String(product._id), ":productId");
      recorded[key] = res.body;
    }

    fs.writeFileSync(OUT, `${JSON.stringify(recorded, null, 2)}\n`);
  });
});
