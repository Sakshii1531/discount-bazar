import express from "express";
import {
  getConfig,
  getOrderCommunication,
  listMessages,
  sendMessage,
  updateReceipts,
  getContact,
  reportIssue,
  markReadyForPickup,
  setReadyEta,
  adminListEvents,
  adminListIssues,
  adminUpdateIssue,
  adminGetConversations,
} from "../controller/communicationController.js";
import {
  verifyToken,
  allowRoles,
  requireApprovedSeller,
} from "../middleware/authMiddleware.js";
import { createRateLimiter, byUserOrIp } from "../middleware/rateLimiter.js";
import { communicationEnvDefaults } from "../constants/orderCommunication.js";

const router = express.Router();
const PARTIES = ["customer", "user", "seller", "delivery"];
const party = [verifyToken, allowRoles(...PARTIES), requireApprovedSeller];
const defaults = communicationEnvDefaults();

const sendLimiter = createRateLimiter({
  namespace: "order-chat-send",
  windowMs: 60 * 1000,
  max: defaults.sendRateLimitPerMinute,
  keyGenerator: byUserOrIp,
  message: "You are sending messages too quickly. Please wait a moment.",
});
const contactLimiter = createRateLimiter({
  namespace: "order-contact",
  windowMs: 60 * 1000,
  max: defaults.contactRateLimitPerMinute,
  keyGenerator: byUserOrIp,
});
const issueLimiter = createRateLimiter({
  namespace: "order-comm-issue",
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyGenerator: byUserOrIp,
});

router.get("/config", verifyToken, getConfig);

// Admin / operations (role-gated; conversation reads are audit-logged)
router.get("/admin/events", verifyToken, allowRoles("admin"), adminListEvents);
router.get("/admin/issues", verifyToken, allowRoles("admin"), adminListIssues);
router.patch("/admin/issues/:issueId", verifyToken, allowRoles("admin"), adminUpdateIssue);
router.get(
  "/admin/orders/:orderId/conversations",
  verifyToken,
  allowRoles("admin"),
  adminGetConversations,
);

// Order parties
router.get("/orders/:orderId", ...party, getOrderCommunication);
router.get("/orders/:orderId/chats/:channel/messages", ...party, listMessages);
router.post("/orders/:orderId/chats/:channel/messages", ...party, sendLimiter, sendMessage);
router.post("/orders/:orderId/chats/:channel/receipts", ...party, updateReceipts);
router.post("/orders/:orderId/chats/:channel/contact", ...party, contactLimiter, getContact);
router.post("/orders/:orderId/issues", ...party, issueLimiter, reportIssue);
router.post(
  "/orders/:orderId/ready-for-pickup",
  verifyToken,
  allowRoles("seller"),
  requireApprovedSeller,
  markReadyForPickup,
);
router.post(
  "/orders/:orderId/ready-eta",
  verifyToken,
  allowRoles("seller"),
  requireApprovedSeller,
  setReadyEta,
);

export default router;
