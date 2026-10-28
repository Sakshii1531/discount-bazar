import { ORDER_SETTLEMENT_STATUS } from "../../constants/finance.js";

/**
 * An order's overall settlement from its parts: COMPLETED once the seller
 * and rider are paid and the admin earning is credited. Recomputed whenever
 * one of those parts changes (delivery settlement, payout processing).
 */
export function computeOverallSettlement(order) {
  const settlement = order.settlementStatus || {};
  const sellerDone = settlement.sellerPayout === "COMPLETED";
  const riderDone =
    settlement.riderPayout === "COMPLETED" ||
    settlement.riderPayout === "NOT_APPLICABLE";
  const adminDone = Boolean(settlement.adminEarningCredited);

  if (sellerDone && riderDone && adminDone) {
    settlement.overall = ORDER_SETTLEMENT_STATUS.COMPLETED;
    if (!settlement.reconciledAt) settlement.reconciledAt = new Date();
  } else if (sellerDone || riderDone || adminDone) {
    settlement.overall = ORDER_SETTLEMENT_STATUS.PARTIAL;
  } else {
    settlement.overall = ORDER_SETTLEMENT_STATUS.PENDING;
  }
  return settlement;
}
