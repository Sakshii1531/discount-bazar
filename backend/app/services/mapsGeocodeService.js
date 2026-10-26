import { Client } from "@googlemaps/google-maps-services-js";
import crypto from "crypto";
import { getRedisClient } from "../config/redis.js";
import GeocodeCache from "../models/geocodeCache.js";

const client = new Client({});

const GEOCODE_CACHE_TTL_SEC = () =>
  parseInt(process.env.GEOCODE_CACHE_TTL_SEC || "2592000", 10); // 30d

function getApiKey() {
  return (
    process.env.GOOGLE_MAPS_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_SERVER_KEY?.trim() ||
    ""
  );
}

function cacheKeyAddress(address, country) {
  // v3: results also carry city/state/pincode.
  const raw = `geocode:v3:addr:${country || ""}:${address || ""}`.toLowerCase();
  const h = crypto.createHash("sha1").update(raw).digest("hex");
  return `geocode:v3:${h}`;
}

function cacheKeyPlaceId(placeId) {
  const raw = `geocode:v3:pid:${placeId || ""}`.toLowerCase();
  const h = crypto.createHash("sha1").update(raw).digest("hex");
  return `geocode:v3:${h}`;
}

// City / state / pincode from a Geocoding API result's address components.
function addressParts(result) {
  const components = result?.address_components || [];
  const find = (types) => components.find((c) => types.some((t) => c.types?.includes(t)))?.long_name || "";
  return {
    city: find(["locality"]) || find(["administrative_area_level_3"]) || find(["administrative_area_level_2"]),
    state: find(["administrative_area_level_1"]),
    pincode: find(["postal_code"]),
  };
}

/**
 * Forward geocode an address string or placeId -> { lat, lng, formattedAddress }.
 * Uses Redis cache when available.
 *
 * Requires Geocoding API enabled in Google Cloud.
 */
export async function geocodeAddress(address, { country } = {}) {
  if (!address || typeof address !== "string" || address.trim().length < 3) {
    const err = new Error("address is required");
    err.statusCode = 400;
    throw err;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error(
      "Google Maps API key missing. Set GOOGLE_MAPS_API_KEY (Geocoding API).",
    );
    err.statusCode = 500;
    err.code = "MAPS_KEY_MISSING";
    throw err;
  }

  const addr = address.trim();
  const redis = getRedisClient();
  const key = cacheKeyAddress(addr, country);

  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch {
      // ignore cache errors
    }
  }

  // Mongo fallback cache (also used when Redis is disabled)
  try {
    const doc = await GeocodeCache.findOne({ key }).lean();
    if (doc && doc.expiresAt && doc.expiresAt > new Date()) {
      return {
        lat: doc.lat,
        lng: doc.lng,
        formattedAddress: doc.formattedAddress || addr,
        placeId: doc.placeId || null,
        types: Array.isArray(doc.types) ? doc.types : [],
        city: doc.city || "",
        state: doc.state || "",
        pincode: doc.pincode || "",
      };
    }
  } catch {
    // ignore cache errors
  }

  const params = {
    address: addr,
    key: apiKey,
  };

  // Optional country bias (e.g. IN). This doesn't hardcode business rules; it just improves accuracy.
  if (country && typeof country === "string" && country.trim()) {
    params.components = `country:${country.trim().toUpperCase()}`;
  } else if (process.env.MAPS_DEFAULT_COUNTRY?.trim()) {
    params.components = `country:${process.env.MAPS_DEFAULT_COUNTRY.trim().toUpperCase()}`;
  }

  const resp = await client.geocode({ params, timeout: 10000 });
  const status = resp.data?.status;

  if (status && status !== "OK") {
    const msg = resp.data?.error_message || status;
    const err = new Error(`Geocoding failed: ${msg}`);
    err.statusCode = status === "ZERO_RESULTS" ? 404 : 502;
    err.code = status;
    throw err;
  }

  const first = resp.data?.results?.[0];
  const loc = first?.geometry?.location;
  if (!first || !loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
    const err = new Error("Geocoding returned no coordinates");
    err.statusCode = 404;
    err.code = "ZERO_RESULTS";
    throw err;
  }

  const result = {
    lat: loc.lat,
    lng: loc.lng,
    formattedAddress: first.formatted_address || addr,
    placeId: first.place_id || null,
    types: Array.isArray(first.types) ? first.types : [],
    ...addressParts(first),
  };

  const expiresAt = new Date(Date.now() + GEOCODE_CACHE_TTL_SEC() * 1000);

  if (redis) {
    try {
      await redis.set(key, JSON.stringify(result), "EX", GEOCODE_CACHE_TTL_SEC());
    } catch {
      // ignore cache errors
    }
  }

  try {
    await GeocodeCache.updateOne(
      { key },
      {
        $set: {
          lat: result.lat,
          lng: result.lng,
          formattedAddress: result.formattedAddress,
          placeId: result.placeId,
          types: result.types,
          city: result.city,
          state: result.state,
          pincode: result.pincode,
          expiresAt,
        },
      },
      { upsert: true },
    );
  } catch {
    // ignore mongo cache errors
  }

  return result;
}

