import { printHtml } from "./ledgerStatement";

/**
 * Single-bill GST invoice (from a ledger row or a purchase bill): one model
 * feeds the on-screen view, the print (an isolated iframe, so only the invoice
 * is printed, never the ledger behind it) and the PDF download.
 *
 * Layout follows a standard Indian tax invoice: issuer header, invoice no/date,
 * Billed By / Billed To blocks, line table with taxable value + CGST/SGST,
 * HSN-less GST summary by rate, totals with round-off, amount in words,
 * payment details, declaration and authorised signatory.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) =>
  round2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => {
  if (!d) return "";
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const INVOICE_TITLE = {
  SALE: "Tax Invoice",
  SALE_RETURN: "Credit Note",
  PURCHASE: "Purchase Invoice",
  PURCHASE_RETURN: "Debit Note",
};

/* ---------- amount in words (Indian numbering) ---------- */
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve",
  "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const twoDigits = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`);
const threeDigits = (n) => {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? twoDigits(r) : ""].filter(Boolean).join(" ");
};
function integerWords(n) {
  if (n === 0) return "Zero";
  const parts = [];
  const crore = Math.floor(n / 10000000);
  const lakh = Math.floor((n % 10000000) / 100000);
  const thousand = Math.floor((n % 100000) / 1000);
  const rest = n % 1000;
  if (crore) parts.push(`${integerWords(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return parts.join(" ");
}
export function amountInWords(amount) {
  const v = round2(Math.abs(amount));
  const rupees = Math.floor(v);
  const paise = Math.round((v - rupees) * 100);
  return `Rupees ${integerWords(rupees)}${paise ? ` and ${twoDigits(paise)} Paise` : ""} Only`;
}

/* ---------- parties ---------- */
const businessOf = (b = {}) => ({
  name: b.shopName || b.name || "",
  address: [b.address, b.locality, b.city, b.state, b.pincode && `PIN ${b.pincode}`]
    .filter((x) => typeof x === "string" && x.trim())
    .join(", "),
  phone: b.phone || "",
  email: b.email || "",
  gstin: b.gstNumber || b.gstin || "",
  bank: b.bankDetails || {},
});

const partyOf = (p = {}) => ({
  name: p?.name || "",
  address: p?.address || "",
  phone: p?.phone || "",
  email: "",
  gstin: p?.gstin || "",
});

/* ---------- lines & tax ---------- */
// Splits a line into taxable value + CGST/SGST. `inclusive`: the amount already contains GST.
function taxLine(raw, inclusive) {
  const amount = round2(raw.amount);
  const g = Number(raw.gstPercent) || 0;
  const taxable = inclusive ? (g > 0 ? (amount * 100) / (100 + g) : amount) : amount;
  const tax = inclusive ? amount - taxable : (amount * g) / 100;
  return {
    name: raw.name || "Item",
    variant: raw.variant || "",
    quantity: Number(raw.quantity) || 0,
    rate: round2(raw.rate),
    gstPercent: g,
    taxable: round2(taxable),
    cgst: round2(tax / 2),
    sgst: round2(tax - round2(tax / 2)),
    total: round2(taxable + tax),
    // Line amount as posted on the bill (what the ledger shows).
    amount: round2(raw.amount),
  };
}

function gstSummary(items) {
  const byRate = new Map();
  items.forEach((i) => {
    const r = byRate.get(i.gstPercent) || { rate: i.gstPercent, taxable: 0, cgst: 0, sgst: 0 };
    r.taxable += i.taxable;
    r.cgst += i.cgst;
    r.sgst += i.sgst;
    byRate.set(i.gstPercent, r);
  });
  return [...byRate.values()]
    .sort((a, b) => a.rate - b.rate)
    .map((r) => ({ ...r, taxable: round2(r.taxable), cgst: round2(r.cgst), sgst: round2(r.sgst), tax: round2(r.cgst + r.sgst) }));
}

/**
 * Totals block: taxable + CGST + SGST, then discount / bill-level tax, and a
 * round-off so the grand total always equals the posted bill amount.
 */
function buildTotals(items, { grandTotal, discount = 0, billTax = null }) {
  const taxable = round2(items.reduce((s, i) => s + i.taxable, 0));
  let cgst = round2(items.reduce((s, i) => s + i.cgst, 0));
  let sgst = round2(items.reduce((s, i) => s + i.sgst, 0));
  const rows = [{ label: "Taxable value", value: taxable }];
  // Bill-level GST (no per-item rate on the lines) — show the bill's own tax.
  if (billTax != null && billTax > 0 && cgst + sgst < 0.01) {
    cgst = round2(billTax / 2);
    sgst = round2(billTax - cgst);
  }
  rows.push({ label: "CGST", value: cgst }, { label: "SGST", value: sgst });
  const gross = round2(taxable + cgst + sgst);
  if (discount > 0) rows.push({ label: "Less: Discount", value: -round2(discount) });
  const roundOff = round2(grandTotal - (gross - (discount || 0)));
  if (Math.abs(roundOff) >= 0.01) rows.push({ label: "Round off", value: roundOff });
  return { rows, taxTotal: round2(cgst + sgst) };
}

/** Ledger rows that stand for a bill/return and can be opened as an invoice. */
export const hasInvoice = (entry) => entry?.kind !== "PAYMENT" && Array.isArray(entry?.items) && entry.items.length > 0;

/** Invoice for one ledger row; `entries` lets it show what was paid against the bill. */
export function buildLedgerInvoice({ kind, entry, entries = [], party, business }) {
  const bill = entry.bill || {};
  const inclusiveOf = (i) => (i.taxInclusive !== undefined ? i.taxInclusive : bill.taxInclusive !== false);
  const items = (entry.items || []).map((i) => taxLine(i, inclusiveOf(i)));
  const grandTotal = round2(entry.amount);
  const isBill = entry.kind === "SALE" || entry.kind === "PURCHASE";
  const paid = isBill && entry.refId
    ? round2(
        entries
          .filter((e) => e.kind === "PAYMENT" && e.refModel === entry.refModel && String(e.refId) === String(entry.refId))
          .reduce((s, e) => s + Number(e.amount || 0), 0),
      )
    : 0;
  const totals = buildTotals(items, { grandTotal, discount: bill.discount || 0, billTax: bill.tax ?? null });
  // Simple view: from the items' posted amounts to the bill amount.
  const discount = round2(bill.discount || 0);
  const roundOff = round2(grandTotal - (items.reduce((s, i) => s + i.amount, 0) - discount));
  const simpleTotals = [
    ...(discount > 0 ? [{ label: "Less: Discount", value: -discount }] : []),
    ...(Math.abs(roundOff) >= 0.01 ? [{ label: "Round off", value: roundOff }] : []),
  ];

  const biz = businessOf(business);
  const other = partyOf(party);
  const isSupplierSide = kind === "suppliers";
  return {
    kind: entry.kind,
    title: INVOICE_TITLE[entry.kind] || "Invoice",
    number: entry.refNo || "",
    date: fmtDate(entry.date),
    business: biz,
    // Who issued the document vs who it is addressed to.
    billedBy: { heading: isSupplierSide ? "Billed by (Supplier)" : "Billed by", ...(isSupplierSide ? other : biz) },
    billedTo: { heading: isSupplierSide ? "Billed to" : "Billed to (Customer)", ...(isSupplierSide ? biz : other) },
    items,
    gstRows: gstSummary(items),
    totals: totals.rows,
    grandTotal,
    amountInWords: amountInWords(grandTotal),
    payment: isBill
      ? [
          { label: "Paid", value: paid },
          { label: "Balance due", value: round2(Math.max(0, grandTotal - paid)) },
        ]
      : [],
    method: entry.method || "",
    note: entry.note || "",
    showBank: entry.kind === "SALE",
    // Ledger invoices list the bill's items as posted (qty, rate, GST, amount),
    // without the tax split and payment lines.
    simple: true,
    simpleTotals,
  };
}

/** Invoice for a purchase bill as shown in Purchases. */
export function buildPurchaseBillInvoice(bill, business) {
  const items = (bill.items || []).map((i) => {
    const qty = Number(i.quantity) || 0;
    const cost = Number(i.cost) || 0;
    const gst = Number(i.gstPercent) || 0;
    const inclusive = String(i.purchaseGstType || "").toUpperCase() === "INCLUSIVE";
    const gross = Number(i.lineTotal) || (inclusive ? qty * cost : qty * cost * (1 + gst / 100));
    return taxLine({ name: i.name, variant: i.variantSku, quantity: qty, rate: cost, gstPercent: gst, amount: gross }, true);
  });
  const grandTotal = round2(bill.total);
  const paid = round2(bill.amountPaid || 0);
  const biz = businessOf(business);
  const supplier = partyOf(bill.supplier);
  return {
    kind: "PURCHASE",
    title: INVOICE_TITLE.PURCHASE,
    number: bill.billNo || "",
    date: fmtDate(bill.billDate),
    status: bill.status || "",
    business: biz,
    billedBy: { heading: "Billed by (Supplier)", ...supplier },
    billedTo: { heading: "Billed to", ...biz },
    items,
    gstRows: gstSummary(items),
    totals: buildTotals(items, { grandTotal, billTax: bill.gstTotal ?? null }).rows,
    grandTotal,
    amountInWords: amountInWords(grandTotal),
    payment: [
      { label: "Paid", value: paid },
      { label: "Balance due", value: round2(Math.max(0, grandTotal - paid)) },
    ],
    method: bill.paymentMethod || "CREDIT (Pending)",
    note: bill.note || "",
    showBank: false,
  };
}

export function invoiceFilename(inv, ext) {
  const safe = (s) => String(s || "").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "");
  const party = inv.kind === "PURCHASE" || inv.kind === "PURCHASE_RETURN" ? inv.billedBy.name : inv.billedTo.name;
  return `${safe(inv.title)}_${safe(inv.number) || "bill"}${party ? `_${safe(party)}` : ""}.${ext}`;
}

const bankLines = (bank = {}) =>
  [
    bank.bankName && `Bank: ${bank.bankName}${bank.branch ? `, ${bank.branch}` : ""}`,
    bank.accountNumber && `A/c No: ${bank.accountNumber}`,
    (bank.ifsc || bank.ifscCode) && `IFSC: ${bank.ifsc || bank.ifscCode}`,
    bank.upiId && `UPI: ${bank.upiId}`,
  ].filter(Boolean);

/* ---------------- Print (HTML) ---------------- */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const partyBlock = (p) => `<div class="box"><div class="label">${esc(p.heading)}</div>
  <div class="pname">${esc(p.name) || "Walk-in Customer"}</div>
  ${p.address ? `<div>${esc(p.address)}</div>` : ""}
  ${p.phone ? `<div>Phone: ${esc(p.phone)}</div>` : ""}
  ${p.gstin ? `<div>GSTIN: <b>${esc(p.gstin)}</b></div>` : ""}</div>`;

// Simple bill table: every item with qty, rate, GST and its posted amount.
const simpleItemsHtml = (items) => {
  const qty = items.reduce((s, i) => s + i.quantity, 0);
  const total = items.reduce((s, i) => s + i.amount, 0);
  return `<table class="items"><thead><tr><th class="c">#</th><th>Item</th><th>Variant</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">GST</th><th class="n">Amount</th></tr></thead>
<tbody>${
    items
      .map(
        (i, idx) => `<tr><td class="c">${idx + 1}</td><td>${esc(i.name)}</td><td>${esc(i.variant) || "—"}</td><td class="n">${esc(i.quantity)}</td>
<td class="n">${money(i.rate)}</td><td class="n">${i.gstPercent}%</td><td class="n b">${money(i.amount)}</td></tr>`,
      )
      .join("") || `<tr><td colspan="7" class="c muted">No items</td></tr>`
  }</tbody>
<tfoot><tr><td colspan="3">Bill total (${items.length} ${items.length === 1 ? "item" : "items"})</td><td class="n">${qty}</td><td></td><td></td><td class="n">${money(total)}</td></tr></tfoot></table>`;
};

export function invoiceHtml(inv) {
  const rows = inv.items
    .map(
      (i, idx) => `<tr><td class="c">${idx + 1}</td><td>${esc(i.name)}${i.variant ? `<div class="muted">${esc(i.variant)}</div>` : ""}</td>
<td class="n">${esc(i.quantity)}</td><td class="n">${money(i.rate)}</td><td class="n">${money(i.taxable)}</td>
<td class="n">${i.gstPercent}%</td><td class="n">${money(i.cgst)}</td><td class="n">${money(i.sgst)}</td><td class="n b">${money(i.total)}</td></tr>`,
    )
    .join("");
  const gst = inv.gstRows
    .map(
      (r) => `<tr><td class="c">${r.rate}%</td><td class="n">${money(r.taxable)}</td><td class="c">${r.rate / 2}%</td><td class="n">${money(r.cgst)}</td>
<td class="c">${r.rate / 2}%</td><td class="n">${money(r.sgst)}</td><td class="n b">${money(r.tax)}</td></tr>`,
    )
    .join("");
  const totals = (inv.simple ? inv.simpleTotals : inv.totals).map((t) => `<tr><td>${esc(t.label)}</td><td class="n">${money(t.value)}</td></tr>`).join("");
  const payment = (inv.simple ? [] : inv.payment).map((t) => `<tr><td>${esc(t.label)}</td><td class="n">${money(t.value)}</td></tr>`).join("");
  const bank = inv.showBank ? bankLines(inv.business.bank) : [];
  const biz = inv.business;
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(inv.title)} ${esc(inv.number)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:0;font-size:11px}
  .sheet{border:1px solid #0f172a;padding:0} .muted{color:#64748b;font-size:10px}
  .top{display:flex;justify-content:space-between;align-items:flex-start;padding:12px 14px;border-bottom:1px solid #0f172a}
  .shop{font-size:18px;font-weight:800;text-transform:uppercase} .title{font-size:16px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;text-align:right}
  .meta{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #0f172a} .meta div{padding:6px 14px} .meta div+div{border-left:1px solid #0f172a}
  .parties{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #0f172a} .box{padding:8px 14px;line-height:1.45} .box+.box{border-left:1px solid #0f172a}
  .label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700} .pname{font-size:13px;font-weight:800}
  table{width:100%;border-collapse:collapse} th,td{border:1px solid #94a3b8;padding:5px 6px;vertical-align:top;text-align:left}
  th{background:#e2e8f0;font-size:9.5px;text-transform:uppercase} .n{text-align:right;white-space:nowrap} .c{text-align:center} .b{font-weight:700}
  .items{border-left:none;border-right:none} .items th:first-child,.items td:first-child{border-left:none} .items th:last-child,.items td:last-child{border-right:none}
  .items tfoot td{font-weight:800;background:#f8fafc}
  .bottom{display:grid;grid-template-columns:1.3fr 1fr;border-top:1px solid #0f172a} .bottom>div{padding:8px 14px} .bottom>div+div{border-left:1px solid #0f172a}
  .sum td{border:none;padding:3px 0} .grand td{font-size:14px;font-weight:800;border-top:1.5px solid #0f172a;padding-top:6px}
  .words{padding:6px 14px;border-top:1px solid #0f172a} .sign{display:flex;justify-content:space-between;align-items:flex-end;padding:10px 14px 12px;border-top:1px solid #0f172a;min-height:72px}
  .gst{margin-top:8px} .gst th,.gst td{font-size:10px}
  @page{size:A4;margin:10mm} @media print{body{margin:0}}
</style></head><body><div class="sheet">
<div class="top">
  <div><div class="shop">${esc(biz.name) || "Invoice"}</div>
    ${biz.address ? `<div>${esc(biz.address)}</div>` : ""}
    ${biz.phone || biz.email ? `<div>${biz.phone ? `Phone: ${esc(biz.phone)}` : ""}${biz.phone && biz.email ? " · " : ""}${esc(biz.email)}</div>` : ""}
    ${biz.gstin ? `<div>GSTIN: <b>${esc(biz.gstin)}</b></div>` : ""}
  </div>
  <div class="title">${esc(inv.title)}<div class="muted" style="letter-spacing:0;text-transform:none;font-weight:400">Original for recipient</div></div>
</div>
<div class="meta">
  <div><b>Invoice No:</b> ${esc(inv.number) || "—"}</div>
  <div><b>Invoice Date:</b> ${esc(inv.date) || "—"}${inv.status ? ` &nbsp; <b>Status:</b> ${esc(inv.status)}` : ""}</div>
</div>
<div class="parties">${partyBlock(inv.billedBy)}${partyBlock(inv.billedTo)}</div>
${inv.simple ? simpleItemsHtml(inv.items) : `<table class="items"><thead><tr><th class="c">#</th><th>Item / Description</th><th class="n">Qty</th><th class="n">Rate</th><th class="n">Taxable</th><th class="n">GST</th><th class="n">CGST</th><th class="n">SGST</th><th class="n">Amount</th></tr></thead>
<tbody>${rows || `<tr><td colspan="9" class="c muted">No items</td></tr>`}</tbody>
<tfoot><tr><td colspan="2">Total</td><td class="n">${inv.items.reduce((s, i) => s + i.quantity, 0)}</td><td></td>
<td class="n">${money(inv.items.reduce((s, i) => s + i.taxable, 0))}</td><td></td>
<td class="n">${money(inv.items.reduce((s, i) => s + i.cgst, 0))}</td><td class="n">${money(inv.items.reduce((s, i) => s + i.sgst, 0))}</td>
<td class="n">${money(inv.items.reduce((s, i) => s + i.total, 0))}</td></tr></tfoot></table>`}
<div class="bottom">
  <div>
    ${gst && !inv.simple ? `<div class="label">GST summary</div><table class="gst"><thead><tr><th class="c">Rate</th><th class="n">Taxable</th><th class="c">CGST %</th><th class="n">CGST</th><th class="c">SGST %</th><th class="n">SGST</th><th class="n">Total tax</th></tr></thead><tbody>${gst}</tbody></table>` : ""}
    <div style="margin-top:8px">${inv.method ? `<div><b>Payment mode:</b> ${esc(inv.method)}</div>` : ""}${inv.note ? `<div><b>Note:</b> ${esc(inv.note)}</div>` : ""}
    ${bank.length ? `<div style="margin-top:6px"><div class="label">Bank details</div>${bank.map((l) => `<div>${esc(l)}</div>`).join("")}</div>` : ""}</div>
  </div>
  <div>
    <table class="sum"><tbody>${totals}<tr class="grand"><td>Grand Total</td><td class="n">₹${money(inv.grandTotal)}</td></tr>${payment}</tbody></table>
  </div>
</div>
<div class="words"><b>Amount in words:</b> ${esc(inv.amountInWords)}</div>
<div class="sign">
  <div class="muted" style="max-width:55%">Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.<br/>This is a computer-generated invoice.</div>
  <div style="text-align:right"><div class="b">For ${esc(biz.name)}</div><div style="height:30px"></div><div class="muted">Authorised Signatory</div></div>
</div>
</div></body></html>`;
}

export function printInvoice(inv) {
  printHtml(invoiceHtml(inv));
}

/* ---------------- PDF ---------------- */

export async function downloadInvoicePdf(inv) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 28;
  const R = W - M;
  const CW = R - M;
  // Built-in PDF fonts have no ₹ glyph, so amounts use "Rs.".
  const rs = (v) => `Rs. ${money(v)}`;
  const DARK = [15, 23, 42];
  const MUTED = [100, 116, 139];
  const LINE = [148, 163, 184];
  const font = (style = "normal", size = 9, color = DARK) => doc.setFont("helvetica", style).setFontSize(size).setTextColor(...color);
  const hline = (y, x1 = M, x2 = R, w = 0.6, c = DARK) => doc.setDrawColor(...c).setLineWidth(w).line(x1, y, x2, y);
  const vline = (x, y1, y2, w = 0.6, c = DARK) => doc.setDrawColor(...c).setLineWidth(w).line(x, y1, x, y2);

  const top = M;
  let y = top + 20;

  // --- Header: issuer + document title ---
  const biz = inv.business;
  font("bold", 15);
  doc.text(String(biz.name || "Invoice").toUpperCase(), M + 10, y);
  font("bold", 13);
  doc.text(inv.title.toUpperCase(), R - 10, y, { align: "right" });
  font("normal", 7.5, MUTED);
  doc.text("Original for recipient", R - 10, y + 11, { align: "right" });
  font("normal", 8.5);
  const bizLines = [
    ...doc.splitTextToSize(biz.address || "", CW * 0.6),
    [biz.phone && `Phone: ${biz.phone}`, biz.email].filter(Boolean).join("  |  "),
    biz.gstin && `GSTIN: ${biz.gstin}`,
  ].filter(Boolean);
  bizLines.forEach((l) => {
    y += 11;
    doc.text(String(l), M + 10, y);
  });
  y += 10;
  hline(y);

  // --- Invoice no / date ---
  const metaTop = y;
  y += 14;
  font("bold", 9);
  doc.text("Invoice No:", M + 10, y);
  doc.text("Invoice Date:", M + CW / 2 + 10, y);
  font("normal", 9);
  doc.text(String(inv.number || "-"), M + 70, y);
  doc.text(`${inv.date || "-"}${inv.status ? `    Status: ${inv.status}` : ""}`, M + CW / 2 + 78, y);
  y += 8;
  vline(M + CW / 2, metaTop, y);
  hline(y);

  // --- Billed by / Billed to ---
  const partyTop = y;
  const drawParty = (p, x) => {
    let yy = partyTop + 13;
    font("bold", 7.5, MUTED);
    doc.text(String(p.heading).toUpperCase(), x, yy);
    yy += 13;
    font("bold", 10.5);
    doc.text(String(p.name || "Walk-in Customer"), x, yy);
    font("normal", 8.5);
    [...doc.splitTextToSize(p.address || "", CW / 2 - 24), p.phone && `Phone: ${p.phone}`, p.gstin && `GSTIN: ${p.gstin}`]
      .filter(Boolean)
      .forEach((l) => {
        yy += 11;
        doc.text(String(l), x, yy);
      });
    return yy;
  };
  const partyBottom = Math.max(drawParty(inv.billedBy, M + 10), drawParty(inv.billedTo, M + CW / 2 + 10)) + 9;
  vline(M + CW / 2, partyTop, partyBottom);
  y = partyBottom;
  hline(y);

  // --- Items table ---
  const cols = inv.simple
    ? [
        { label: "#", w: 22, align: "center" },
        { label: "Item", w: 0 },
        { label: "Variant", w: 90 },
        { label: "Qty", w: 40, num: true },
        { label: "Rate", w: 64, num: true },
        { label: "GST", w: 40, num: true },
        { label: "Amount", w: 74, num: true },
      ]
    : [
        { label: "#", w: 22, align: "center" },
        { label: "Item / Description", w: 0 },
        { label: "Qty", w: 34, num: true },
        { label: "Rate", w: 54, num: true },
        { label: "Taxable", w: 60, num: true },
        { label: "GST", w: 32, num: true },
        { label: "CGST", w: 48, num: true },
        { label: "SGST", w: 48, num: true },
        { label: "Amount", w: 62, num: true },
      ];
  cols[1].w = CW - cols.reduce((s, c) => s + c.w, 0);
  const colX = [];
  cols.reduce((x, c) => {
    colX.push(x);
    return x + c.w;
  }, M);
  const cellText = (ci, text, yy) => {
    const c = cols[ci];
    const x = colX[ci];
    if (c.num) doc.text(text, x + c.w - 4, yy, { align: "right" });
    else if (c.align === "center") doc.text(text, x + c.w / 2, yy, { align: "center" });
    else doc.text(text, x + 4, yy);
  };
  const tableHeader = () => {
    doc.setFillColor(226, 232, 240).rect(M, y, CW, 18, "F");
    font("bold", 7.5);
    cols.forEach((c, ci) => cellText(ci, c.label.toUpperCase(), y + 12));
    y += 18;
    hline(y, M, R, 0.5, LINE);
  };
  const pageBreak = (need) => {
    if (y + need <= H - M - 10) return false;
    doc.setDrawColor(...DARK).setLineWidth(0.8).rect(M, top, CW, y - top);
    doc.addPage();
    y = M + 10;
    font("normal", 8, MUTED);
    doc.text(`${inv.title} ${inv.number} (continued)`, M, y);
    y += 8;
    return true;
  };
  tableHeader();
  inv.items.forEach((it, idx) => {
    font("normal", 8.5);
    const nameLines = doc.splitTextToSize(inv.simple ? String(it.name) : `${it.name}${it.variant ? ` (${it.variant})` : ""}`, cols[1].w - 8);
    const h = nameLines.length * 10 + 8;
    if (pageBreak(h)) tableHeader();
    font("normal", 8.5);
    const yy = y + 12;
    cellText(0, String(idx + 1), yy);
    doc.text(nameLines, colX[1] + 4, yy);
    if (inv.simple) {
      cellText(2, doc.splitTextToSize(String(it.variant || "-"), cols[2].w - 8)[0], yy);
      cellText(3, String(it.quantity), yy);
      cellText(4, money(it.rate), yy);
      cellText(5, `${it.gstPercent}%`, yy);
      font("bold", 8.5);
      cellText(6, money(it.amount), yy);
      y += h;
      hline(y, M, R, 0.4, LINE);
      return;
    }
    cellText(2, String(it.quantity), yy);
    cellText(3, money(it.rate), yy);
    cellText(4, money(it.taxable), yy);
    cellText(5, `${it.gstPercent}%`, yy);
    cellText(6, money(it.cgst), yy);
    cellText(7, money(it.sgst), yy);
    font("bold", 8.5);
    cellText(8, money(it.total), yy);
    y += h;
    hline(y, M, R, 0.4, LINE);
  });
  // Totals row
  pageBreak(20);
  doc.setFillColor(248, 250, 252).rect(M, y, CW, 17, "F");
  font("bold", 8.5);
  const sum = (k) => inv.items.reduce((s, i) => s + i[k], 0);
  if (inv.simple) {
    cellText(1, `Bill total (${inv.items.length} ${inv.items.length === 1 ? "item" : "items"})`, y + 12);
    cellText(3, String(sum("quantity")), y + 12);
    cellText(6, money(sum("amount")), y + 12);
  } else {
    cellText(1, "Total", y + 12);
    cellText(2, String(sum("quantity")), y + 12);
    cellText(4, money(sum("taxable")), y + 12);
    cellText(6, money(sum("cgst")), y + 12);
    cellText(7, money(sum("sgst")), y + 12);
    cellText(8, money(sum("total")), y + 12);
  }
  y += 17;
  hline(y);

  // --- Bottom: GST summary + payment (left) | totals (right) ---
  const leftW = CW * 0.58;
  const splitX = M + leftW;
  const bankRows = inv.showBank ? bankLines(inv.business.bank) : [];
  // The simple ledger invoice shows only the grand total under its items.
  const gstRows = inv.simple ? [] : inv.gstRows;
  const totalRows = inv.simple ? inv.simpleTotals : inv.totals;
  const paymentRows = inv.simple ? [] : inv.payment;
  const gstH = gstRows.length ? 30 + gstRows.length * 13 : 0;
  const rightH = 14 + totalRows.length * 13 + 22 + paymentRows.length * 13;
  const leftH = gstH + 14 + (inv.method ? 12 : 0) + (inv.note ? 12 : 0) + (bankRows.length ? 14 + bankRows.length * 11 : 0);
  pageBreak(Math.max(leftH, rightH) + 120);
  const bottomTop = y;

  let ly = y + 14;
  if (gstRows.length) {
    font("bold", 7.5, MUTED);
    doc.text("GST SUMMARY", M + 10, ly);
    ly += 6;
    const g = [
      { label: "Rate", w: 36, a: "center" },
      { label: "Taxable", w: 64 },
      { label: "CGST", w: 52 },
      { label: "SGST", w: 52 },
      { label: "Total tax", w: leftW - 20 - 204 },
    ];
    let gx = M + 10;
    doc.setFillColor(226, 232, 240).rect(gx, ly, leftW - 20, 14, "F");
    font("bold", 7.5);
    const gxs = g.map((c) => {
      const x = gx;
      gx += c.w;
      return x;
    });
    g.forEach((c, i) =>
      c.a ? doc.text(c.label.toUpperCase(), gxs[i] + c.w / 2, ly + 10, { align: "center" }) : doc.text(c.label.toUpperCase(), gxs[i] + c.w - 4, ly + 10, { align: "right" }),
    );
    ly += 14;
    font("normal", 8);
    gstRows.forEach((r) => {
      const vals = [`${r.rate}%`, money(r.taxable), `${money(r.cgst)} (${r.rate / 2}%)`, `${money(r.sgst)} (${r.rate / 2}%)`, money(r.tax)];
      vals.forEach((v, i) =>
        g[i].a ? doc.text(v, gxs[i] + g[i].w / 2, ly + 10, { align: "center" }) : doc.text(v, gxs[i] + g[i].w - 4, ly + 10, { align: "right" }),
      );
      ly += 13;
      hline(ly, M + 10, M + leftW - 10, 0.3, LINE);
    });
    ly += 12;
  }
  font("normal", 8.5);
  if (inv.method) {
    font("bold", 8.5);
    doc.text("Payment mode:", M + 10, ly);
    font("normal", 8.5);
    doc.text(String(inv.method), M + 82, ly);
    ly += 12;
  }
  if (inv.note) {
    const noteLines = doc.splitTextToSize(`Note: ${inv.note}`, leftW - 20);
    doc.text(noteLines, M + 10, ly);
    ly += noteLines.length * 11;
  }
  if (bankRows.length) {
    ly += 4;
    font("bold", 7.5, MUTED);
    doc.text("BANK DETAILS", M + 10, ly);
    font("normal", 8.5);
    bankRows.forEach((l) => {
      ly += 11;
      doc.text(l, M + 10, ly);
    });
    ly += 6;
  }

  let ry = y + 16;
  const rx1 = splitX + 10;
  const rx2 = R - 10;
  font("normal", 9);
  totalRows.forEach((t) => {
    doc.text(t.label, rx1, ry);
    doc.text(money(t.value), rx2, ry, { align: "right" });
    ry += 13;
  });
  hline(ry - 6, rx1, rx2, 1);
  ry += 8;
  font("bold", 11.5);
  doc.text("Grand Total", rx1, ry);
  doc.text(rs(inv.grandTotal), rx2, ry, { align: "right" });
  ry += 16;
  font("normal", 9);
  paymentRows.forEach((t) => {
    doc.text(t.label, rx1, ry);
    doc.text(money(t.value), rx2, ry, { align: "right" });
    ry += 13;
  });

  y = Math.max(ly, ry) + 2;
  vline(splitX, bottomTop, y);
  hline(y);

  // --- Amount in words ---
  y += 14;
  font("bold", 8.5);
  doc.text("Amount in words:", M + 10, y);
  font("normal", 8.5);
  const words = doc.splitTextToSize(inv.amountInWords, CW - 110);
  doc.text(words, M + 94, y);
  y += words.length * 11 - 2;
  hline(y);

  // --- Declaration + signatory ---
  const signTop = y;
  font("normal", 7.5, MUTED);
  const decl = doc.splitTextToSize(
    "Declaration: We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. This is a computer-generated invoice.",
    CW * 0.55,
  );
  doc.text(decl, M + 10, y + 14);
  font("bold", 9);
  doc.text(`For ${biz.name || ""}`, R - 10, y + 14, { align: "right" });
  font("normal", 8, MUTED);
  doc.text("Authorised Signatory", R - 10, y + 58, { align: "right" });
  y = Math.max(y + 68, signTop + decl.length * 9 + 22);

  // Outer frame for the (last) page
  doc.setDrawColor(...DARK).setLineWidth(0.8).rect(M, doc.getNumberOfPages() > 1 ? M + 18 : top, CW, y - (doc.getNumberOfPages() > 1 ? M + 18 : top));

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    font("normal", 7, [148, 163, 184]);
    doc.text(`Page ${p} of ${pages}`, R, H - 14, { align: "right" });
  }
  doc.save(invoiceFilename(inv, "pdf"));
}
