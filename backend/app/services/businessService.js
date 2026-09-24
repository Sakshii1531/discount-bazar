import mongoose from "mongoose";
import Product from "../models/product.js";
import Seller from "../models/seller.js";
import StockHistory from "../models/stockHistory.js";
import Supplier from "../models/supplier.js";
import PosCustomer from "../models/posCustomer.js";
import PurchaseBill from "../models/purchaseBill.js";
import PurchaseReturn from "../models/purchaseReturn.js";
import PartyLedgerEntry from "../models/partyLedgerEntry.js";
import Expense from "../models/expense.js";
import CashEntry from "../models/cashEntry.js";
import CashDay from "../models/cashDay.js";
import { emitProductStockUpdate } from "./orderSocketEmitter.js";
import { roundCurrency } from "../utils/money.js";
import { assertDayOpen, getSellerTz, dateKeyOf } from "./businessTime.js";

const err = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const oid = (id) => new mongoose.Types.ObjectId(String(id));

async function inTxn(fn) {
  const session = await mongoose.startSession();
  try {
    let out;
    await session.withTransaction(async () => {
      out = await fn(session);
    });
    return out;
  } finally {
    session.endSession();
  }
}

/**
 * Central stock mutation for purchases / purchase returns. Uses the same master
 * `Product.stock` that POS and Quick Commerce decrement, so every channel shares
 * one inventory. Negative deltas are guarded so stock never goes below zero.
 */
async function applyStock({ productId, variantSku = "", sellerId, delta, type, note, session, emits }) {
  if (!delta) return;
  const filter = { _id: productId, sellerId };
  let update = { $inc: { stock: delta } };
  if (variantSku) {
    // Variant-level stock: master stock stays the sum of variant stocks.
    filter.variants = { $elemMatch: { sku: variantSku, ...(delta < 0 ? { stock: { $gte: -delta } } : {}) } };
    update = { $inc: { stock: delta, "variants.$.stock": delta } };
  } else if (delta < 0) {
    filter.stock = { $gte: -delta };
  }
  const updated = await Product.findOneAndUpdate(filter, update, { new: true, session });
  if (!updated) throw err(409, "Insufficient stock or product/variant not found for stock adjustment");
  await StockHistory.create(
    [{ product: productId, seller: sellerId, type, quantity: delta, note: variantSku ? `${note} [variant: ${variantSku}]` : note }],
    { session },
  );
  emits.push({ productId: updated._id, sellerId, stock: updated.stock, variantSku: variantSku || null });
}

// Apply a per-line quantity map (key "productId::variantSku") to stock.
async function applyQtyMap(map, sign, args) {
  for (const [key, qty] of map) {
    const [productId, variantSku] = key.split("::");
    await applyStock({ ...args, productId, variantSku, delta: sign * qty });
  }
}

export { applyStock };

const flushEmits = (emits) => setImmediate(() => emits.forEach((e) => emitProductStockUpdate(e)));

/* ---------------- parties ---------------- */
export async function saveParty(Model, sellerId, id, data) {
  const fields = { name: data.name, phone: data.phone, address: data.address };
  if (Model === Supplier) fields.gstin = data.gstin;
  Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);
  if (id) {
    const doc = await Model.findOneAndUpdate({ _id: id, seller: sellerId }, fields, { new: true });
    if (!doc) throw err(404, "Not found");
    return doc;
  }
  return Model.create({ seller: sellerId, ...fields });
}

export async function partyBalances(sellerId, partyType) {
  const rows = await PartyLedgerEntry.aggregate([
    { $match: { seller: oid(sellerId), partyType } },
    { $group: { _id: "$party", balance: { $sum: { $multiply: ["$amount", "$effect"] } } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), roundCurrency(r.balance)]));
}

export async function listParties(sellerId, partyType) {
  const Model = partyType === "SUPPLIER" ? Supplier : PosCustomer;
  const [docs, bal] = await Promise.all([
    Model.find({ seller: sellerId }).sort({ name: 1 }).lean(),
    partyBalances(sellerId, partyType),
  ]);
  return docs.map((d) => ({ ...d, balance: bal.get(String(d._id)) || 0 }));
}

