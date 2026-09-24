import mongoose from "mongoose";
import Product from "../models/product.js";
import Order from "../models/order.js";
import PosReturn from "../models/posReturn.js";
import PurchaseBill from "../models/purchaseBill.js";
import PurchaseReturn from "../models/purchaseReturn.js";
import PartyLedgerEntry from "../models/partyLedgerEntry.js";
import Expense from "../models/expense.js";
import CashEntry from "../models/cashEntry.js";
import CashDay from "../models/cashDay.js";
import { listParties } from "./businessService.js";
import { roundCurrency as r2 } from "../utils/money.js";

const oid = (id) => new mongoose.Types.ObjectId(String(id));
import { dayStart, dayEnd, todayKey, getSellerTz } from "./businessTime.js";
export { todayKey };

export function parseRange(query = {}, tz) {
  const fromKey = query.from || todayKey(tz);
  const toKey = query.to || fromKey;
  return { fromKey, toKey, from: dayStart(fromKey, tz), to: dayEnd(toKey, tz), tz };
}

const sellerSales = (sellerId, from, to) => ({
  seller: oid(sellerId),
  createdAt: { $gte: from, $lte: to },
  $or: [{ orderSource: "POS" }, { orderSource: { $ne: "POS" }, workflowStatus: "DELIVERED" }],
});

async function costMap(sellerId) {
  const prods = await Product.find({ sellerId }).select("purchaseCost").lean();
  return new Map(prods.map((p) => [String(p._id), Number(p.purchaseCost || 0)]));
}

function orderCost(order, costs) {
  return (order.items || []).reduce(
    (s, i) => s + i.quantity * (i.costPrice ?? costs.get(String(i.product)) ?? 0),
    0,
  );
}

function orderGst(order) {
  return (order.items || []).reduce((s, i) => {
    const g = Number(i.gstPercent || 0);
    return s + (i.price * i.quantity * g) / (100 + g);
  }, 0);
}

/* ---------------- sales / returns ---------------- */
async function salesReport(sellerId, { from, to }) {
  const [orders, costs] = await Promise.all([
    Order.find(sellerSales(sellerId, from, to)).sort({ createdAt: -1 }).lean(),
    costMap(sellerId),
  ]);
  const rows = orders.map((o) => ({
    orderId: o.orderId,
    date: o.createdAt,
    channel: o.orderSource === "POS" ? "POS" : "Quick Commerce",
    payment: o.orderSource === "POS"
      ? (o.posPaymentMethod === "SPLIT" && o.posPayments?.length
        ? `SPLIT (${o.posPayments.map((p) => `${p.method} ${r2(p.amount)}`).join(" + ")})`
        : o.posPaymentMethod)
      : o.paymentMode,
    discount: r2(o.paymentBreakdown?.discountTotal || 0),
    gst: r2(orderGst(o)),
    total: r2(o.paymentBreakdown?.grandTotal || 0),
    cost: r2(orderCost(o, costs)),
  }));
  return {
    rows,
    totals: {
      count: rows.length,
      total: r2(rows.reduce((s, x) => s + x.total, 0)),
      gst: r2(rows.reduce((s, x) => s + x.gst, 0)),
      discount: r2(rows.reduce((s, x) => s + x.discount, 0)),
    },
  };
}

async function saleReturnReport(sellerId, { from, to }) {
  const docs = await PosReturn.find({ seller: sellerId, createdAt: { $gte: from, $lte: to } }).sort({ createdAt: -1 }).lean();
  const rows = docs.map((d) => ({
    orderId: d.orderId, date: d.createdAt, refundMethod: d.refundMethod, reason: d.reason,
    items: (d.items || []).map((i) => `${i.productName} x${i.quantity}${i.restocked ? "" : " (damaged)"}`).join(", "),
    total: d.refundTotal,
  }));
  return { rows, totals: { count: rows.length, total: r2(rows.reduce((s, x) => s + x.total, 0)) } };
}

