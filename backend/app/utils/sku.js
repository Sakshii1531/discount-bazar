/**
 * Product / variant SKU generation shared by product saves, the Product
 * model's save hook and the blank-SKU repair job.
 */

/**
 * Last 4 chars of the current timestamp in base-36 + 2 random base-36 chars,
 * e.g. "K3X9AB".
 */
export function dynamicSuffix() {
  return (Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 4)).toUpperCase();
}

/**
 * A SKU for a product name: <UP-TO-5-CHAR-NAME-PREFIX>-<6-CHAR-SUFFIX>,
 * e.g. "RICE-K3X9AB". Pass `taken` (upper-case SKUs) to avoid repeats within
 * one product; it is updated with the returned SKU.
 */
export function makeProductSku(name, taken = null) {
  const prefix = String(name || "")
    .trim()
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 5)
    .toUpperCase() || "ITEM";
  for (;;) {
    const sku = `${prefix}-${dynamicSuffix()}`;
    if (!taken || !taken.has(sku)) {
      taken?.add(sku);
      return sku;
    }
  }
}

export const isBlankSku = (sku) => !String(sku ?? "").trim();

/**
 * Trims / upper-cases each variant's SKU and generates one for every blank
 * variant, unique within the product. Returns the same array (mutated).
 */
export function fillBlankVariantSkus(variants, productName) {
  if (!Array.isArray(variants)) return variants;
  const taken = new Set(
    variants.filter((v) => v && !isBlankSku(v.sku)).map((v) => String(v.sku).trim().toUpperCase()),
  );
  for (const variant of variants) {
    if (!variant) continue;
    variant.sku = isBlankSku(variant.sku)
      ? makeProductSku(productName, taken)
      : String(variant.sku).trim().toUpperCase();
  }
  return variants;
}
