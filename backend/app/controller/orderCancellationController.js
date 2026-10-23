import handleResponse from "../utils/helper.js";
import getPagination from "../utils/pagination.js";
import logger from "../services/logger.js";
import {
  adminCancelOrder,
  approveCancellationRequest,
  cancellationView,
  confirmParcelReturned,
  getCancellationView,
  inspectReturnedParcel,
  listRiderReturnTasks,
  listSellerCancellations,
  markUnderReview,
  rejectCancellationRequest,
  submitCustomerCancellation,
  withdrawCancellationRequest,
} from "../services/cancellation/orderCancellationService.js";
import {
  getCancellationForAdmin,
  getCancellationReports,
  listCancellationsForAdmin,
} from "../services/cancellation/cancellationQueryService.js";
import {
  resetFailedRefund,
  resolveRefundManually,
} from "../services/cancellation/cancellationRefundService.js";
import {
  getCancellationPolicy,
  updateCancellationPolicy,
} from "../services/cancellation/cancellationPolicyService.js";
import { CANCELLATION_REASONS } from "../constants/cancellation.js";
import { createFinanceAuditLog } from "../services/finance/auditLogService.js";
import { FINANCE_AUDIT_ACTION, OWNER_TYPE } from "../constants/finance.js";

function fail(res, req, error, scope) {
  const status = error.statusCode || 500;
  if (status >= 500) {
    logger.error("cancellation endpoint failed", {
      scope,
      correlationId: req.correlationId,
      error: error.message,
    });
  }
  const data = {};
  if (error.code) data.code = error.code;
  if (error.eligibility) data.eligibility = error.eligibility;
  if (error.cancellation) data.cancellation = error.cancellation;
  return handleResponse(res, status, status >= 500 ? "Something went wrong. Please try again." : error.message, data);
}

const noStore = (res) => res.set("Cache-Control", "no-store");
const userId = (req) => req.user?.id ?? req.user?._id;

/* ---------------- customer ---------------- */

export const getOrderCancellation = async (req, res) => {
  try {
    noStore(res);
    const view = await getCancellationView({ orderParam: req.params.orderId, user: { ...req.user, id: userId(req) } });
    return handleResponse(res, 200, "Cancellation details fetched", view);
  } catch (error) {
    return fail(res, req, error, "getOrderCancellation");
  }
};

export const submitOrderCancellation = async (req, res) => {
  try {
    noStore(res);
    const { mode, reasonCode, reasonText } = req.body || {};
    const { record, duplicate } = await submitCustomerCancellation({
      customerId: userId(req),
      orderParam: req.params.orderId,
      mode,
      reasonCode,
      reasonText,
      idempotencyKey: String(req.headers["idempotency-key"] || "").trim() || null,
    });
    const view = await getCancellationView({ orderParam: req.params.orderId, user: { ...req.user, id: userId(req) } });
    const message = duplicate
      ? "This request was already received"
      : record.status === "REQUESTED"
        ? "Cancellation request submitted"
        : "Order cancelled successfully";
    return handleResponse(res, duplicate ? 200 : 201, message, { ...view, duplicate });
  } catch (error) {
    return fail(res, req, error, "submitOrderCancellation");
  }
};

export const withdrawOrderCancellation = async (req, res) => {
  try {
    noStore(res);
    await withdrawCancellationRequest({ customerId: userId(req), orderParam: req.params.orderId });
    const view = await getCancellationView({ orderParam: req.params.orderId, user: { ...req.user, id: userId(req) } });
    return handleResponse(res, 200, "Cancellation request withdrawn", view);
  } catch (error) {
    return fail(res, req, error, "withdrawOrderCancellation");
  }
};

export const getPublicCancellationPolicy = async (_req, res) => {
  try {
    const policy = await getCancellationPolicy();
    return handleResponse(res, 200, "Cancellation policy", {
      reasons: CANCELLATION_REASONS,
      allowWithdrawal: policy.allowWithdrawal,
      prepaidRefundTimelineText: policy.prepaidRefundTimelineText,
    });
  } catch (error) {
    return fail(res, _req, error, "getPublicCancellationPolicy");
  }
};

/* ---------------- rider ---------------- */

export const getRiderReturnTasks = async (req, res) => {
  try {
    noStore(res);
    return handleResponse(res, 200, "Return tasks fetched", { items: await listRiderReturnTasks(userId(req)) });
  } catch (error) {
    return fail(res, req, error, "getRiderReturnTasks");
  }
};

export const confirmReturnToStore = async (req, res) => {
  try {
    const { record, duplicate } = await confirmParcelReturned({
      user: { ...req.user, id: userId(req) },
      recordId: req.params.id,
      note: req.body?.note,
    });
    return handleResponse(res, 200, duplicate ? "Return already confirmed" : "Return to store confirmed", cancellationView(record, { role: "delivery" }));
  } catch (error) {
    return fail(res, req, error, "confirmReturnToStore");
  }
};

/* ---------------- seller ---------------- */

export const getSellerCancellations = async (req, res) => {
  try {
    noStore(res);
    return handleResponse(res, 200, "Cancellations fetched", await listSellerCancellations(userId(req), { limit: req.query?.limit }));
  } catch (error) {
    return fail(res, req, error, "getSellerCancellations");
  }
};

