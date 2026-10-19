import handleResponse from "../utils/helper.js";
import communication from "../services/communication/communicationService.js";
import {
  getCommunicationConfig,
  publicCommunicationConfig,
} from "../services/communication/communicationConfig.js";
import logger from "../services/logger.js";

/**
 * Thin HTTP wrappers. All authorization lives in communicationService so the
 * same checks apply to REST, sockets and the notification worker.
 */
function fail(res, error, scope) {
  const status = error.statusCode || 500;
  if (status >= 500) {
    logger.error("Communication request failed", { scope, message: error.message });
  }
  return handleResponse(res, status, status >= 500 ? "Something went wrong" : error.message, {
    code: error.code || (status >= 500 ? "SERVER_ERROR" : "REQUEST_FAILED"),
    ...(error.access ? { access: error.access } : {}),
  });
}

export const getConfig = async (req, res) => {
  try {
    const config = await getCommunicationConfig();
    return handleResponse(res, 200, "Communication config", publicCommunicationConfig(config));
  } catch (error) {
    return fail(res, error, "getConfig");
  }
};

export const getOrderCommunication = async (req, res) => {
  try {
    const state = await communication.getCommunicationState(req.user, req.params.orderId);
    res.setHeader("Cache-Control", "no-store");
    return handleResponse(res, 200, "Communication state", state);
  } catch (error) {
    return fail(res, error, "getOrderCommunication");
  }
};

export const listMessages = async (req, res) => {
  try {
    const result = await communication.listMessages(
      req.user,
      req.params.orderId,
      req.params.channel,
      req.query,
    );
    res.setHeader("Cache-Control", "no-store");
    return handleResponse(res, 200, "Messages", result);
  } catch (error) {
    return fail(res, error, "listMessages");
  }
};

export const sendMessage = async (req, res) => {
  try {
    const result = await communication.sendMessage(
      req.user,
      req.params.orderId,
      req.params.channel,
      req.body || {},
    );
    // 200 for an idempotent replay, 201 for a newly stored message.
    return handleResponse(res, result.duplicate ? 200 : 201, "Message stored", result);
  } catch (error) {
    return fail(res, error, "sendMessage");
  }
};

export const updateReceipts = async (req, res) => {
  try {
    const result = await communication.updateReceipts(
      req.user,
      req.params.orderId,
      req.params.channel,
      req.body || {},
    );
    return handleResponse(res, 200, "Receipts updated", result);
  } catch (error) {
    return fail(res, error, "updateReceipts");
  }
};

export const getContact = async (req, res) => {
  try {
    const result = await communication.getContactForCall(
      req.user,
      req.params.orderId,
      req.params.channel,
    );
    res.setHeader("Cache-Control", "no-store");
    return handleResponse(res, 200, "Contact", result);
  } catch (error) {
    return fail(res, error, "getContact");
  }
};

export const reportIssue = async (req, res) => {
  try {
    const result = await communication.reportIssue(req.user, req.params.orderId, req.body || {});
    return handleResponse(res, result.duplicate ? 200 : 201, "Issue reported", result);
  } catch (error) {
    return fail(res, error, "reportIssue");
  }
};

export const markReadyForPickup = async (req, res) => {
  try {
    const result = await communication.sellerMarkReady(req.user, req.params.orderId);
    return handleResponse(
      res,
      200,
      result.alreadyReady ? "Order was already marked ready" : "Order marked ready for pickup",
      result,
    );
  } catch (error) {
    return fail(res, error, "markReadyForPickup");
  }
};

export const setReadyEta = async (req, res) => {
  try {
    const result = await communication.sellerSetReadyEta(req.user, req.params.orderId, req.body || {});
    return handleResponse(res, 200, "Estimated ready time recorded", result);
  } catch (error) {
    return fail(res, error, "setReadyEta");
  }
};

export const adminListEvents = async (req, res) => {
  try {
    return handleResponse(res, 200, "Communication events", await communication.adminListEvents(req.query));
  } catch (error) {
    return fail(res, error, "adminListEvents");
  }
};

export const adminListIssues = async (req, res) => {
  try {
    return handleResponse(res, 200, "Communication issues", await communication.adminListIssues(req.query));
  } catch (error) {
    return fail(res, error, "adminListIssues");
  }
};

export const adminUpdateIssue = async (req, res) => {
  try {
    const issue = await communication.adminUpdateIssue(req.user, req.params.issueId, req.body || {});
    return handleResponse(res, 200, "Issue updated", issue);
  } catch (error) {
    return fail(res, error, "adminUpdateIssue");
  }
};

export const adminGetConversations = async (req, res) => {
  try {
    const result = await communication.adminGetConversations(req.user, req.params.orderId);
    res.setHeader("Cache-Control", "no-store");
    return handleResponse(res, 200, "Conversations", result);
  } catch (error) {
    return fail(res, error, "adminGetConversations");
  }
};
