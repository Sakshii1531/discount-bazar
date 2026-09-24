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

/** Throws 423 if the business day containing `date` has been closed. */
export async function assertDayOpen(sellerId, date = new Date(), tz = null) {
  const zone = tz || (await getSellerTz(sellerId));
  const key = dateKeyOf(new Date(date), zone);
  const day = await CashDay.findOne({ seller: sellerId, dateKey: key, closed: true }).select("_id").lean();
  if (day) {
    throw Object.assign(new Error(`Business day ${key} is closed. Reopen it to make changes.`), { statusCode: 423 });
  }
}