export const submitReturnInspection = async (req, res) => {
  try {
    const role = req.user.role;
    const { record, duplicate } = await inspectReturnedParcel({
      user: { ...req.user, id: userId(req) },
      recordId: req.params.id,
      items: req.body?.items,
      note: req.body?.note,
    });
    return handleResponse(res, 200, duplicate ? "Already inspected" : "Inspection saved", cancellationView(record, { role: role === "admin" ? "admin" : "seller" }));
  } catch (error) {
    return fail(res, req, error, "submitReturnInspection");
  }
};

/* ---------------- admin ---------------- */

export const adminListCancellations = async (req, res) => {
  try {
    noStore(res);
    const pagination = getPagination(req, { defaultLimit: 25, maxLimit: 100 });
    return handleResponse(res, 200, "Cancellations fetched", await listCancellationsForAdmin(req.query || {}, pagination));
  } catch (error) {
    return fail(res, req, error, "adminListCancellations");
  }
};

export const adminGetCancellation = async (req, res) => {
  try {
    noStore(res);
    return handleResponse(res, 200, "Cancellation fetched", await getCancellationForAdmin(req.params.id));
  } catch (error) {
    return fail(res, req, error, "adminGetCancellation");
  }
};

export const adminCancellationReports = async (req, res) => {
  try {
    noStore(res);
    return handleResponse(res, 200, "Cancellation reports", await getCancellationReports(req.query || {}));
  } catch (error) {
    return fail(res, req, error, "adminCancellationReports");
  }
};

async function respondWithAdminRecord(res, recordId, message) {
  return handleResponse(res, 200, message, await getCancellationForAdmin(recordId));
}

export const adminReviewCancellation = async (req, res) => {
  try {
    await markUnderReview({ adminId: userId(req), recordId: req.params.id });
    return respondWithAdminRecord(res, req.params.id, "Request moved to review");
  } catch (error) {
    return fail(res, req, error, "adminReviewCancellation");
  }
};

export const adminApproveCancellation = async (req, res) => {
  try {
    await approveCancellationRequest({ adminId: userId(req), recordId: req.params.id, note: req.body?.note });
    return respondWithAdminRecord(res, req.params.id, "Cancellation approved");
  } catch (error) {
    return fail(res, req, error, "adminApproveCancellation");
  }
};

export const adminRejectCancellation = async (req, res) => {
  try {
    await rejectCancellationRequest({ adminId: userId(req), recordId: req.params.id, reason: req.body?.reason });
    return respondWithAdminRecord(res, req.params.id, "Cancellation request rejected");
  } catch (error) {
    return fail(res, req, error, "adminRejectCancellation");
  }
};

export const adminRetryRefund = async (req, res) => {
  try {
    await resetFailedRefund(req.params.id, { adminId: userId(req), note: req.body?.note });
    return respondWithAdminRecord(res, req.params.id, "Refund retry started");
  } catch (error) {
    return fail(res, req, error, "adminRetryRefund");
  }
};

export const adminResolveRefund = async (req, res) => {
  try {
    await resolveRefundManually(req.params.id, { adminId: userId(req), note: req.body?.note });
    return respondWithAdminRecord(res, req.params.id, "Refund marked as resolved");
  } catch (error) {
    return fail(res, req, error, "adminResolveRefund");
  }
};

export const adminConfirmReturn = async (req, res) => {
  try {
    await confirmParcelReturned({ user: { ...req.user, id: userId(req) }, recordId: req.params.id, note: req.body?.note });
    return respondWithAdminRecord(res, req.params.id, "Return to store confirmed");
  } catch (error) {
    return fail(res, req, error, "adminConfirmReturn");
  }
};

export const adminInspectReturn = async (req, res) => {
  try {
    await inspectReturnedParcel({
      user: { ...req.user, id: userId(req) },
      recordId: req.params.id,
      items: req.body?.items,
      note: req.body?.note,
    });
    return respondWithAdminRecord(res, req.params.id, "Inspection saved");
  } catch (error) {
    return fail(res, req, error, "adminInspectReturn");
  }
};

export const adminCancelOrderController = async (req, res) => {
  try {
    const { record } = await adminCancelOrder({
      adminId: userId(req),
      orderParam: req.params.orderId,
      reason: req.body?.reason,
      reasonCode: req.body?.reasonCode,
    });
    return respondWithAdminRecord(res, record._id, "Order cancelled");
  } catch (error) {
    return fail(res, req, error, "adminCancelOrder");
  }
};

export const adminGetCancellationPolicy = async (req, res) => {
  try {
    noStore(res);
    return handleResponse(res, 200, "Cancellation policy", {
      policy: await getCancellationPolicy({ fresh: true }),
      reasons: CANCELLATION_REASONS,
    });
  } catch (error) {
    return fail(res, req, error, "adminGetCancellationPolicy");
  }
};

export const adminUpdateCancellationPolicy = async (req, res) => {
  try {
    const { previous, policy } = await updateCancellationPolicy(req.body || {});
    await createFinanceAuditLog({
      action: FINANCE_AUDIT_ACTION.FINANCE_ADJUSTMENT_APPLIED,
      actorType: OWNER_TYPE.ADMIN,
      actorId: userId(req),
      metadata: { kind: "CANCELLATION_POLICY_UPDATED", previous, policy },
    }).catch(() => {});
    return handleResponse(res, 200, "Cancellation policy updated", { policy });
  } catch (error) {
    return fail(res, req, error, "adminUpdateCancellationPolicy");
  }
};
