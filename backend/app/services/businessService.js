import mongoose from "mongoose";
import Product from "../models/product.js";
import Seller from "../models/seller.js";
import StockHistory from "../models/stockHistory.js";
import Supplier from "../models/supplier.js";
import PosCustomer from "../models/posCustomer.js";
import PurchaseBill from "../models/purchaseBill.js";
import PurchaseReturn from "../models/purchaseReturn.js";
import PartyLedgerEntry from "../models/partyLedgerEntry.js";
import Order from "../models/order.js";
import PosReturn from "../models/posReturn.js";
import Expense from "../models/expense.js";
import CashEntry from "../models/cashEntry.js";
import CashDay from "../models/cashDay.js";
import { emitProductStockUpdate } from "./orderSocketEmitter.js";
import { roundCurrency, convertPurchaseCost, computePurchaseGst } from "../utils/money.js";
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
  const { itemsByRef, billByRef } = await ledgerBillItems(sellerId, entries);
  let running = 0;
  const rows = entries.map((e) => {
    running = roundCurrency(running + e.amount * e.effect);
    // Payments share the bill's ref but carry no goods of their own.
    const ref = `${e.refModel}:${e.refId}`;
    const items = e.kind !== "PAYMENT" && e.refId ? itemsByRef.get(ref) || [] : [];
    // Bill-level figures (discount / tax / whether prices include GST) for the printable invoice.
    const bill = e.kind !== "PAYMENT" && e.refId ? billByRef.get(ref) : undefined;
    return { ...e, items, ...(bill ? { bill } : {}), balance: running };
  });
  return { entries: rows, balance: running };
}

