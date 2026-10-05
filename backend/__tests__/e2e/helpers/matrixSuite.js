/**
 * Boilerplate for a module matrix spec: boots the app on an in-memory DB,
 * seeds the shared world, runs the module's cases in order and cleans up any
 * uploaded files.
 */
import { jest } from "@jest/globals";
import { startTestApp, stopTestApp } from "./testApp.js";
import { seedWorld } from "./world.js";
import { runCases, trackUploads } from "./apiMatrix.js";

export function matrixSuite(title, cases, { seed } = {}) {
  jest.setTimeout(180000);
  let app;
  let ctx;
  let cleanupUploads;

  beforeAll(async () => {
    cleanupUploads = trackUploads();
    app = await startTestApp();
    ctx = await seedWorld();
    if (seed) await seed(ctx, app);
  });

  afterAll(async () => {
    await stopTestApp();
    cleanupUploads?.();
  });

  describe(title, () => {
    runCases(cases, () => app, () => ctx);
  });
}