export async function partyLedger(sellerId, partyType, partyId, { from, to } = {}) {
  const q = { seller: sellerId, partyType, party: partyId };
  if (from || to) q.date = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  const entries = await PartyLedgerEntry.find(q).sort({ date: 1, createdAt: 1 }).lean();
  let running = 0;
  const rows = entries.map((e) => {
    running = roundCurrency(running + e.amount * e.effect);
    return { ...e, balance: running };
  });
  return { entries: rows, balance: running };
}

export async function recordPayment(sellerId, { partyType, partyId, amount, method = "CASH", note = "", date }) {
  const Model = partyType === "SUPPLIER" ? Supplier : PosCustomer;
  if (!(await Model.exists({ _id: partyId, seller: sellerId }))) throw err(404, "Party not found");
  await assertDayOpen(sellerId, date || new Date());
  return PartyLedgerEntry.create({
    seller: sellerId, partyType, party: partyId, kind: "PAYMENT", effect: -1,
    amount, method, note, date: date || new Date(),
  });
}

/* ---------------- purchase bills ---------------- */
function priceItems(items) {
  let subtotal = 0;
  let gstTotal = 0;
  const priced = items.map((i) => {
    const base = roundCurrency(i.quantity * i.cost);
    const gst = roundCurrency((base * (i.gstPercent || 0)) / 100);
    subtotal += base;
    gstTotal += gst;
    return { product: i.productId, variantSku: i.variantSku || "", quantity: i.quantity, cost: i.cost, gstPercent: i.gstPercent || 0, lineTotal: roundCurrency(base + gst) };
  });
  return { priced, subtotal: roundCurrency(subtotal), gstTotal: roundCurrency(gstTotal), total: roundCurrency(subtotal + gstTotal) };
}

async function nameItems(sellerId, priced, session) {
  const prods = await Product.find({ _id: { $in: priced.map((p) => p.product) }, sellerId })
    .select("name variants.sku variants.name").session(session).lean();
  const byId = new Map(prods.map((p) => [String(p._id), p]));
  return priced.map((p) => {
    const prod = byId.get(String(p.product));
    if (!prod) throw err(404, "One or more products not in your catalog");
    if (p.variantSku && !(prod.variants || []).some((v) => v.sku === p.variantSku)) throw err(404, "Variant not found");
    if (!p.variantSku && (prod.variants || []).length > 1) throw err(400, `Select a variant for ${prod.name}`);
    return { ...p, name: p.variantSku ? `${prod.name} (${p.variantSku})` : prod.name };
  });
}

function qtyMap(items) {
  const m = new Map();
  items.forEach((i) => {
    const k = `${i.product}::${i.variantSku || ""}`;
    m.set(k, (m.get(k) || 0) + i.quantity);
  });
  return m;
}

async function writeBillLedger(bill, session) {
  const base = {
    seller: bill.seller, partyType: "SUPPLIER", party: bill.supplier,
    refModel: "PurchaseBill", refId: bill._id, refNo: bill.billNo, date: bill.billDate,
  };
  const rows = [{ ...base, kind: "PURCHASE", effect: 1, amount: bill.total, note: "Purchase bill" }];
  if (bill.amountPaid > 0) {
    rows.push({ ...base, kind: "PAYMENT", effect: -1, amount: bill.amountPaid, method: bill.paymentMethod || "CASH", note: "Paid on bill" });
  }
  await PartyLedgerEntry.create(rows, { session, ordered: true });
}

const clearBillLedger = (bill, session) =>
  PartyLedgerEntry.deleteMany({ seller: bill.seller, refModel: "PurchaseBill", refId: bill._id }, { session });

// Latest purchase cost becomes the product's cost price (used for P&L snapshots at sale time).
async function applyCostUpdate(items, sellerId, session) {
  for (const i of items) {
    if (i.variantSku) {
      await Product.updateOne({ _id: i.product, sellerId, "variants.sku": i.variantSku }, { $set: { "variants.$.purchaseCost": i.cost } }, { session });
    } else {
      await Product.updateOne({ _id: i.product, sellerId }, { $set: { purchaseCost: i.cost } }, { session });
    }
  }
}

