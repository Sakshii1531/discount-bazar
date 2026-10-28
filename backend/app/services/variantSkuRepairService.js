import Product from "../models/product.js";
import { isBlankSku, makeProductSku } from "../utils/sku.js";

// A variant whose SKU is missing, null or only spaces.
const BLANK_SKU = { $or: [{ sku: { $exists: false } }, { sku: null }, { sku: { $regex: /^\s*$/ } }] };

/**
 * Gives every variant saved without a SKU a generated one. Products saved
 * before variant SKUs were generated (or written straight to the database)
 * can have them; a sale of such a variant cannot reduce its stock.
 *
 * Safe to run on several instances at once: each write targets a variant by
 * _id and only while its SKU is still blank, so a SKU is never overwritten.
 *
 * @param {{ apply?: boolean, onVariant?: Function }} options
 *   apply: false lists what would change without writing (default true).
 *   onVariant({ product, variant, sku }): called for each variant found.
 * @returns {Promise<{ products: number, variants: number, skipped: number }>}
 */
export async function repairBlankVariantSkus({ apply = true, onVariant = null } = {}) {
  const cursor = Product.find({ variants: { $elemMatch: BLANK_SKU } })
    .select("name variants._id variants.sku variants.name")
    .lean()
    .cursor();
  let products = 0;
  let variants = 0;
  let skipped = 0;

  for await (const product of cursor) {
    const list = product.variants || [];
    const taken = new Set(list.filter((v) => !isBlankSku(v.sku)).map((v) => String(v.sku).trim().toUpperCase()));
    const set = {};
    const arrayFilters = [];
    list.forEach((variant, i) => {
      if (!isBlankSku(variant.sku)) return;
      if (!variant._id) {
        skipped += 1;
        return;
      }
      const sku = makeProductSku(product.name, taken);
      onVariant?.({ product, variant, sku });
      set[`variants.$[v${i}].sku`] = sku;
      arrayFilters.push({ [`v${i}._id`]: variant._id, ...prefixed(`v${i}`, BLANK_SKU) });
    });
    if (!arrayFilters.length) continue;
    products += 1;
    variants += arrayFilters.length;
    if (apply) {
      // Raw driver call: Mongoose's casting rewrites the $or inside arrayFilters.
      await Product.collection.updateOne({ _id: product._id }, { $set: set }, { arrayFilters });
    }
  }

  return { products, variants, skipped };
}

// { $or: [{ sku: … }] } -> { $or: [{ "v0.sku": … }] } for an arrayFilters entry.
function prefixed(name, filter) {
  return { $or: filter.$or.map((clause) => ({ [`${name}.sku`]: clause.sku })) };
}
