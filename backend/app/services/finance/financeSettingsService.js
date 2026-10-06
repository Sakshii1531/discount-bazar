import Setting from "../../models/setting.js";
import {
  DELIVERY_PRICING_MODE,
  HANDLING_FEE_STRATEGY,
} from "../../constants/finance.js";
import { roundCurrency } from "../../utils/money.js";

const DEFAULT_FINANCE_SETTINGS = {
  deliveryPricingMode: DELIVERY_PRICING_MODE.DISTANCE_BASED,
  customerBaseDeliveryFee: 30,
  riderBasePayout: 30,
  baseDistanceCapacityKm: 0.5,
  incrementalKmSurcharge: 10,
  deliveryPartnerRatePerKm: 5,
  fixedDeliveryFee: 30,
  globalDeliveryTimeMinutes: 15,
  zeroDeliveryTimeMessage: "Instant Delivery",
  handlingFeeStrategy: HANDLING_FEE_STRATEGY.HIGHEST_CATEGORY_FEE,
  globalTaxRate: 0,
  codEnabled: true,
  onlineEnabled: true,
  returnDeliveryCommission: 0,
};

export function normalizeFinanceSettings(raw = {}) {
  const deliveryPricingMode =
    raw.deliveryPricingMode ||
    raw.pricingMode ||
    DEFAULT_FINANCE_SETTINGS.deliveryPricingMode;

  const customerBaseDeliveryFee = roundCurrency(
    raw.customerBaseDeliveryFee ?? raw.baseDeliveryCharge ?? DEFAULT_FINANCE_SETTINGS.customerBaseDeliveryFee,
  );

  const riderBasePayout = roundCurrency(
    raw.riderBasePayout ?? raw.baseDeliveryCharge ?? DEFAULT_FINANCE_SETTINGS.riderBasePayout,
  );

  const deliveryPartnerRatePerKm = roundCurrency(
    raw.deliveryPartnerRatePerKm ??
      raw.fleetCommissionRatePerKm ??
      DEFAULT_FINANCE_SETTINGS.deliveryPartnerRatePerKm,
  );

  const baseDistanceCapacityKm = Number(
    raw.baseDistanceCapacityKm ?? DEFAULT_FINANCE_SETTINGS.baseDistanceCapacityKm,
  );

  const incrementalKmSurcharge = roundCurrency(
    raw.incrementalKmSurcharge ?? DEFAULT_FINANCE_SETTINGS.incrementalKmSurcharge,
  );

  const fixedDeliveryFee = roundCurrency(
    raw.fixedDeliveryFee ?? raw.baseDeliveryCharge ?? customerBaseDeliveryFee,
  );

  const rawMinutes = Number(raw.globalDeliveryTimeMinutes ?? DEFAULT_FINANCE_SETTINGS.globalDeliveryTimeMinutes);
  const globalDeliveryTimeMinutes =
    Number.isFinite(rawMinutes) && rawMinutes > 0 ? Math.round(rawMinutes) : 0;
  const zeroDeliveryTimeMessage =
    String(raw.zeroDeliveryTimeMessage ?? "").trim() || DEFAULT_FINANCE_SETTINGS.zeroDeliveryTimeMessage;

  const handlingFeeStrategy =
    raw.handlingFeeStrategy || DEFAULT_FINANCE_SETTINGS.handlingFeeStrategy;

  const returnDeliveryCommission = roundCurrency(
    raw.returnDeliveryCommission ?? DEFAULT_FINANCE_SETTINGS.returnDeliveryCommission,
  );

  return {
    deliveryPricingMode,
    pricingMode: deliveryPricingMode,
    customerBaseDeliveryFee,
    riderBasePayout,
    baseDeliveryCharge: customerBaseDeliveryFee,
    baseDistanceCapacityKm: Number.isFinite(baseDistanceCapacityKm)
      ? Math.max(baseDistanceCapacityKm, 0)
      : DEFAULT_FINANCE_SETTINGS.baseDistanceCapacityKm,
    incrementalKmSurcharge,
    deliveryPartnerRatePerKm,
    fleetCommissionRatePerKm: deliveryPartnerRatePerKm,
    fixedDeliveryFee,
    globalDeliveryTimeMinutes,
    zeroDeliveryTimeMessage,
    handlingFeeStrategy,
    globalTaxRate: Number.isFinite(Number(raw.globalTaxRate)) ? Math.max(Number(raw.globalTaxRate), 0) : 0,
    codEnabled: raw.codEnabled ?? DEFAULT_FINANCE_SETTINGS.codEnabled,
    onlineEnabled: raw.onlineEnabled ?? DEFAULT_FINANCE_SETTINGS.onlineEnabled,
    returnDeliveryCommission,
  };
}

export async function getOrCreateFinanceSettings({ session } = {}) {
  const query = {};
  const options = session ? { session } : {};
  let settings = await Setting.findOne(query, null, options);

  if (!settings) {
    // Array form is required for Model.create() to honour the session option;
    // otherwise the insert silently runs outside the caller's transaction.
    [settings] = await Setting.create(
      [
        {
          ...DEFAULT_FINANCE_SETTINGS,
          pricingMode: DEFAULT_FINANCE_SETTINGS.deliveryPricingMode,
          baseDeliveryCharge: DEFAULT_FINANCE_SETTINGS.customerBaseDeliveryFee,
          fleetCommissionRatePerKm: DEFAULT_FINANCE_SETTINGS.deliveryPartnerRatePerKm,
        },
      ],
      options,
    );
  }

  return normalizeFinanceSettings(settings.toObject?.() || settings);
}

export async function updateDeliveryFinanceSettings(payload, { session } = {}) {
  const query = {};
  const options = { upsert: true, new: true };
  if (session) options.session = session;
  // Merge with what is stored so fields left out of a partial update keep their value.
  const current = await Setting.findOne(query, null, session ? { session } : {}).lean();
  const incoming = { ...(payload || {}) };
  // Legacy alias keys in the request take priority over the stored canonical keys.
  if (incoming.pricingMode != null && incoming.deliveryPricingMode == null) {
    incoming.deliveryPricingMode = incoming.pricingMode;
  }
  if (incoming.baseDeliveryCharge != null && incoming.customerBaseDeliveryFee == null) {
    incoming.customerBaseDeliveryFee = incoming.baseDeliveryCharge;
  }
  if (incoming.fleetCommissionRatePerKm != null && incoming.deliveryPartnerRatePerKm == null) {
    incoming.deliveryPartnerRatePerKm = incoming.fleetCommissionRatePerKm;
  }
  const normalized = normalizeFinanceSettings({ ...(current || {}), ...incoming });

  const updated = await Setting.findOneAndUpdate(query, { $set: normalized }, options);
  return normalizeFinanceSettings(updated.toObject?.() || updated);
}

export { DEFAULT_FINANCE_SETTINGS };
