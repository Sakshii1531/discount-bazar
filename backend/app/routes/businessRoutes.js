import express from "express";
import Joi from "joi";
import Supplier from "../models/supplier.js";
import PosCustomer from "../models/posCustomer.js";
import Expense from "../models/expense.js";
import handleResponse from "../utils/helper.js";
import { verifyToken, allowRoles, requireApprovedSeller } from "../middleware/authMiddleware.js";
import { validate } from "../middleware/validate.js";
import * as svc from "../services/businessService.js";
import { runReport, dashboard, dayBook, REPORT_TYPES, accountTransactions, ACCOUNT_VIEWS } from "../services/businessReportService.js";
import { getSellerTz, todayKey, dayStart, dayEnd } from "../services/businessTime.js";

const router = express.Router();
router.use(verifyToken, allowRoles("seller"), requireApprovedSeller);

const wrap = (fn) => async (req, res) => {
  try {
    const { message = "OK", data = {}, status = 200 } = await fn(req);
    return handleResponse(res, status, message, data);
  } catch (e) {
    return handleResponse(res, e.statusCode || 500, e.message);
  }
};

const str = Joi.string().trim();
const id = str.hex().length(24);
const method = str.valid("CASH", "CARD", "UPI", "OTHER");
const date = Joi.date().iso();

const partySchema = Joi.object({
  name: str.max(120).required(),
  phone: str.max(20).allow(""),
  address: str.max(300).allow(""),
  gstin: str.max(20).allow(""),
});
const lineItems = Joi.array().min(1).items(Joi.object({
  productId: id.required(),
  variantSku: str.max(80).allow(""),
  quantity: Joi.number().integer().min(1).required(),
  cost: Joi.number().min(0).required(),
  gstPercent: Joi.number().min(0).max(100).default(0),
  purchaseGstType: str.valid("INCLUSIVE", "EXCLUSIVE").default("EXCLUSIVE"),
})).required();
const billSchema = Joi.object({
  supplierId: id.required(),
  billNo: str.max(60).required(),
  billDate: date,
  items: lineItems,
  amountPaid: Joi.number().min(0).default(0),
  paymentMethod: method,
  note: str.max(300).allow(""),
  confirm: Joi.boolean().default(false),
});
const returnSchema = Joi.object({
  supplierId: id.required(),
  purchaseBillId: id,
  date,
  items: lineItems,
  reason: str.max(300).allow(""),
});
const paymentSchema = Joi.object({
  partyType: str.valid("CUSTOMER", "SUPPLIER").required(),
  partyId: id.required(),
  amount: Joi.number().greater(0).required(),
  method,
  note: str.max(200).allow(""),
  date,
});
const expenseSchema = Joi.object({
  category: str.max(60),
  amount: Joi.number().greater(0).required(),
  method,
  note: str.max(200).allow(""),
  date,
});
const cashSchema = Joi.object({
  direction: str.valid("IN", "OUT").required(),
  amount: Joi.number().greater(0).required(),
  note: str.max(200).allow(""),
  date,
});
const openingSchema = Joi.object({
  dateKey: str.pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  openingCash: Joi.number().min(0).required(),
  countedClosingCash: Joi.number().min(0),
});

const sid = (req) => req.user.id;

/* parties */
for (const [path, Model, type] of [["suppliers", Supplier, "SUPPLIER"], ["customers", PosCustomer, "CUSTOMER"]]) {
  router.get(`/${path}`, wrap(async (req) => ({ data: await svc.listParties(sid(req), type) })));
  router.post(`/${path}`, validate(partySchema), wrap(async (req) => ({ status: 201, data: await svc.saveParty(Model, sid(req), null, req.body) })));
  router.put(`/${path}/:id`, validate(partySchema), wrap(async (req) => ({ data: await svc.saveParty(Model, sid(req), req.params.id, req.body) })));
  router.get(`/${path}/:id/ledger`, wrap(async (req) => ({ data: await svc.partyLedger(sid(req), type, req.params.id) })));
}
router.post("/payments", validate(paymentSchema), wrap(async (req) => ({ status: 201, message: "Payment recorded", data: await svc.recordPayment(sid(req), req.body) })));