// Item lines of the bills/returns behind ledger entries, normalised to
// { name, variant, quantity, rate, gstPercent, amount, taxInclusive } and keyed "refModel:refId",
// plus each bill's own totals ({ subtotal, discount, tax, total, taxInclusive }).
async function ledgerBillItems(sellerId, entries) {
  const idsOf = (model) => [
    ...new Set(entries.filter((e) => e.kind !== "PAYMENT" && e.refModel === model && e.refId).map((e) => String(e.refId))),
  ];
  const [orders, bills, purchaseReturns, posReturns] = await Promise.all([
    idsOf("Order").length ? Order.find({ _id: { $in: idsOf("Order") }, seller: sellerId }).select("items isTaxInclusive paymentBreakdown").lean() : [],
    idsOf("PurchaseBill").length ? PurchaseBill.find({ _id: { $in: idsOf("PurchaseBill") }, seller: sellerId }).select("items subtotal gstTotal total").lean() : [],
    idsOf("PurchaseReturn").length ? PurchaseReturn.find({ _id: { $in: idsOf("PurchaseReturn") }, seller: sellerId }).select("items subtotal gstTotal total").lean() : [],
    idsOf("PosReturn").length ? PosReturn.find({ _id: { $in: idsOf("PosReturn") }, seller: sellerId }).select("items").lean() : [],
  ]);

  // Lines store the variant SKU; show the variant's name where the product still has it.
  const productIds = [...new Set([...orders, ...bills, ...purchaseReturns, ...posReturns]
    .flatMap((d) => d.items || []).map((i) => String(i.product)).filter(Boolean))];
  const products = productIds.length
    ? await Product.find({ _id: { $in: productIds } }).select("variants.sku variants.name").lean()
    : [];
  const variantNames = new Map();
  products.forEach((p) => (p.variants || []).forEach((v) => {
    if (v.sku && v.name) variantNames.set(`${p._id}:${String(v.sku).toLowerCase()}`, v.name);
  }));
  const variantOf = (productId, sku) =>
    (sku && variantNames.get(`${productId}:${String(sku).toLowerCase()}`)) || sku || "";

  const map = new Map();
  const billByRef = new Map();
  const put = (model, docs, toLine) => docs.forEach((d) => map.set(`${model}:${d._id}`, (d.items || []).map((i) => toLine(i, d))));
  const orderInclusive = (o) => (o.isTaxInclusive !== undefined ? o.isTaxInclusive !== false : o.paymentBreakdown?.isTaxInclusive !== false);
  put("Order", orders, (i, o) => ({
    name: i.name || "", variant: variantOf(i.product, i.variantSlot), quantity: i.quantity,
    rate: Number(i.price || 0), gstPercent: Number(i.gstPercent || 0),
    amount: roundCurrency(Number(i.price || 0) * Number(i.quantity || 0)),
    taxInclusive: orderInclusive(o),
  }));
  orders.forEach((o) => {
    const pb = o.paymentBreakdown || {};
    billByRef.set(`Order:${o._id}`, {
      subtotal: roundCurrency(pb.productSubtotal || 0),
      discount: roundCurrency(pb.discountTotal || 0),
      tax: roundCurrency(pb.taxTotal || 0),
      total: roundCurrency(pb.grandTotal || 0),
      taxInclusive: orderInclusive(o),
    });
  });
  [["PurchaseBill", bills], ["PurchaseReturn", purchaseReturns]].forEach(([model, docs]) =>
    docs.forEach((d) => {
      if (d.total == null) return;
      billByRef.set(`${model}:${d._id}`, {
        subtotal: roundCurrency(d.subtotal || 0), discount: 0, tax: roundCurrency(d.gstTotal || 0),
        total: roundCurrency(d.total || 0), taxInclusive: false,
      });
    }),
  );
  // Purchase lines are named "Product (SKU)"; the SKU moves to the variant column.
  const purchaseLine = (i) => ({
    name: i.variantSku && String(i.name || "").endsWith(` (${i.variantSku})`)
      ? i.name.slice(0, -(i.variantSku.length + 3))
      : i.name || "",
    variant: variantOf(i.product, i.variantSku), quantity: i.quantity,
    rate: Number(i.cost || 0), gstPercent: Number(i.gstPercent || 0),
    amount: roundCurrency(Number(i.lineTotal) || Number(i.cost || 0) * Number(i.quantity || 0)),
    // lineTotal already carries GST either way (see priceItems)
    taxInclusive: Number(i.lineTotal) > 0 || String(i.purchaseGstType || "").toUpperCase() === "INCLUSIVE",
  });
  put("PurchaseBill", bills, purchaseLine);
  put("PurchaseReturn", purchaseReturns, purchaseLine);
  put("PosReturn", posReturns, (i) => ({
    name: i.productName || "", variant: variantOf(i.product, i.variantSlot), quantity: i.quantity,
    rate: Number(i.unitPrice || 0), gstPercent: 0, amount: Number(i.refundAmount || 0), taxInclusive: true,
  }));
  return { itemsByRef: map, billByRef };
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
    const isInclusive = String(i.purchaseGstType || "").toUpperCase() === "INCLUSIVE";
    const qty = Number(i.quantity) || 0;
    const cost = Number(i.cost) || 0;
    const gstPct = Number(i.gstPercent) || 0;
    let base, gst, lineTotal;
    if (isInclusive) {
      lineTotal = roundCurrency(qty * cost);
      base = roundCurrency(lineTotal / (1 + gstPct / 100));
      gst = roundCurrency(lineTotal - base);
    } else {
      base = roundCurrency(qty * cost);
      gst = roundCurrency((base * gstPct) / 100);
      lineTotal = roundCurrency(base + gst);
    }
    subtotal += base;
    gstTotal += gst;
    return {
      product: i.productId,
      variantSku: i.variantSku || "",
      quantity: i.quantity,
      cost: i.cost,
      gstPercent: i.gstPercent || 0,
      purchaseGstType: isInclusive ? "INCLUSIVE" : "EXCLUSIVE",
      lineTotal,
    };
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
    // A single-variant product keeps its stock on that variant, so book against it.
    const variantSku = p.variantSku || (prod.variants?.length === 1 ? prod.variants[0].sku || "" : "");
    return { ...p, variantSku, name: variantSku ? `${prod.name} (${variantSku})` : prod.name };
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

// Units already sent back to the supplier against a bill, keyed like qtyMap.
async function returnedQty(sellerId, billId, session) {
  const rets = await PurchaseReturn.find({ seller: sellerId, purchaseBill: billId }).select("items").session(session).lean();
  return qtyMap(rets.flatMap((r) => r.items));
}

// The same supplier invoice must not be booked twice (doubles stock and dues).
async function assertUniqueBillNo(sellerId, supplierId, billNo, session, exceptId = null) {
  const q = { seller: sellerId, supplier: supplierId || null, billNo, status: { $ne: "CANCELLED" } };
  if (exceptId) q._id = { $ne: exceptId };
  if (await PurchaseBill.exists(q).session(session)) throw err(409, `Bill no. ${billNo} is already recorded for this supplier`);
}

// Supplier given: it must belong to this seller. Empty means "no supplier".
async function resolveSupplierId(sellerId, supplierId, session) {
  if (!supplierId) return null;
  if (!(await Supplier.exists({ _id: supplierId, seller: sellerId }).session(session))) throw err(404, "Supplier not found");
  return supplierId;
}

async function writeBillLedger(bill, session) {
  const base = {
    seller: bill.seller, partyType: "SUPPLIER", party: bill.supplier,
    refModel: "PurchaseBill", refId: bill._id, refNo: bill.billNo, date: bill.billDate,
  };
  // Without a supplier nobody is owed money, so only the payment (cash out) is recorded.
  const rows = bill.supplier ? [{ ...base, kind: "PURCHASE", effect: 1, amount: bill.total, note: "Purchase bill" }] : [];
  if (bill.amountPaid > 0) {
    rows.push({ ...base, kind: "PAYMENT", effect: -1, amount: bill.amountPaid, method: bill.paymentMethod || "CASH", note: "Paid on bill" });
  }
  if (rows.length) await PartyLedgerEntry.create(rows, { session, ordered: true });
}

const clearBillLedger = (bill, session) =>
  PartyLedgerEntry.deleteMany({ seller: bill.seller, refModel: "PurchaseBill", refId: bill._id }, { session });

// Latest purchase cost becomes the product's cost price (used for P&L snapshots at sale time).
// The bill line may be entered incl. or excl. GST; the product's purchaseCost follows the
// product's own GST type/rate, so the cost is converted (same pre-GST base) and the stored
// breakdown is recomputed, as productController does on a normal product save.
async function applyCostUpdate(items, sellerId, session) {
  const prods = await Product.find({ _id: { $in: items.map((i) => i.product) }, sellerId })
    .select("gstPercent purchaseGstType").session(session).lean();
  const byId = new Map(prods.map((p) => [String(p._id), p]));
  for (const i of items) {
    const prod = byId.get(String(i.product));
    if (!prod) continue;
    const to = { rate: prod.gstPercent || 0, type: prod.purchaseGstType || "EXCLUSIVE" };
    const cost = convertPurchaseCost(i.cost, { rate: i.gstPercent, type: i.purchaseGstType }, to);
    const b = computePurchaseGst(cost, to.rate, to.type);
    if (i.variantSku) {
      await Product.updateOne({ _id: i.product, sellerId, "variants.sku": i.variantSku }, {
        $set: {
          "variants.$.purchaseCost": cost,
          "variants.$.purchaseBasePrice": b.basePrice,
          "variants.$.purchaseGstAmount": b.gstAmount,
          "variants.$.purchaseFinalPrice": b.finalPrice,
        },
      }, { session });
    } else {
      await Product.updateOne({ _id: i.product, sellerId }, {
        $set: { purchaseCost: cost, purchaseBasePrice: b.basePrice, purchaseGstAmount: b.gstAmount, purchaseFinalPrice: b.finalPrice },
      }, { session });
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
    const supplierId = await resolveSupplierId(sellerId, p.supplierId, session);
    await assertUniqueBillNo(sellerId, supplierId, p.billNo, session);
    const t = priceItems(p.items);
    const items = await nameItems(sellerId, t.priced, session);
    const paid = Math.min(p.amountPaid || 0, t.total);
    const [bill] = await PurchaseBill.create([{
      seller: sellerId, supplier: supplierId, billNo: p.billNo, billDate: p.billDate || new Date(), items,
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
    const supplierId = p.supplierId !== undefined ? await resolveSupplierId(sellerId, p.supplierId, session) : bill.supplier;
    await assertUniqueBillNo(sellerId, supplierId, p.billNo || bill.billNo, session, bill._id);
    const t = priceItems(p.items);
    const items = await nameItems(sellerId, t.priced, session);
    const emits = [];
    if (bill.status === "CONFIRMED") {
      const oldQ = qtyMap(bill.items);
      const newQ = qtyMap(items);
      // Units already returned to the supplier can't be removed from the bill again.
      for (const [key, q] of await returnedQty(sellerId, bill._id, session)) {
        if ((newQ.get(key) || 0) < q) throw err(409, `${q} unit(s) of an item were already returned against this bill; quantity cannot go below that`);
      }
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
    bill.supplier = supplierId;
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
    // Cancelling would reverse the full quantity again on top of the returns.
    if (await PurchaseReturn.exists({ seller: sellerId, purchaseBill: bill._id }).session(session)) {
      throw err(409, "This bill has purchase returns, so it cannot be cancelled. Edit the bill instead.");
    }
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
  return PurchaseBill.find(q).populate("supplier", "name phone gstin address").sort({ billDate: -1 }).limit(300).lean();
}

/** One bill, shaped like a listPurchaseBills row (opened for editing from a supplier ledger). */
export async function getPurchaseBill(sellerId, id) {
  if (!mongoose.Types.ObjectId.isValid(String(id))) throw err(404, "Bill not found");
  const bill = await PurchaseBill.findOne({ _id: id, seller: sellerId })
    .populate("supplier", "name phone gstin address")
    .lean();
  if (!bill) throw err(404, "Bill not found");
  return bill;
}

/* ---------------- purchase returns ---------------- */
// A return against a bill reverses that bill's lines: each item takes the GST rate and
// incl./excl. type it was bought at, the supplier is the bill's, and the quantity can't
// exceed what was bought minus what was already returned.
async function billReturnLines(sellerId, billId, items, session) {
  const bill = await PurchaseBill.findOne({ _id: billId, seller: sellerId }).select("status supplier items").session(session).lean();
  if (!bill) throw err(404, "Purchase bill not found");
  if (bill.status !== "CONFIRMED") throw err(409, "Only confirmed bills can have returns");
  const lines = items.map((i) => {
    const line = bill.items.find((b) => String(b.product) === String(i.productId) && (b.variantSku || "") === (i.variantSku || ""));
    if (!line) throw err(400, "Returned item is not on this purchase bill");
    return { ...i, gstPercent: line.gstPercent || 0, purchaseGstType: line.purchaseGstType || "EXCLUSIVE" };
  });
  const bought = qtyMap(bill.items);
  const done = await returnedQty(sellerId, bill._id, session);
  for (const [key, q] of qtyMap(lines.map((l) => ({ product: l.productId, variantSku: l.variantSku, quantity: l.quantity })))) {
    const left = (bought.get(key) || 0) - (done.get(key) || 0);
    if (q > left) throw err(409, left > 0 ? `Only ${left} unit(s) left to return on this bill` : "This item has already been fully returned");
  }
  return { lines, supplier: bill.supplier || null };
}

export async function createPurchaseReturn(sellerId, p) {
  await assertDayOpen(sellerId, p.date || new Date());
  return inTxn(async (session) => {
    const fromBill = p.purchaseBillId ? await billReturnLines(sellerId, p.purchaseBillId, p.items, session) : null;
    const supplierId = fromBill ? fromBill.supplier : await resolveSupplierId(sellerId, p.supplierId, session);
    const t = priceItems(fromBill ? fromBill.lines : p.items);
    const items = await nameItems(sellerId, t.priced, session);
    const emits = [];
    const returnNo = `PR-${Date.now().toString(36).toUpperCase()}`;
    const [ret] = await PurchaseReturn.create([{
      seller: sellerId, supplier: supplierId, returnNo, purchaseBill: p.purchaseBillId || null,
      date: p.date || new Date(), items, total: t.total, reason: p.reason || "",
    }], { session });
    await applyQtyMap(qtyMap(items), -1, { sellerId, type: "PurchaseReturn", note: `Purchase return ${returnNo}`, session, emits });
    // No supplier: stock goes back, but there is no supplier balance to reduce.
    if (supplierId) await PartyLedgerEntry.create([{
      seller: sellerId, partyType: "SUPPLIER", party: supplierId, kind: "PURCHASE_RETURN", effect: -1,
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
