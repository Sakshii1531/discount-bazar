/**
 * Boots the real backend on an in-memory MongoDB with seeded data for
 * browser tests against the real API (no mocks). Outbound network is
 * blocked; nothing touches production services.
 *   node scripts/e2e-live-server.mjs   → http://localhost:7999/api
 */
import cors from "cors";
import express from "express";
import { startTestApp, tokenFor } from "../__tests__/e2e/helpers/testApp.js";
import { seedWorld } from "../__tests__/e2e/helpers/world.js";

const app = await startTestApp();
const ctx = await seedWorld();
const server = express();
server.use(cors({ origin: true, credentials: true }));
server.use(app);
server.listen(7999, () => {
  console.log(
    JSON.stringify({
      ready: true,
      adminToken: tokenFor("admin", ctx.admin._id),
      sellerToken: tokenFor("seller", ctx.seller._id),
      customerToken: tokenFor("customer", ctx.customer._id),
      milkId: String(ctx.milk._id),
      breadId: String(ctx.bread._id),
      location: ctx.location,
    }),
  );
});
