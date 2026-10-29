/**
 * Moves reviews written by the old product-page form (Review collection) into
 * order-item ratings (ProductRating), so they show on the product page and
 * count in its rating. Reviews without a delivered purchase are skipped.
 * Safe to run more than once.
 *
 * Usage:
 *   node scripts/migrate-legacy-reviews.js           # dry run: list what would change
 *   node scripts/migrate-legacy-reviews.js --apply   # write the ratings
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import { migrateLegacyReviews } from "../app/services/legacyReviewMigrationService.js";

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017/turbocart";
const APPLY = process.argv.includes("--apply");

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected. Mode: ${APPLY ? "APPLY" : "DRY RUN (pass --apply to write)"}`);

  const { total, migrated, skipped } = await migrateLegacyReviews({
    apply: APPLY,
    onReview: ({ review, target }) =>
      console.log(
        `  review ${review._id} (product ${review.productId}): ${
          target ? `-> order ${target.order.orderId || target.order._id}` : "no delivered purchase, skipped"
        }`,
      ),
  });

  console.log(`${total} legacy review(s): ${migrated} ${APPLY ? "migrated" : "to migrate"}, ${skipped} skipped.`);
}

run()
  .then(() => mongoose.disconnect().then(() => process.exit(0)))
  .catch((error) => {
    console.error("Legacy review migration failed:", error);
    process.exit(1);
  });
