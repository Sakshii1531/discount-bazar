/**
 * Route geometry helpers for live tracking maps (rider + customer).
 * Paths are arrays of { lat, lng } (or google.maps.LatLng — lat()/lng() are read too).
 * Distances use a local equirectangular projection, accurate to well under a metre
 * over the few-hundred-metre segments of a road route.
 */

const EARTH_R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;

const readLat = (p) => (typeof p?.lat === "function" ? p.lat() : p?.lat);
const readLng = (p) => (typeof p?.lng === "function" ? p.lng() : p?.lng);

export const toLatLngLiteral = (p) => {
  const lat = Number(readLat(p));
  const lng = Number(readLng(p));
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

export function haversineMeters(a, b) {
  const A = toLatLngLiteral(a);
  const B = toLatLngLiteral(b);
  if (!A || !B) return null;
  const dLat = toRad(B.lat - A.lat);
  const dLng = toRad(B.lng - A.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(A.lat)) * Math.cos(toRad(B.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Closest point on segment AB to P (all literals). Returns { point, t, distance }. */
function projectOnSegment(p, a, b) {
  const cosLat = Math.cos(toRad(p.lat));
  const ax = toRad(a.lng) * cosLat * EARTH_R;
  const ay = toRad(a.lat) * EARTH_R;
  const bx = toRad(b.lng) * cosLat * EARTH_R;
  const by = toRad(b.lat) * EARTH_R;
  const px = toRad(p.lng) * cosLat * EARTH_R;
  const py = toRad(p.lat) * EARTH_R;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const point = { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  return { point, t, distance: Math.hypot(px - qx, py - qy) };
}

/**
 * Snap a GPS fix onto the route.
 * `hintIndex` (the last snapped segment) keeps the search moving forward so a
 * route that doubles back on itself doesn't make the marker jump backwards.
 * Returns { point, segmentIndex, distance } or null.
 */
export function snapToRoute(path, gps, hintIndex = 0) {
  const p = toLatLngLiteral(gps);
  if (!p || !Array.isArray(path) || path.length < 2) return null;
  const pts = path.map(toLatLngLiteral);

  let best = null;
  const consider = (i) => {
    const a = pts[i];
    const b = pts[i + 1];
    if (!a || !b) return;
    const r = projectOnSegment(p, a, b);
    if (!best || r.distance < best.distance) best = { point: r.point, segmentIndex: i, distance: r.distance };
  };

  // Look ahead from the last known position first; fall back to the whole route.
  const start = Math.max(0, Math.min(hintIndex, pts.length - 2));
  for (let i = start; i < pts.length - 1; i += 1) consider(i);
  if (!best || best.distance > 50) {
    for (let i = 0; i < start; i += 1) consider(i);
  }
  return best;
}

/** Route from the snapped point to the destination (the part still to travel). */
export function remainingPath(path, snap) {
  if (!snap || !Array.isArray(path) || path.length < 2) return path || [];
  const rest = path.slice(snap.segmentIndex + 1).map(toLatLngLiteral).filter(Boolean);
  return [snap.point, ...rest];
}

export function pathLengthMeters(path) {
  if (!Array.isArray(path) || path.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < path.length - 1; i += 1) total += haversineMeters(path[i], path[i + 1]) || 0;
  return total;
}

/**
 * Tuning shared by both maps.
 * SNAP: GPS within this distance of the route is drawn on the route (typical phone GPS error).
 * OFF_ROUTE: further than this for OFF_ROUTE_FIXES consecutive fixes means the rider took
 * another road → request a new route (at most once per REROUTE_MIN_INTERVAL_MS).
 */
export const ROUTE_TRACKING = Object.freeze({
  SNAP_MAX_M: 45,
  OFF_ROUTE_M: 70,
  OFF_ROUTE_FIXES: 2,
  REROUTE_MIN_INTERVAL_MS: 20000,
});

/** Snap distance adapted to the fix's reported accuracy (bounded 25–60 m). */
export function snapThresholdFor(accuracy) {
  const acc = Number(accuracy);
  if (!Number.isFinite(acc) || acc <= 0) return ROUTE_TRACKING.SNAP_MAX_M;
  return Math.max(25, Math.min(60, acc * 1.5));
}
