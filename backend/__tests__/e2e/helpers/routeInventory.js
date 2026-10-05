/**
 * Records every route the real Express app registers, by wrapping the
 * Router prototype before app/routes/index.js is imported. Used to prove
 * the API E2E matrix covers every endpoint.
 */
import express from "express";

const METHODS = ["get", "post", "put", "patch", "delete"];
const routerMeta = new WeakMap(); // router -> { routes: [[METHOD, path, handlers]], mounts: [[path, child]] }

function meta(router) {
  if (!routerMeta.has(router)) routerMeta.set(router, { routes: [], mounts: [] });
  return routerMeta.get(router);
}

let installed = false;
export function installRouteRecorder() {
  if (installed) return;
  installed = true;
  const proto = express.Router.prototype;
  for (const m of METHODS) {
    const original = proto[m];
    proto[m] = function recordRoute(path, ...handlers) {
      if (typeof path === "string") meta(this).routes.push([m.toUpperCase(), path, handlers]);
      return original.call(this, path, ...handlers);
    };
  }
  const originalUse = proto.use;
  proto.use = function recordUse(...args) {
    const path = typeof args[0] === "string" ? args[0] : "/";
    for (const fn of args) {
      if (typeof fn === "function" && routerMeta.has(fn)) meta(this).mounts.push([path, fn]);
      else if (typeof fn === "function" && typeof fn.stack !== "undefined") meta(this).mounts.push([path, fn]);
    }
    return originalUse.apply(this, args);
  };
}

const join = (a, b) => (`${a}/${b}`).replace(/\/+/g, "/").replace(/(.)\/$/, "$1");

/** Flattens the recorded tree under `router` mounted at `prefix`. */
export function listRoutes(router, prefix = "") {
  const out = [];
  const m = routerMeta.get(router);
  if (!m) return out;
  for (const [method, path, handlers] of m.routes) {
    out.push({
      method,
      path: join(prefix, path),
      handlerNames: handlers.map((h) => h?.name || "anonymous"),
    });
  }
  for (const [path, child] of m.mounts) out.push(...listRoutes(child, join(prefix, path)));
  return out;
}

/** Imports the real route tree and returns every API route as "METHOD /api/path". */
export async function collectApiRoutes() {
  installRouteRecorder();
  const captured = [];
  const fakeApp = {
    use(path, router) {
      captured.push([path, router]);
    },
  };
  const { default: setupRoutes } = await import("../../../app/routes/index.js");
  setupRoutes(fakeApp);
  const routes = [];
  for (const [path, router] of captured) routes.push(...listRoutes(router, path));
  const seen = new Set();
  return routes.filter((r) => {
    const key = `${r.method} ${r.path}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
