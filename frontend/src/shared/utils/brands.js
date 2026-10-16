import axiosInstance from "@core/api/axios";

// Active brands (name, slug, logo) rarely change during a session, so every
// caller shares one request. Network / server errors are retried a couple of
// times (e.g. the API restarting); a request that still fails is cleared so the
// next caller retries.
let brandsRequest = null;

const RETRY_DELAYS_MS = [800, 2000];
const isRetryable = (err) => !err?.response || err.response.status >= 500;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchActiveBrands() {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const res = await axiosInstance.get("/brands");
      const list = res.data?.results || res.data?.result || [];
      return Array.isArray(list) ? list : [];
    } catch (err) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryable(err)) throw err;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

export const loadActiveBrands = () => {
  if (!brandsRequest) {
    brandsRequest = fetchActiveBrands().catch((err) => {
      brandsRequest = null;
      throw err;
    });
  }
  return brandsRequest;
};

// Same normalization as the backend's Brand.nameKey.
export const brandNameKey = (name) =>
  String(name || "").trim().replace(/\s+/g, " ").toLowerCase();

let logoMapRequest = null;

/** Resolves to a Map of brandNameKey -> logo URL (brands with a logo only). */
export const loadBrandLogoMap = () => {
  if (!logoMapRequest) {
    logoMapRequest = loadActiveBrands()
      .then((brands) => new Map(
        brands.filter((b) => b.logo).map((b) => [brandNameKey(b.name), b.logo]),
      ))
      .catch(() => {
        logoMapRequest = null;
        return new Map();
      });
  }
  return logoMapRequest;
};