async function confirmBillTxn(bill, session) {
  if (bill.status !== "DRAFT") throw err(409, "Only draft bills can be confirmed");
  const emits = [];
  await applyQtyMap(qtyMap(bill.items), 1, { sellerId: bill.seller, type: "Purchase", note: `Purchase bill ${bill.billNo}`, session, emits });
  await applyCostUpdate(bill.items, bill.seller, session);
  await writeBillLedger(bill, session);
  bill.status = "CONFIRMED";
  await bill.save({ session });
  flushEmits(emits);
  return bill;
}

export async function createPurchaseBill(sellerId, p) {
  await assertDayOpen(sellerId, p.billDate || new Date());
  return inTxn(async (session) => {
    if (!(await Supplier.exists({ _id: p.supplierId, seller: sellerId }).session(session))) throw err(404, "Supplier not found");
    const t = priceItems(p.items);
    const items = await nameItems(sellerId, t.priced, session);
    const paid = Math.min(p.amountPaid || 0, t.total);
    const [bill] = await PurchaseBill.create([{
      seller: sellerId, supplier: p.supplierId, billNo: p.billNo, billDate: p.billDate || new Date(), items,
      subtotal: t.subtotal, gstTotal: t.gstTotal, total: t.total, amountPaid: paid,
      paymentMethod: paid ? p.paymentMethod || "CASH" : "", status: "DRAFT", note: p.note || "",
    }], { session });
    return p.confirm ? confirmBillTxn(bill, session) : bill;
  });
}

export async function confirmPurchaseBill(sellerId, id) {
  return inTxn(async (session) => {
    const bill = await PurchaseBill.findOne({ _id: id, seller: sellerId }).session(session);
    if (!bill) throw err(404, "Bill not found");
    await assertDayOpen(sellerId, bill.billDate);
    return confirmBillTxn(bill, session);
  });
}

/** Edit a bill. Confirmed bills: stock adjusts by the net qty change per product and the ledger is rewritten. */
export async function updatePurchaseBill(sellerId, id, p) {
  return inTxn(async (session) => {
    const bill = await PurchaseBill.findOne({ _id: id, seller: sellerId }).session(session);
    if (!bill) throw err(404, "Bill not found");
    if (bill.status === "CANCELLED") throw err(409, "Cancelled bill cannot be edited");
    await assertDayOpen(sellerId, bill.billDate);
    if (p.billDate) await assertDayOpen(sellerId, p.billDate);
    const t = priceItems(p.items);
    const items = await nameItems(sellerId, t.priced, session);
    const emits = [];
    if (bill.status === "CONFIRMED") {
      const oldQ = qtyMap(bill.items);
      const newQ = qtyMap(items);
      const diff = new Map();
      for (const key of new Set([...oldQ.keys(), ...newQ.keys()])) diff.set(key, (newQ.get(key) || 0) - (oldQ.get(key) || 0));
      // Apply reductions first so a failing guard aborts before any increase.
      const neg = new Map([...diff].filter(([, d]) => d < 0).map(([k, d]) => [k, -d]));
      const pos = new Map([...diff].filter(([, d]) => d > 0));
      const args = { sellerId, type: "Correction", note: `Purchase bill ${bill.billNo} edited`, session, emits };
      await applyQtyMap(neg, -1, args);
      await applyQtyMap(pos, 1, args);
      await applyCostUpdate(items, sellerId, session);
      await clearBillLedger(bill, session);
    }
    if (p.supplierId) bill.supplier = p.supplierId;
    if (p.billNo) bill.billNo = p.billNo;
    if (p.billDate) bill.billDate = p.billDate;
    bill.items = items;
    bill.subtotal = t.subtotal;
    bill.gstTotal = t.gstTotal;
    bill.total = t.total;
    bill.amountPaid = Math.min(p.amountPaid ?? bill.amountPaid, t.total);
    bill.paymentMethod = bill.amountPaid ? p.paymentMethod || bill.paymentMethod || "CASH" : "";
    if (p.note !== undefined) bill.note = p.note;
    await bill.save({ session });
    if (bill.status === "CONFIRMED") await writeBillLedger(bill, session);
    flushEmits(emits);
    return bill;
  });
}

