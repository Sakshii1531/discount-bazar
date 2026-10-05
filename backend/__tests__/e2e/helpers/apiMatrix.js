/**
 * Table-driven API E2E runner.
 *
 * Each module lists its endpoint cases in __tests__/e2e/matrix/<module>.cases.js:
 *
 *   {
 *     route: "PUT /api/admin/coupons/:id",   // must match the route inventory exactly
 *     name: "updates a coupon",              // optional label
 *     as: "admin",                           // ctx.auth key, a function (ctx) => header, or null for anonymous
 *     params: (ctx) => ({ id: ctx.couponId }),
 *     query: { page: 1 } | (ctx) => ({...}),
 *     body: {...} | (ctx) => ({...}),
 *     attach: { field: "image", filename: "x.png" }, // multipart upload of a tiny PNG
 *     status: 200 | [200, 201],
 *     check: (res, ctx) => { ...expectations; may store ids on ctx },
 *     before: async (ctx) => {...},          // extra seeding for this case
 *     optionalAuth: true,                    // endpoint works for guests too (skip auto 401 check)
 *   }
 *
 * Cases run sequentially in declaration order and share one seeded `ctx`, so a
 * "create" case can store an id that later "update"/"delete" cases use.
 */
import request from "supertest";

export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const resolve = (value, ctx) => (typeof value === "function" ? value(ctx) : value);

export function routeKey(c) {
  return c.route;
}

export function buildPath(route, params = {}) {
  const [, template] = route.split(" ");
  return template
    .replace(/\*(\w+)/g, (_, k) => encodeURIComponent(String(params[k] ?? "missing")).replace(/%2F/g, "/"))
    .replace(/:(\w+)\??/g, (_, k) => {
      if (params[k] === undefined) throw new Error(`Missing route param "${k}" for ${route}`);
      return encodeURIComponent(String(params[k]));
    });
}

export function describeBody(res) {
  const text = res.body && Object.keys(res.body).length ? JSON.stringify(res.body) : res.text;
  return String(text || "").slice(0, 600);
}

export async function callCase(app, c, ctx, { withAuth = true } = {}) {
  const [method] = c.route.split(" ");
  const params = resolve(c.params, ctx) || {};
  let req = request(app)[method.toLowerCase()](buildPath(c.route, params));
  if (withAuth && c.as) {
    const header = typeof c.as === "function" ? c.as(ctx) : ctx.auth[c.as];
    if (!header) throw new Error(`No auth header for role "${c.as}"`);
    req = req.set("Authorization", header);
  }
  for (const [k, v] of Object.entries(resolve(c.headers, ctx) || {})) req = req.set(k, v);
  const query = resolve(c.query, ctx);
  if (query) req = req.query(query);
  if (c.attach) {
    const att = resolve(c.attach, ctx);
    const fields = resolve(c.body, ctx) || {};
    for (const [k, v] of Object.entries(fields)) {
      req = req.field(k, typeof v === "object" ? JSON.stringify(v) : String(v));
    }
    req = req.attach(att.field, att.buffer || PNG_1X1, { filename: att.filename || "test.png", contentType: att.contentType || "image/png" });
    return req;
  }
  if (c.rawBody !== undefined) {
    return req.set("Content-Type", "application/json").send(resolve(c.rawBody, ctx));
  }
  const body = resolve(c.body, ctx);
  return body !== undefined ? req.send(body) : req;
}

/** Registers one Jest test per case, in order, against a shared context. */
export function runCases(cases, getApp, getCtx) {
  for (const c of cases) {
    const statuses = [].concat(c.status ?? 200);
    const label = `${c.route}${c.name ? ` — ${c.name}` : ""} → ${statuses.join("/")}`;
    const fn = c.knownBug ? it.failing : it;
    fn(label, async () => {
      const ctx = getCtx();
      if (c.before) await c.before(ctx);
      const res = await callCase(getApp(), c, ctx);
      if (!statuses.includes(res.status)) {
        throw new Error(`${c.route}: expected HTTP ${statuses.join(" or ")}, got ${res.status}\n${describeBody(res)}`);
      }
      // Standard envelope: { success, error, message, result | results }.
      if (c.envelope !== false && res.type === "application/json" && res.body && "success" in res.body) {
        expect(typeof res.body.message).toBe("string");
        expect(res.body.success).toBe(res.status < 400);
        expect(res.body.error).toBe(res.status >= 400);
      }
      if (c.check) await c.check(res, ctx);
    });
  }
}

/**
 * Local-storage uploads land in <cwd>/public/uploads. Snapshot it before a
 * suite and delete anything new afterwards so tests leave no files behind.
 */
import fs from "fs";
import path from "path";

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const full = path.join(dir, d.name);
    return d.isDirectory() ? listFiles(full) : [full];
  });
}

export function trackUploads() {
  const dir = path.join(process.cwd(), "public", "uploads");
  const before = new Set(listFiles(dir));
  return () => {
    for (const file of listFiles(dir)) if (!before.has(file)) fs.rmSync(file, { force: true });
  };
}
