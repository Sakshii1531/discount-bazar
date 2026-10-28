/**
 * Gives product variants saved without a SKU a generated one.
 *
 * The scheduler's variantSkuRepairJob does this automatically on start and
 * then hourly; this script runs the same repair by hand, e.g. to preview it.
 * Stock, purchase bills and POS lines find a variant by its SKU, so a sale of
 * a variant without one cannot reduce its stock.
 *
 * Usage:
 *   node scripts/backfill-variant-skus.js           # dry run: list what would change
 *   node scripts/backfill-variant-skus.js --apply   # write the fixes
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { repairBlankVariantSkus } from "../app/services/variantSkuRepairService.js";

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017/turbocart";
const APPLY = process.argv.includes("--apply");

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected. Mode: ${APPLY ? "APPLY" : "DRY RUN (pass --apply to write)"}`);

  const { products, variants, skipped } = await repairBlankVariantSkus({
    apply: APPLY,
    onVariant: ({ product, variant, sku }) =>
      console.log(`  ${product.name} (${product._id}): variant "${variant.name || variant._id}" -> ${sku}`),
  });

  console.log(`${variants} variant(s) on ${products} product(s) ${APPLY ? "given a SKU" : "need a SKU"}.`);
  if (skipped) console.warn(`${skipped} variant(s) have no _id and were skipped; re-save those products instead.`);
}

run()
  .then(() => mongoose.disconnect().then(() => process.exit(0)))
  .catch((error) => {
    console.error("Variant SKU backfill failed:", error);
    process.exit(1);
  });