export async function geocodePlaceId(placeId) {
  if (!placeId || typeof placeId !== "string" || placeId.trim().length < 5) {
    const err = new Error("placeId is required");
    err.statusCode = 400;
    throw err;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    const err = new Error(
      "Google Maps API key missing. Set GOOGLE_MAPS_API_KEY (Geocoding API).",
    );
    err.statusCode = 500;
    err.code = "MAPS_KEY_MISSING";
    throw err;
  }

  const pid = placeId.trim();
  const key = cacheKeyPlaceId(pid);
  const redis = getRedisClient();

  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch {
      // ignore
    }
  }

  try {
    const doc = await GeocodeCache.findOne({ key }).lean();
    if (doc && doc.expiresAt && doc.expiresAt > new Date()) {
      return {
        lat: doc.lat,
        lng: doc.lng,
        formattedAddress: doc.formattedAddress || "",
        placeId: doc.placeId || pid,
        types: Array.isArray(doc.types) ? doc.types : [],
        city: doc.city || "",
        state: doc.state || "",
        pincode: doc.pincode || "",
      };
    }
  } catch {
    // ignore
  }

  // Geocoding API supports place_id param.
  const resp = await client.geocode({
    params: { place_id: pid, key: apiKey },
    timeout: 10000,
  });

  const status = resp.data?.status;
  if (status && status !== "OK") {
    const msg = resp.data?.error_message || status;
    const err = new Error(`Geocoding failed: ${msg}`);
    err.statusCode = status === "ZERO_RESULTS" ? 404 : 502;
    err.code = status;
    throw err;
  }

  const first = resp.data?.results?.[0];
  const loc = first?.geometry?.location;
  if (!first || !loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") {
    const err = new Error("Geocoding returned no coordinates");
    err.statusCode = 404;
    err.code = "ZERO_RESULTS";
    throw err;
  }

  const result = {
    lat: loc.lat,
    lng: loc.lng,
    formattedAddress: first.formatted_address || "",
    placeId: first.place_id || pid,
    types: Array.isArray(first.types) ? first.types : [],
    ...addressParts(first),
  };

  const expiresAt = new Date(Date.now() + GEOCODE_CACHE_TTL_SEC() * 1000);

  if (redis) {
    try {
      await redis.set(key, JSON.stringify(result), "EX", GEOCODE_CACHE_TTL_SEC());
    } catch {
      // ignore
    }
  }

  try {
    await GeocodeCache.updateOne(
      { key },
      {
        $set: {
          lat: result.lat,
          lng: result.lng,
          formattedAddress: result.formattedAddress,
          placeId: result.placeId,
          types: result.types,
          city: result.city,
          state: result.state,
          pincode: result.pincode,
          expiresAt,
        },
      },
      { upsert: true },
    );
  } catch {
    // ignore
  }

  return result;
}

// ---------------------------------------------------------------------------
// Reverse geocoding: lat/lng -> structured address (city, state, pincode).
// Done server-side because the Geocoding web service rejects browser
// (referrer-restricted) keys, and Nominatim requires a real User-Agent which
// browsers cannot set.
// ---------------------------------------------------------------------------

const REVERSE_CACHE_MAX = 500;
const reverseMemCache = new Map();

// ~11m precision: nearby taps share a cache entry without changing the address.
function cacheKeyReverse(lat, lng) {
  return `geocode:v2:rev:${lat.toFixed(4)},${lng.toFixed(4)}`;
}

function buildDisplayName(parts) {
  const out = [];
  for (const p of parts) {
    if (p && !out.includes(p)) out.push(p);
  }
  return out.join(", ");
}