export async function cancelPurchaseBill(sellerId, id) {
  return inTxn(async (session) => {
    const bill = await PurchaseBill.findOne({ _id: id, seller: sellerId }).session(session);
    if (!bill) throw err(404, "Bill not found");
    if (bill.status === "CANCELLED") throw err(409, "Already cancelled");
    await assertDayOpen(sellerId, bill.billDate);
    const emits = [];
    if (bill.status === "CONFIRMED") {
      await applyQtyMap(qtyMap(bill.items), -1, { sellerId, type: "Correction", note: `Purchase bill ${bill.billNo} cancelled`, session, emits });
      await clearBillLedger(bill, session);
    }
    bill.status = "CANCELLED";
    await bill.save({ session });
    flushEmits(emits);
    return bill;
  });
}

export async function listPurchaseBills(sellerId, { from, to, supplierId } = {}) {
  const q = { seller: sellerId };
  if (supplierId) q.supplier = supplierId;
  if (from || to) q.billDate = { ...(from && { $gte: from }), ...(to && { $lte: to }) };
  return PurchaseBill.find(q).populate("supplier", "name").sort({ billDate: -1 }).limit(300).lean();
}

/* ---------------- purchase returns ---------------- */
export async function createPurchaseReturn(sellerId, p) {
  await assertDayOpen(sellerId, p.date || new Date());
  return inTxn(async (session) => {
    if (!(await Supplier.exists({ _id: p.supplierId, seller: sellerId }).session(session))) throw err(404, "Supplier not found");
    const t = priceItems(p.items);
    const items = await nameItems(sellerId, t.priced, session);
    const emits = [];
    const returnNo = `PR-${Date.now().toString(36).toUpperCase()}`;
    const [ret] = await PurchaseReturn.create([{
      seller: sellerId, supplier: p.supplierId, returnNo, purchaseBill: p.purchaseBillId || null,
      date: p.date || new Date(), items, total: t.total, reason: p.reason || "",
    }], { session });
    await applyQtyMap(qtyMap(items), -1, { sellerId, type: "PurchaseReturn", note: `Purchase return ${returnNo}`, session, emits });
    await PartyLedgerEntry.create([{
      seller: sellerId, partyType: "SUPPLIER", party: p.supplierId, kind: "PURCHASE_RETURN", effect: -1,
      amount: t.total, refModel: "PurchaseReturn", refId: ret._id, refNo: returnNo, date: ret.date,
      note: p.reason || "Purchase return",
    }], { session });
    flushEmits(emits);
    return ret;
  });
}

/* ---------------- expenses & cash ---------------- */
export async function addExpense(sellerId, d) {
  await assertDayOpen(sellerId, d.date || new Date());
  return Expense.create({ seller: sellerId, ...d, date: d.date || new Date() });
}
export async function addCashEntry(sellerId, d) {
  await assertDayOpen(sellerId, d.date || new Date());
  return CashEntry.create({ seller: sellerId, ...d, date: d.date || new Date() });
}
export async function setOpeningCash(sellerId, dateKey, openingCash, countedClosingCash) {
  const existing = await CashDay.findOne({ seller: sellerId, dateKey }).lean();
  if (existing?.closed) throw err(423, `Business day ${dateKey} is closed. Reopen it to make changes.`);
  return CashDay.findOneAndUpdate(
    { seller: sellerId, dateKey },
    { $set: { openingCash, ...(countedClosingCash !== undefined && { countedClosingCash }) } },
    { upsert: true, new: true },
  );
}

/** Close the business day: records counted cash and locks the day against edits. */
export async function closeDay(sellerId, dateKey, countedClosingCash) {
  const $set = { closed: true, closedAt: new Date() };
  if (countedClosingCash !== undefined) $set.countedClosingCash = countedClosingCash;
  return CashDay.findOneAndUpdate({ seller: sellerId, dateKey }, { $set, $setOnInsert: { openingCash: 0 } }, { upsert: true, new: true });
}

export async function reopenDay(sellerId, dateKey) {
  const doc = await CashDay.findOneAndUpdate({ seller: sellerId, dateKey }, { $set: { closed: false, closedAt: null } }, { new: true });
  if (!doc) throw err(404, "Day not found");
  return doc;
}

export async function getTimezone(sellerId) {
  return getSellerTz(sellerId);
}

export async function setTimezone(sellerId, tz) {
  const { isValidTz } = await import("./businessTime.js");
  if (!isValidTz(tz)) throw err(400, "Invalid timezone");
  await Seller.updateOne({ _id: sellerId }, { $set: { timezone: tz } });
  return tz;
}