async function purchaseReport(sellerId, { from, to }) {
  const docs = await PurchaseBill.find({ seller: sellerId, status: "CONFIRMED", billDate: { $gte: from, $lte: to } })
    .populate("supplier", "name").sort({ billDate: -1 }).lean();
  const rows = docs.map((d) => ({
    billNo: d.billNo, date: d.billDate, supplier: d.supplier?.name, gst: d.gstTotal, total: d.total,
    paid: d.amountPaid, due: r2(d.total - d.amountPaid),
  }));
  return { rows, totals: { count: rows.length, total: r2(rows.reduce((s, x) => s + x.total, 0)), due: r2(rows.reduce((s, x) => s + x.due, 0)) } };
}

async function purchaseReturnReport(sellerId, { from, to }) {
  const docs = await PurchaseReturn.find({ seller: sellerId, date: { $gte: from, $lte: to } })
    .populate("supplier", "name").sort({ date: -1 }).lean();
  const rows = docs.map((d) => ({
    returnNo: d.returnNo, date: d.date, supplier: d.supplier?.name, reason: d.reason,
    items: d.items.map((i) => `${i.name} x${i.quantity}`).join(", "), total: d.total,
  }));
  return { rows, totals: { count: rows.length, total: r2(rows.reduce((s, x) => s + x.total, 0)) } };
}

async function expenseReport(sellerId, { from, to }) {
  const rows = await Expense.find({ seller: sellerId, date: { $gte: from, $lte: to } }).sort({ date: -1 }).lean();
  return { rows, totals: { count: rows.length, total: r2(rows.reduce((s, x) => s + x.amount, 0)) } };
}

/* ---------------- stock ---------------- */
const lowStockQuery = (sellerId) => ({
  sellerId: oid(sellerId),
  status: "active",
  $expr: { $lte: ["$stock", { $ifNull: ["$lowStockAlert", 5] }] },
});

async function stockReport(sellerId) {
  const prods = await Product.find({ sellerId }).select("name barcode sku brand size colour stock purchaseCost price salePrice lowStockAlert").sort({ name: 1 }).lean();
  const rows = prods.map((p) => ({
    ...p,
    sellPrice: p.salePrice > 0 ? p.salePrice : p.price,
    stockValue: r2((p.stock || 0) * (p.purchaseCost || 0)),
  }));
  return { rows, totals: { count: rows.length, units: rows.reduce((s, x) => s + (x.stock || 0), 0), value: r2(rows.reduce((s, x) => s + x.stockValue, 0)) } };
}

async function lowStockReport(sellerId) {
  const rows = await Product.find(lowStockQuery(sellerId)).select("name barcode sku stock lowStockAlert").sort({ stock: 1 }).lean();
  return { rows, totals: { count: rows.length } };
}

/* ---------------- ledgers ---------------- */
const ledgerReport = async (sellerId, type) => {
  const rows = await listParties(sellerId, type);
  return { rows, totals: { count: rows.length, pending: r2(rows.reduce((s, x) => s + Math.max(x.balance, 0), 0)) } };
};

/* ---------------- P&L ---------------- */
async function pnlReport(sellerId, range) {
  const [sales, ret, exp, costs] = await Promise.all([
    Order.find(sellerSales(sellerId, range.from, range.to)).lean(),
    PosReturn.find({ seller: sellerId, createdAt: { $gte: range.from, $lte: range.to } }).lean(),
    expenseReport(sellerId, range),
    costMap(sellerId),
  ]);
  const revenue = sales.reduce((s, o) => s + (o.paymentBreakdown?.grandTotal || 0), 0);
  const gst = sales.reduce((s, o) => s + orderGst(o), 0);
  const cogs = sales.reduce((s, o) => s + orderCost(o, costs), 0);
  const refunds = ret.reduce((s, x) => s + x.refundTotal, 0);
  // Cost of goods that came back into stock is not a real cost.
  const returnedCost = ret.reduce(
    (s, x) => s + (x.items || []).filter((i) => i.restocked).reduce((a, i) => a + i.quantity * (costs.get(String(i.product)) || 0), 0),
    0,
  );
  const netSales = revenue - refunds;
  const netCogs = cogs - returnedCost;
  const gross = netSales - netCogs;
  const expenses = exp.totals.total;
  const summary = {
    grossSales: r2(revenue), saleReturns: r2(refunds), netSales: r2(netSales),
    costOfGoodsSold: r2(netCogs), grossProfit: r2(gross), gstIncluded: r2(gst),
    expenses, netProfit: r2(gross - expenses),
  };
  return { rows: Object.entries(summary).map(([label, amount]) => ({ label, amount })), totals: summary };
}

