import axiosInstance from "@core/api/axios";

// Active brands (name, slug, logo) rarely change during a session, so every
// caller shares one request. A failed request is cleared so the next caller
// retries.
let brandsRequest = null;

export const loadActiveBrands = () => {
  if (!brandsRequest) {
    brandsRequest = axiosInstance
      .get("/brands")
      .then((res) => {
        const list = res.data?.results || res.data?.result || [];
        return Array.isArray(list) ? list : [];
      })
      .catch((err) => {
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
