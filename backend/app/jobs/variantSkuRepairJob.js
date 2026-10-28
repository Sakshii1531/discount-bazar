import { repairBlankVariantSkus } from "../services/variantSkuRepairService.js";
import logger from "../services/logger.js";

const VARIANT_SKU_REPAIR_INTERVAL_MS = parseInt(
  process.env.VARIANT_SKU_REPAIR_INTERVAL_MS || "3600000",
  10,
);

/**
 * Gives product variants saved without a SKU a generated one. Runs once when
 * the scheduler starts (fixing older products) and then hourly as a safety
 * net for writes that bypass the Product model's save hook.
 */
const repairVariantSkus = async () => {
  const startTime = Date.now();
  try {
    const { products, variants, skipped } = await repairBlankVariantSkus();
    if (variants > 0 || skipped > 0) {
      logger.info("Variant SKU repair job completed", {
        jobName: "variantSkuRepairJob",
        duration: Date.now() - startTime,
        products,
        variants,
        skipped,
      });
    }
  } catch (err) {
    logger.error("Variant SKU repair job failed", {
      jobName: "variantSkuRepairJob",
      duration: Date.now() - startTime,
      error: err.message,
    });
  }
};

export const getVariantSkuRepairJobHandler = () => repairVariantSkus;

export const getVariantSkuRepairJobInterval = () => VARIANT_SKU_REPAIR_INTERVAL_MS;

export default repairVariantSkus;
