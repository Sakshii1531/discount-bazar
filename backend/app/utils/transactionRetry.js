/**
 * MongoDB marks some transaction failures as safe to retry from the start
 * (write conflicts, "catalog changes" right after an index build, primary
 * step-downs). `session.withTransaction` retries these itself; services that
 * drive the transaction by hand use these helpers to do the same.
 */
const TRANSIENT_CODES = new Set([
  112, // WriteConflict
  246, // SnapshotUnavailable ("due to catalog changes; please retry")
]);

export const MAX_TRANSACTION_ATTEMPTS = 3;

export function isTransientTransactionError(error) {
  if (!error) return false;
  if (typeof error.hasErrorLabel === "function" && error.hasErrorLabel("TransientTransactionError")) return true;
  if (Array.isArray(error.errorLabels) && error.errorLabels.includes("TransientTransactionError")) return true;
  return TRANSIENT_CODES.has(Number(error.code));
}

/** Short, growing pause between attempts so a conflicting writer can finish. */
export function transactionRetryDelay(attempt) {
  return new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
}

/** After the last attempt: a retryable 503 (not a cached 500) for the client. */
export function asRetryLaterError(error) {
  error.statusCode = 503;
  error.message = "The store is busy right now. Please try again.";
  return error;
}
