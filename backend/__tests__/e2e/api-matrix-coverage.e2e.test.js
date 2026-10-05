/**
 * Coverage guard for the API E2E matrix: every route the app registers must
 * have at least one case in __tests__/e2e/matrix/*.cases.js, and every case
 * must point at a route that exists.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { configureTestEnv } from "./helpers/testApp.js";
import { collectApiRoutes } from "./helpers/routeInventory.js";

const matrixDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "matrix");

let inventory;
let covered;

beforeAll(async () => {
  configureTestEnv();
  inventory = (await collectApiRoutes()).map((r) => `${r.method} ${r.path}`);
  covered = new Set();
  for (const file of fs.readdirSync(matrixDir).filter((f) => f.endsWith(".cases.js"))) {
    const { default: cases } = await import(`./matrix/${file}`);
    for (const c of cases) covered.add(c.route);
  }
}, 120000);

test("every case targets a real route", () => {
  const unknown = [...covered].filter((r) => !inventory.includes(r));
  expect(unknown).toEqual([]);
});

test("every route has at least one case", () => {
  const missing = inventory.filter((r) => !covered.has(r));
  if (process.env.MATRIX_COVERAGE_REPORT) {
    fs.writeFileSync(process.env.MATRIX_COVERAGE_REPORT, missing.join("\n"));
  }
  expect(missing).toEqual([]);
});
