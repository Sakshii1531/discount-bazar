// Customer-facing labels for product variants. Sellers use a variant's `name`
// (e.g. "W180") as an internal identifier for POS, purchase bills and stock,
// so customers are shown the variant's own attributes instead — size (weight,
// volume, pack size…) first, then colour — and the name only when the seller
// filled in neither. Display only: cart keys and orders still use the SKU.

// Variant attribute fields, in the order they are shown.
const VARIANT_ATTRIBUTES = ["size", "colour"];

const clean = (value) => String(value ?? "").trim();
const norm = (value) => clean(value).toLowerCase();

const attributeValues = (variant) =>
  VARIANT_ATTRIBUTES.map((attr) => [attr, clean(variant?.[attr])]).filter(([, v]) => v);

// Attributes whose values differ between the product's variants — the ones a
// customer actually chooses between (all-red T-shirts don't need "Red" on
// every chip).
const varyingAttributes = (variants) =>
  VARIANT_ATTRIBUTES.filter(
    (attr) => new Set(variants.map((v) => norm(v?.[attr]))).size > 1,
  );

function baseLabel(variant, variants, product) {
  const present = attributeValues(variant);
  if (present.length > 0) {
    const varying = varyingAttributes(variants);
    const distinguishing = present.filter(([attr]) => varying.includes(attr));
    return (distinguishing.length > 0 ? distinguishing : present).map(([, v]) => v).join(" · ");
  }
  // A lone variant with no attributes is the product itself: its pack
  // weight says more to a customer than an internal variant name.
  if (variants.length <= 1 && clean(product?.weight)) return clean(product.weight);
  return clean(variant?.name);
}

/**
 * Label for one variant of `product` ("250g", "M · Red", …). Returns "" when
 * nothing customer-readable is known; callers then show the product's weight
 * or nothing.
 */
export function getVariantLabel(variant, product) {
  if (!variant) return "";
  const variants = Array.isArray(product?.variants) && product.variants.length > 0
    ? product.variants
    : [variant];
  const label = baseLabel(variant, variants, product);
  if (!label) return "";

  // Two variants with the same attributes (e.g. two grades both "250g") would
  // render identical chips — tell them apart with the seller's variant name.
  const clashes = variants.filter((v) => norm(baseLabel(v, variants, product)) === norm(label)).length > 1;
  const name = clean(variant?.name);
  if (clashes && name && norm(name) !== norm(label)) return `${label} · ${name}`;
  return label;
}

/** Find a product's variant by the cart/order key (SKU, or name for legacy rows). */
export function findVariantByKey(product, key) {
  const k = clean(key);
  const variants = Array.isArray(product?.variants) ? product.variants : [];
  if (!k || variants.length === 0) return null;
  return (
    variants.find((v) => clean(v?.sku) === k) ||
    variants.find((v) => clean(v?._id) === k) ||
    variants.find((v) => clean(v?.name) === k) ||
    null
  );
}

/**
 * Label for a cart line. Cart items carry the product's fields (incl.
 * `variants`) plus the chosen `variantSku`; older guest carts saved in the
 * browser may only have `variantLabel`/`variantName`.
 */
export function getCartItemVariantLabel(item) {
  const variant = findVariantByKey(item, item?.variantSku);
  if (variant) return getVariantLabel(variant, item);
  return clean(item?.variantLabel) || clean(item?.variantName) || clean(item?.weight);
}
