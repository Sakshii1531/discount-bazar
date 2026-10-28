/**
 * The size/variant text shown for a POS line, on the product card and in the
 * cart, so both read the same. Placeholder names ("Default", the product's own
 * name) give way to size/colour. Product-level weight/size/colour only
 * describe a product with a single variant; for several variants the
 * variant's own name or SKU is kept so the cart lines stay distinguishable.
 */
const PLACEHOLDER_NAMES = new Set(["default", "regular", "standard"]);

const text = (v) => (typeof v === "string" ? v.trim() : "");
const sizeColour = (o) => [text(o?.size), text(o?.colour)].filter(Boolean).join(" · ");

export function posVariantLabel(product, variant) {
    const variantName = text(variant?.name);
    const lower = variantName.toLowerCase();
    const isPlaceholder = PLACEHOLDER_NAMES.has(lower) || lower === text(product?.name).toLowerCase();
    if (variantName && !isPlaceholder) return variantName;

    const own = sizeColour(variant);
    if (own) return own;

    const variantCount = Array.isArray(product?.variants) ? product.variants.length : 0;
    if (variantCount <= 1) {
        const productLabel = text(product?.weight) || sizeColour(product);
        if (productLabel) return productLabel;
        return variantName;
    }
    return variantName || text(variant?.sku);
}