async function reverseGeocodeWithGoogle(lat, lng, apiKey) {
  const resp = await client.reverseGeocode({
    params: { latlng: { lat, lng }, key: apiKey },
    timeout: 10000,
  });
  const status = resp.data?.status;
  if (status && status !== "OK") {
    const err = new Error(`Reverse geocoding failed: ${resp.data?.error_message || status}`);
    err.statusCode = status === "ZERO_RESULTS" ? 404 : 502;
    err.code = status;
    throw err;
  }

  const results = Array.isArray(resp.data?.results) ? resp.data.results : [];
  if (results.length === 0) {
    const err = new Error("No address found for these coordinates");
    err.statusCode = 404;
    err.code = "ZERO_RESULTS";
    throw err;
  }

  // The first result can be a plus-code or a bare route, so look each
  // component up across all results, most specific first.
  const find = (types) => {
    for (const r of results) {
      const c = (r.address_components || []).find((comp) =>
        types.every((t) => comp.types.includes(t)),
      );
      if (c) return c.long_name;
    }
    return "";
  };

  const premise = find(["premise"]);
  const area = find(["neighborhood"]) || find(["sublocality_level_1"]) || find(["sublocality"]);
  const city =
    find(["locality"]) ||
    find(["administrative_area_level_3"]) ||
    find(["administrative_area_level_2"]);
  const state = find(["administrative_area_level_1"]);
  const pincode = find(["postal_code"]);
  const country = find(["country"]);
  const first = results.find((r) => !r.types?.includes("plus_code")) || results[0];

  return {
    displayName:
      buildDisplayName([premise, area, city, [state, pincode].filter(Boolean).join(" "), country]) ||
      first.formatted_address ||
      "",
    formattedAddress: first.formatted_address || "",
    area,
    city,
    state,
    pincode,
    country,
    placeId: first.place_id || null,
    source: "google",
  };
}

async function reverseGeocodeWithNominatim(lat, lng) {
  const params = new URLSearchParams({
    format: "jsonv2",
    lat: String(lat),
    lon: String(lng),
    addressdetails: "1",
  });
  const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    headers: {
      "Accept-Language": "en",
      // Nominatim usage policy requires an identifying User-Agent.
      "User-Agent": process.env.MAPS_USER_AGENT?.trim() || "DiscountBazar/1.0 (reverse-geocode)",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    const err = new Error(`Reverse geocoding failed: HTTP ${resp.status}`);
    err.statusCode = 502;
    err.code = "REVERSE_GEOCODE_FAILED";
    throw err;
  }
  const data = await resp.json();
  const addr = data?.address;
  if (!addr) {
    const err = new Error("No address found for these coordinates");
    err.statusCode = 404;
    err.code = "ZERO_RESULTS";
    throw err;
  }

  const area = addr.neighbourhood || addr.suburb || addr.quarter || addr.residential || "";
  const city =
    addr.city || addr.town || addr.village || addr.municipality || addr.county || addr.state_district || "";
  const state = addr.state || addr.territory || "";
  const pincode = addr.postcode || "";
  const country = addr.country || "";

  return {
    displayName:
      buildDisplayName([
        [addr.house_number, addr.road].filter(Boolean).join(" "),
        area,
        city,
        [state, pincode].filter(Boolean).join(" "),
        country,
      ]) ||
      data.display_name ||
      "",
    formattedAddress: data.display_name || "",
    area,
    city,
    state,
    pincode,
    country,
    placeId: null,
    source: "osm",
  };
}

/**
 * Reverse geocode coordinates -> { displayName, formattedAddress, area, city,
 * state, pincode, country, placeId, source }.
 * Tries Google (server key) first, then OpenStreetMap Nominatim.
 */
export async function reverseGeocode(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln) || Math.abs(la) > 90 || Math.abs(ln) > 180) {
    const err = new Error("valid lat and lng are required");
    err.statusCode = 400;
    err.code = "INVALID_COORDINATES";
    throw err;
  }

  const key = cacheKeyReverse(la, ln);
  const redis = getRedisClient();

  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch {
      // ignore cache errors
    }
  }
  if (reverseMemCache.has(key)) return reverseMemCache.get(key);

  let result = null;
  let lastError = null;

  const apiKey = getApiKey();
  if (apiKey) {
    try {
      result = await reverseGeocodeWithGoogle(la, ln, apiKey);
    } catch (e) {
      lastError = e;
    }
  }
  if (!result) {
    try {
      result = await reverseGeocodeWithNominatim(la, ln);
    } catch (e) {
      lastError = e;
    }
  }
  if (!result) {
    throw lastError || Object.assign(new Error("Reverse geocoding failed"), { statusCode: 502 });
  }

  if (redis) {
    try {
      await redis.set(key, JSON.stringify(result), "EX", GEOCODE_CACHE_TTL_SEC());
    } catch {
      // ignore cache errors
    }
  }
  if (reverseMemCache.size >= REVERSE_CACHE_MAX) {
    reverseMemCache.delete(reverseMemCache.keys().next().value);
  }
  reverseMemCache.set(key, result);

  return result;
}
