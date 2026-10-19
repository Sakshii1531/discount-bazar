import { escalateStalePickupIssues } from "../services/communication/communicationService.js";
import logger from "../services/logger.js";

const COMMUNICATION_ESCALATION_INTERVAL_MS = parseInt(
  process.env.COMMUNICATION_ESCALATION_INTERVAL_MS || "60000",
  10,
);

/**
 * Escalates pickup-delay issues ("Order not ready", "Shop closed", …) that
 * stay open past the configured threshold to operations. It only notifies —
 * it never changes order status or penalizes the seller or rider.
 */
const escalatePickupDelays = async () => {
  const startTime = Date.now();
  try {
    const { escalated } = await escalateStalePickupIssues();
    if (escalated > 0) {
      logger.info("Communication escalation job completed", {
        jobName: "communicationEscalationJob",
        duration: Date.now() - startTime,
        escalated,
      });
    }
  } catch (err) {
    logger.error("Communication escalation job failed", {
      jobName: "communicationEscalationJob",
      duration: Date.now() - startTime,
      error: err.message,
    });
  }
};

export const getCommunicationEscalationJobHandler = () => escalatePickupDelays;

export const getCommunicationEscalationJobInterval = () => COMMUNICATION_ESCALATION_INTERVAL_MS;

export default escalatePickupDelays;
