import { reconcilePendingCancellations } from "../services/cancellation/orderCancellationService.js";
import logger from "../services/logger.js";

const DEFAULT_INTERVAL_MS = 60000;

/**
 * Finishes cancellation follow-ups that did not complete in the request:
 * refunds waiting on the gateway or on payment confirmation, settlement
 * adjustments, and notifications that failed to send. Each record carries
 * its own back-off (`processing.nextRetryAt`), so this sweep stays cheap.
 */
const runCancellationReconcile = async () => {
  try {
    const { processed } = await reconcilePendingCancellations({ limit: 50 });
    if (processed > 0) {
      logger.info("Cancellation reconcile job completed", { jobName: "cancellationReconcileJob", processed });
    }
  } catch (error) {
    logger.error("Cancellation reconcile job failed", {
      jobName: "cancellationReconcileJob",
      error: error.message,
    });
  }
};

export const getCancellationReconcileJobHandler = () => runCancellationReconcile;

export const getCancellationReconcileJobInterval = () =>
  parseInt(process.env.CANCELLATION_RECONCILE_INTERVAL_MS || `${DEFAULT_INTERVAL_MS}`, 10);
