// Display helpers for product prices. They follow the same rule as
// CartContext.resolveVariantPricing and the existing product pages: `price` is
// the list price (shown struck through) and `salePrice` is the selling price
// when it is set and lower. The backend recalculates everything at cart and
// checkout time, so these are for display only.

const toNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

export function getDisplayPricing(source) {
  const listPrice = toNumber(source?.price);
  const salePrice = toNumber(source?.salePrice);
  const hasDiscount = salePrice > 0 && listPrice > 0 && salePrice < listPrice;
  const sellingPrice = hasDiscount ? salePrice : listPrice;
  return {
    sellingPrice,
    listPrice: hasDiscount ? listPrice : null,
    savings: hasDiscount ? listPrice - salePrice : 0,
    discountPercent: hasDiscount ? Math.round(((listPrice - salePrice) / listPrice) * 100) : 0,
  };
}

const UNIT_ALIASES = {
  g: ["g", "gm", "gms", "gram", "grams", "gr"],
  kg: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"],
  ml: ["ml", "mls", "millilitre", "millilitres", "milliliter", "milliliters"],
  l: ["l", "ltr", "ltrs", "litre", "litres", "liter", "liters"],
  pc: ["pc", "pcs", "piece", "pieces", "unit", "units", "n"],
};
const UNIT_LOOKUP = Object.fromEntries(
  Object.entries(UNIT_ALIASES).flatMap(([unit, aliases]) => aliases.map((a) => [a, unit])),
);

/**
 * Reads a pack size such as "1 L", "500g", "2 x 200 ml" or "6 pcs" from the
 * product's weight / variant name. Returns null for anything it can't read
 * with certainty — no guessing.
 */
export function parsePackSize(label) {
  const text = String(label || "").trim().toLowerCase();
  const match = text.match(/^(?:(\d+)\s*[x×*]\s*)?(\d+(?:\.\d+)?)\s*([a-z]+)\.?$/);
  if (!match) return null;
  const count = match[1] ? Number(match[1]) : 1;
  const amount = Number(match[2]) * count;
  const unit = UNIT_LOOKUP[match[3]];
  if (!unit || !(amount > 0)) return null;
  if (unit === "kg") return { amount: amount * 1000, base: "g" };
  if (unit === "l") return { amount: amount * 1000, base: "ml" };
  return { amount, base: unit };
}

/** "₹18.50/100 ml" style label, or "" when the pack size is unknown. */
export function getUnitPriceLabel(sellingPrice, packLabel, symbol = "₹") {
  const price = toNumber(sellingPrice);
  const pack = parsePackSize(packLabel);
  if (!pack || !(price > 0)) return "";
  if (pack.base === "pc") {
    if (pack.amount <= 1) return "";
    return `${symbol}${(price / pack.amount).toFixed(2)}/pc`;
  }
  const per = pack.amount >= 1000 ? 1000 : 100;
  const unit = per === 1000 ? (pack.base === "g" ? "kg" : "L") : `${per} ${pack.base}`;
  return `${symbol}${((price / pack.amount) * per).toFixed(2)}/${unit}`;
}

/**
 * Shape an API product for ProductCard — the same shape the home and category
 * pages build (`price` = selling price, `originalPrice` = list price).
 */
export function toCardProduct(p) {
  const { sellingPrice } = getDisplayPricing(p);
  return {
    ...p,
    id: p._id || p.id,
    image: p.mainImage || p.image || "",
    price: sellingPrice,
    originalPrice: Number(p.price) || sellingPrice,
    deliveryTime: p.deliveryTime || null,
  };
}
