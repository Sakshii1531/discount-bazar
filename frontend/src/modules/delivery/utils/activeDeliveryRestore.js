/**
 * Where (if anywhere) to send the rider after a launch / foreground sync.
 *
 *  - "wait"  → still on splash/login; decide once they land.
 *  - null    → stay put (rider deliberately elsewhere, offer on screen,
 *              no active work, or several orders the rider should choose).
 *  - "<path>"→ reopen the single active order at its server-reported stage.
 */
const DASHBOARD = /^\/delivery(\/dashboard)?\/?$/;
const PRE_APP = /\/delivery\/(splash|auth|login)/;

export function isDashboardPath(path) {
  return DASHBOARD.test(path || "");
}

export function restoreTarget({ path, orders = [], incomingOfferOpen = false }) {
  if (PRE_APP.test(path || "")) return "wait";
  if (!isDashboardPath(path)) return null;
  if (incomingOfferOpen) return null;
  if (orders.length !== 1) return null;
  return orders[0].resumePath || `/delivery/order-details/${encodeURIComponent(orders[0].orderId)}`;
}