/* ---------------- day book / cash register ---------------- */
async function sumBy(Model, match, keyField, valueExpr) {
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: keyField, v: { $sum: valueExpr } } }]);
  return Object.fromEntries(rows.map((x) => [String(x._id), x.v]));
}

// POS takings per tender type; a SPLIT bill contributes each of its tender lines.
async function posSalesByTender(sellerOid, between) {
  const rows = await Order.aggregate([
    { $match: { seller: sellerOid, orderSource: "POS", createdAt: between } },
    {
      $project: {
        lines: {
          $cond: [
            { $gt: [{ $size: { $ifNull: ["$posPayments", []] } }, 0] },
            "$posPayments",
            [{ method: "$posPaymentMethod", amount: { $ifNull: ["$posAmountPaid", "$paymentBreakdown.grandTotal"] } }],
          ],
        },
      },
    },
    { $unwind: "$lines" },
    { $group: { _id: "$lines.method", v: { $sum: "$lines.amount" } } },
  ]);
  return Object.fromEntries(rows.map((x) => [String(x._id ?? "undefined"), x.v]));
}

export async function cashMovements(sellerId, from, to) {
  const s = oid(sellerId);
  const between = { $gte: from, $lte: to };
  const [posSales, appSales, receipts, supplierPaid, refunds, expenses, manual] = await Promise.all([
    posSalesByTender(s, between),
    sumBy(Order, { seller: s, orderSource: { $ne: "POS" }, workflowStatus: "DELIVERED", createdAt: between }, "$paymentMode", "$paymentBreakdown.grandTotal"),
    // credit-sale "paid at billing" entries are already counted in posSales as cash
    sumBy(PartyLedgerEntry, { seller: s, partyType: "CUSTOMER", kind: "PAYMENT", refModel: { $ne: "Order" }, date: between }, "$method", "$amount"),
    sumBy(PartyLedgerEntry, { seller: s, partyType: "SUPPLIER", kind: "PAYMENT", date: between }, "$method", "$amount"),
    sumBy(PosReturn, { seller: s, createdAt: between }, "$refundMethod", "$refundTotal"),
    sumBy(Expense, { seller: s, date: between }, "$method", "$amount"),
    sumBy(CashEntry, { seller: s, date: between }, "$direction", "$amount"),
  ]);
  const g = (o, k) => o[k] || 0;
  const cashSales = g(posSales, "CASH") + g(posSales, "CREDIT") + g(posSales, "undefined") + g(appSales, "COD");
  const digitalSales = {
    UPI: g(posSales, "QR"), CARD: g(posSales, "CARD"), OTHER: g(posSales, "OTHER"), ONLINE: g(appSales, "ONLINE"),
  };
  const cashIn = cashSales + g(receipts, "CASH") + g(manual, "IN");
  const cashOut = g(refunds, "CASH") + g(supplierPaid, "CASH") + g(expenses, "CASH") + g(manual, "OUT");
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  return {
    cashSales: r2(cashSales),
    digitalSales: Object.fromEntries(Object.entries(digitalSales).map(([k, v]) => [k, r2(v)])),
    digitalTotal: r2(sum(digitalSales)),
    customerReceiptsCash: r2(g(receipts, "CASH")),
    customerReceiptsDigital: r2(sum(receipts) - g(receipts, "CASH")),
    supplierPaymentsCash: r2(g(supplierPaid, "CASH")),
    refundsCash: r2(g(refunds, "CASH")),
    expensesTotal: r2(sum(expenses)),
    expensesCash: r2(g(expenses, "CASH")),
    manualCashIn: r2(g(manual, "IN")),
    manualCashOut: r2(g(manual, "OUT")),
    cashIn: r2(cashIn),
    cashOut: r2(cashOut),
    net: r2(cashIn - cashOut),
  };
}

