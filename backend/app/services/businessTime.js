import Seller from "../models/seller.js";
import CashDay from "../models/cashDay.js";

export const DEFAULT_TZ = "Asia/Kolkata";

export async function getSellerTz(sellerId) {
  const s = await Seller.findById(sellerId).select("timezone").lean();
  return s?.timezone || DEFAULT_TZ;
}

export function isValidTz(tz) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Offset (ms) of `tz` from UTC at the given instant.
function tzOffsetMs(instant, tz) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instant);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - (instant.getTime() - (instant.getTime() % 1000));
}

// UTC instant at which local wall-clock `key` (YYYY-MM-DD) + ms-of-day occurs in `tz`.
function localToInstant(key, msOfDay, tz) {
  const [y, m, d] = key.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d) + msOfDay;
  let guess = naive - tzOffsetMs(new Date(naive), tz);
  guess = naive - tzOffsetMs(new Date(guess), tz);
  return new Date(guess);
}

export const dayStart = (key, tz = DEFAULT_TZ) => localToInstant(key, 0, tz);
export const dayEnd = (key, tz = DEFAULT_TZ) => localToInstant(key, 86399999, tz);

export function dateKeyOf(date, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export const todayKey = (tz = DEFAULT_TZ) => dateKeyOf(new Date(), tz);

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Bound for one side of a list filter: a YYYY-MM-DD key is a whole business day
// in `tz`; any other parseable value is taken as an exact instant.
function rangeBound(value, tz, end) {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (DATE_KEY_RE.test(v)) return end ? dayEnd(v, tz) : dayStart(v, tz);
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Optional date filter for list endpoints. Accepts `from`/`to` or
 * `startDate`/`endDate`; returns a Mongo range ({ $gte, $lte }) or null when
 * neither side is set. A reversed range is swapped rather than matching nothing.
 */
export function dateRangeFilter(query = {}, tz = DEFAULT_TZ) {
  let start = rangeBound(query.from ?? query.startDate, tz, false);
  let end = rangeBound(query.to ?? query.endDate, tz, true);
  if (!start && !end) return null;
  if (start && end && start > end) {
    const fromKey = String(query.from ?? query.startDate).trim();
    const toKey = String(query.to ?? query.endDate).trim();
    start = rangeBound(toKey, tz, false);
    end = rangeBound(fromKey, tz, true);
  }
  return { ...(start && { $gte: start }), ...(end && { $lte: end }) };
}

/** Throws 423 if the business day containing `date` has been closed. */
export async function assertDayOpen(sellerId, date = new Date(), tz = null) {
  const zone = tz || (await getSellerTz(sellerId));
  const key = dateKeyOf(new Date(date), zone);
  const day = await CashDay.findOne({ seller: sellerId, dateKey: key, closed: true }).select("_id").lean();
  if (day) {
    throw Object.assign(new Error(`Business day ${key} is closed. Reopen it to make changes.`), { statusCode: 423 });
  }
}