/* purchases */
const parseRange = (q, tz) => ({
  from: q.from ? dayStart(q.from, tz) : undefined,
  to: q.to ? dayEnd(q.to, tz) : undefined,
  supplierId: q.supplierId,
});
router.get("/purchases", wrap(async (req) => ({ data: await svc.listPurchaseBills(sid(req), parseRange(req.query, await getSellerTz(sid(req)))) })));
router.post("/purchases", validate(billSchema), wrap(async (req) => ({ status: 201, message: "Purchase bill saved", data: await svc.createPurchaseBill(sid(req), req.body) })));
router.put("/purchases/:id", validate(billSchema), wrap(async (req) => ({ message: "Purchase bill updated", data: await svc.updatePurchaseBill(sid(req), req.params.id, req.body) })));
router.post("/purchases/:id/confirm", wrap(async (req) => ({ message: "Purchase confirmed, stock updated", data: await svc.confirmPurchaseBill(sid(req), req.params.id) })));
router.post("/purchases/:id/cancel", wrap(async (req) => ({ message: "Purchase cancelled", data: await svc.cancelPurchaseBill(sid(req), req.params.id) })));
router.post("/purchase-returns", validate(returnSchema), wrap(async (req) => ({ status: 201, message: "Purchase return recorded, stock reduced", data: await svc.createPurchaseReturn(sid(req), req.body) })));

/* expenses / cash */
router.post("/expenses", validate(expenseSchema), wrap(async (req) => ({ status: 201, data: await svc.addExpense(sid(req), req.body) })));
router.delete("/expenses/:id", wrap(async (req) => {
  await Expense.deleteOne({ _id: req.params.id, seller: sid(req) });
  return { message: "Expense deleted" };
}));
router.post("/cash-entries", validate(cashSchema), wrap(async (req) => ({ status: 201, data: await svc.addCashEntry(sid(req), req.body) })));
router.put("/cash-register/opening", validate(openingSchema), wrap(async (req) => {
  const { dateKey, openingCash, countedClosingCash } = req.body;
  return { data: await svc.setOpeningCash(sid(req), dateKey, openingCash, countedClosingCash) };
}));
router.get("/cash-register/today", wrap(async (req) => {
  const tz = await getSellerTz(sid(req));
  return { data: await dayBook(sid(req), req.query.date || todayKey(tz), tz) };
}));
const dayKeySchema = Joi.object({
  dateKey: str.pattern(/^\d{4}-\d{2}-\d{2}$/).required(),
  countedClosingCash: Joi.number().min(0),
});
router.post("/cash-register/close", validate(dayKeySchema), wrap(async (req) => ({ message: "Day closed", data: await svc.closeDay(sid(req), req.body.dateKey, req.body.countedClosingCash) })));
router.post("/cash-register/reopen", validate(dayKeySchema), wrap(async (req) => ({ message: "Day reopened", data: await svc.reopenDay(sid(req), req.body.dateKey) })));

/* store settings (timezone drives business-day boundaries) */
router.get("/settings", wrap(async (req) => ({ data: { timezone: await svc.getTimezone(sid(req)) } })));
router.put("/settings", validate(Joi.object({ timezone: str.max(64).required() })), wrap(async (req) => ({ message: "Saved", data: { timezone: await svc.setTimezone(sid(req), req.body.timezone) } })));

/* dashboard + reports */
router.get("/dashboard", wrap(async (req) => ({ data: await dashboard(sid(req)) })));
router.get("/accounts/:view", wrap(async (req) => {
  if (!ACCOUNT_VIEWS.includes(req.params.view)) {
    return { status: 404, message: `Unknown account view. Available: ${ACCOUNT_VIEWS.join(", ")}` };
  }
  return { data: await accountTransactions(sid(req), req.params.view, req.query) };
}));
router.get("/reports/:type", wrap(async (req) => {
  const data = await runReport(req.params.type, sid(req), req.query);
  if (!data) return { status: 404, message: `Unknown report. Available: ${REPORT_TYPES.join(", ")}` };
  return { data };
}));

export default router;
