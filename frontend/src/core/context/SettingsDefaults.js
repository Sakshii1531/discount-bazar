import { getJSON, setJSON, STORAGE_KEYS } from "@core/utils/storage";

/** Brand colours used until admin settings load (match :root in index.css). */
export const DEFAULT_PRIMARY_COLOR = "#0284c7";
export const DEFAULT_SECONDARY_COLOR = "#64748b";

/** Default fallbacks when settings are not yet loaded or API fails */
export const DEFAULT_SETTINGS = {
  appName: "App",
  supportEmail: "",
  supportPhone: "",
  currencySymbol: "\u20B9",
  currencyCode: "INR",
  timezone: "Asia/Kolkata",
  logoUrl: "",
  faviconUrl: "",
  primaryColor: DEFAULT_PRIMARY_COLOR,
  secondaryColor: DEFAULT_SECONDARY_COLOR,
  companyName: "",
  taxId: "",
  address: "",
  aboutUsText: "",
  privacyPolicyText: "",
  termsConditionsText: "",
  refundPolicyText: "",
  deliveryPolicyText: "",
  facebook: "",
  twitter: "",
  instagram: "",
  linkedin: "",
  youtube: "",
  playStoreLink: "",
  appStoreLink: "",
  metaTitle: "",
  metaDescription: "",
  metaKeywords: "",
  keywords: [],
  returnDeliveryCommission: 0,
  deliveryPricingMode: "distance_based",
  pricingMode: "distance_based",
  customerBaseDeliveryFee: 30,
  riderBasePayout: 30,
  baseDeliveryCharge: 30,
  baseDistanceCapacityKm: 0.5,
  incrementalKmSurcharge: 10,
  deliveryPartnerRatePerKm: 5,
  fleetCommissionRatePerKm: 5,
  fixedDeliveryFee: 30,
  handlingFeeStrategy: "highest_category_fee",
  codEnabled: true,
  onlineEnabled: true,
  lowStockAlertsEnabled: true,
  posCommissionEnabled: false,
  posCouponsEnabled: false,
  productApproval: {
    sellerCreateRequiresApproval: true,
    sellerEditRequiresApproval: false,
  },
};

/**
 * "#abc" / "#AABBCC" / " aabbcc " -> "#aabbcc"; anything else -> null.
 */
export function normalizeHexColor(value) {
  const raw = String(value ?? "").trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw.split("").map((c) => c + c).join("")}`.toLowerCase();
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw}`.toLowerCase();
  return null;
}

/** Black or white, whichever reads better on the given hex background (YIQ). */
export function readableTextColor(hex) {
  const value = normalizeHexColor(hex);
  if (!value) return "#ffffff";
  const r = parseInt(value.slice(1, 3), 16);
  const g = parseInt(value.slice(3, 5), 16);
  const b = parseInt(value.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 >= 160 ? "#000000" : "#ffffff";
}

/** The brand colours to apply: admin values when valid, else the defaults. */
export function resolveThemeColors(settings = {}) {
  return {
    primary: normalizeHexColor(settings.primaryColor) || DEFAULT_PRIMARY_COLOR,
    secondary: normalizeHexColor(settings.secondaryColor) || DEFAULT_SECONDARY_COLOR,
  };
}

function setThemeProperties({ primary, secondary }) {
  const root = document.documentElement;
  // --brand-50…950 in index.css are derived from --primary, so they follow it.
  root.style.setProperty("--primary", primary);
  root.style.setProperty("--primary-color", primary);
  root.style.setProperty("--primary-foreground", readableTextColor(primary));
  root.style.setProperty("--ring", primary);
  root.style.setProperty("--secondary", secondary);
  root.style.setProperty("--secondary-color", secondary);
  root.style.setProperty("--secondary-foreground", readableTextColor(secondary));
}

/**
 * Applies the brand colours from settings to the document root.
 * `persist: false` is for live previews that must not outlive the page.
 */
export function applyThemeVariables(settings, { persist = true } = {}) {
  if (!settings || typeof document === "undefined") return;
  const colors = resolveThemeColors(settings);
  setThemeProperties(colors);
  if (persist) setJSON(STORAGE_KEYS.THEME_COLORS, colors);
}

/** Re-applies the last saved brand colours (call before the first render). */
export function applyCachedThemeColors() {
  if (typeof document === "undefined") return;
  const cached = getJSON(STORAGE_KEYS.THEME_COLORS, null);
  if (!cached) return;
  setThemeProperties(resolveThemeColors({ primaryColor: cached.primary, secondaryColor: cached.secondary }));
}