/** Opening = last explicitly set opening on/before the day, rolled forward by cash movement since then. */
async function openingCashFor(sellerId, key, tz) {
  const base = await CashDay.findOne({ seller: sellerId, dateKey: { $lte: key } }).sort({ dateKey: -1 }).lean();
  if (base?.dateKey === key) return { opening: base.openingCash, counted: base.countedClosingCash, explicit: true };
  if (!base) return { opening: 0, counted: null, explicit: false };
  const mv = await cashMovements(sellerId, dayStart(base.dateKey, tz), new Date(dayStart(key, tz).getTime() - 1));
  return { opening: r2(base.openingCash + mv.net), counted: null, explicit: false };
}

export async function dayBook(sellerId, key, tz) {
  const zone = tz || (await getSellerTz(sellerId));
  const [mv, open] = await Promise.all([cashMovements(sellerId, dayStart(key, zone), dayEnd(key, zone)), openingCashFor(sellerId, key, zone)]);
  const closing = r2(open.opening + mv.net);
  const own = await CashDay.findOne({ seller: sellerId, dateKey: key }).lean();
  return {
    date: key, openingCash: open.opening, ...mv, closingCash: closing,
    closed: Boolean(own?.closed),
    countedClosingCash: own?.countedClosingCash ?? null,
    difference: own?.countedClosingCash != null ? r2(own.countedClosingCash - closing) : null,
  };
}

async function dayBookReport(sellerId, { fromKey, toKey, tz }) {
  const rows = [];
  const cur = new Date(`${fromKey}T00:00:00Z`);
  const end = new Date(`${toKey}T00:00:00Z`);
  for (let i = 0; cur <= end && i < 62; i += 1, cur.setUTCDate(cur.getUTCDate() + 1)) {
    rows.push(await dayBook(sellerId, cur.toISOString().slice(0, 10), tz));
  }
  return { rows, totals: { days: rows.length } };
}

/* ---------------- dashboard ---------------- */
export async function dashboard(sellerId) {
  const tz = await getSellerTz(sellerId);
  const key = todayKey(tz);
  const range = { from: dayStart(key, tz), to: dayEnd(key, tz), tz };
  const [sales, purchases, stock, low, pnl, cust, sup] = await Promise.all([
    salesReport(sellerId, range), purchaseReport(sellerId, range), stockReport(sellerId), lowStockReport(sellerId),
    pnlReport(sellerId, range), ledgerReport(sellerId, "CUSTOMER"), ledgerReport(sellerId, "SUPPLIER"),
  ]);
  return {
    date: key,
    salesToday: sales.totals.total, salesCount: sales.totals.count,
    purchasesToday: purchases.totals.total,
    stockUnits: stock.totals.units, stockValue: stock.totals.value,
    profitToday: pnl.totals.netProfit,
    customerPending: cust.totals.pending, supplierPending: sup.totals.pending,
    lowStockCount: low.totals.count, lowStock: low.rows.slice(0, 8),
    expensesToday: pnl.totals.expenses,
  };
}

const REPORTS = {
  sales: salesReport,
  purchases: purchaseReport,
  "purchase-returns": purchaseReturnReport,
  "sale-returns": saleReturnReport,
  stock: stockReport,
  "customer-ledger": (s) => ledgerReport(s, "CUSTOMER"),
  "supplier-ledger": (s) => ledgerReport(s, "SUPPLIER"),
  "day-book": dayBookReport,
  "cash-register": dayBookReport,
  expenses: expenseReport,
  pnl: pnlReport,
  "low-stock": lowStockReport,
};

export const REPORT_TYPES = Object.keys(REPORTS);

export async function runReport(type, sellerId, query) {
  const fn = REPORTS[type];
  if (!fn) return null;
  return fn(sellerId, parseRange(query, await getSellerTz(sellerId)));
}
