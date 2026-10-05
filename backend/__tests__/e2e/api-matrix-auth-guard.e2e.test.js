/**
 * Auth guard derived from the matrix: any route whose cases always send a
 * token (and isn't marked optionalAuth or exercised anonymously) must refuse
 * an anonymous request with 401 — before touching any data.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { jest } from "@jest/globals";
import request from "supertest";
import { startTestApp, stopTestApp } from "./helpers/testApp.js";
import { buildPath } from "./helpers/apiMatrix.js";

jest.setTimeout(180000);

const OID = "64b7f0c2a1b2c3d4e5f60718";
const matrixDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "matrix");

const allCases = [];
for (const file of fs.readdirSync(matrixDir).filter((f) => f.endsWith(".cases.js"))) {
  const { default: cases } = await import(`./matrix/${file}`);
  allCases.push(...cases);
}

const byRoute = new Map();
for (const c of allCases) {
  if (!byRoute.has(c.route)) byRoute.set(c.route, []);
  byRoute.get(c.route).push(c);
}
const protectedRoutes = [...byRoute.entries()]
  .filter(([, cases]) => cases.every((c) => c.as && !c.optionalAuth))
  .map(([route]) => route)
  .sort();

let app;
beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);

test("the matrix marks a meaningful number of routes as protected", () => {
  expect(protectedRoutes.length).toBeGreaterThan(200);
});

test.each(protectedRoutes)("%s rejects anonymous requests with 401", async (route) => {
  const [method, template] = route.split(" ");
  const params = Object.fromEntries([...template.matchAll(/[:*](\w+)/g)].map(([, k]) => [k, OID]));
  const res = await request(app)[method.toLowerCase()](buildPath(route, params)).send({});
  expect(res.status).toBe(401);
});
