import { buildXlsx, downloadBlob } from "@shared/utils/xlsxWriter";

/**
 * Ledger statement export: print, PDF and Excel from the same model, so the
 * three always agree with what the seller sees on screen (the server's
 * chronological entries with running balance).
 */

export const LEDGER_KIND_LABEL = {
  SALE: "Sale",
  SALE_RETURN: "Sale Return",
  PURCHASE: "Purchase",
  PURCHASE_RETURN: "Purchase Return",
  PAYMENT: "Payment",
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const fmtDate = (d) => {
  if (!d) return "";
  const date = new Date(d);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
const money = (n) =>
  round2(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const itemSummary = (items = []) =>
  items
    .map((i) => `${i.name || "Item"}${i.variant ? ` (${i.variant})` : ""} x${i.quantity}`)
    .join(", ");

/** Positive balance = customer owes the store / store owes the supplier. */
export function balanceLabel(kind, balance) {
  const b = round2(balance);
  if (b === 0) return "Settled";
  if (kind === "suppliers") return b > 0 ? "Payable to supplier" : "Advance with supplier";
  return b > 0 ? "Receivable from customer" : "Advance from customer";
}

// `range` ({ from, to } YYYY-MM-DD) is the seller's date filter; with it the
// statement opens on the brought-forward balance and closes at the range end.
export function buildStatement({ kind, party, entries = [], balance = 0, business = {}, openingBalance = 0, range = null }) {
  const rows = entries.map((e) => ({
    date: fmtDate(e.date),
    // Voided pairs stay on the statement (they net to zero) so edits remain traceable.
    type: `${LEDGER_KIND_LABEL[e.kind] || e.kind || ""}${e.voided ? (e.reverses ? " (reversal)" : " (voided)") : ""}`,
    billNo: e.refNo || "",
    details: e.kind === "PAYMENT" ? e.note || "Payment" : itemSummary(e.items) || e.note || "",
    method: e.method || "",
    debit: e.effect === 1 ? round2(e.amount) : null,
    credit: e.effect === -1 ? round2(e.amount) : null,
    balance: round2(e.balance),
    items: e.kind === "PAYMENT" ? [] : e.items || [],
  }));
  // Short form of Details (item count) for compact views.
  rows.forEach((r) => {
    r.shortDetails = r.items.length
      ? `${r.items.length} ${r.items.length === 1 ? "item" : "items"}`
      : r.details;
  });
  const totalDebit = round2(rows.reduce((s, r) => s + (r.debit || 0), 0));
  const totalCredit = round2(rows.reduce((s, r) => s + (r.credit || 0), 0));
  if (range?.from) {
    rows.unshift({
      date: fmtDate(`${range.from}T00:00:00`),
      type: "Opening Balance",
      billNo: "",
      details: "Balance brought forward",
      shortDetails: "Balance brought forward",
      method: "",
      debit: null,
      credit: null,
      balance: round2(openingBalance),
      items: [],
    });
  }
  const filtered = Boolean(range?.from || range?.to);
  const period = filtered
    ? `${range.from ? fmtDate(`${range.from}T00:00:00`) : "Start"} – ${range.to ? fmtDate(`${range.to}T00:00:00`) : "Today"}`
    : rows.length
      ? `${rows[0].date} – ${rows[rows.length - 1].date}`
      : "";
  return {
    title: kind === "suppliers" ? "Supplier Ledger Statement" : "Customer Ledger Statement",
    business: {
      name: business.shopName || business.name || "",
      address: [business.address, business.locality, business.city, business.state, business.pincode && `PIN ${business.pincode}`]
        .filter((x) => typeof x === "string" && x.trim())
        .join(", "),
      phone: business.phone || "",
    },
    party: { name: party?.name || "", phone: party?.phone || "", address: party?.address || "", gstin: party?.gstin || "" },
    generatedAt: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    period,
    rows,
    totalDebit,
    totalCredit,
    closingBalance: round2(balance),
    closingLabel: balanceLabel(kind, balance),
  };
}

export function statementFilename(statement, ext) {
  const name = (statement.party.name || "party").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "");
  const day = new Date().toISOString().slice(0, 10);
  return `${statement.title.replace(/\s+/g, "_")}_${name}_${day}.${ext}`;
}

/* ---------------- Excel ---------------- */

export function statementToXlsx(st) {
  const bold = (v) => ({ v, bold: true });
  const m = (v) => (v === null || v === undefined ? null : { v, money: true });
  const statement = [
    [bold(st.title)],
    [st.business.name, st.business.phone ? `Ph: ${st.business.phone}` : null],
    st.business.address ? [st.business.address] : [],
    [],
    [bold("Party"), st.party.name],
    st.party.phone ? [bold("Phone"), st.party.phone] : [],
    st.party.gstin ? [bold("GSTIN"), st.party.gstin] : [],
    [bold("Period"), st.period || "—"],
    [bold("Generated"), st.generatedAt],
    [],
    ["Date", "Type", "Bill No", "Details", "Method", "Debit", "Credit", "Balance"].map(bold),
    ...st.rows.map((r) => [r.date, r.type, r.billNo, r.details, r.method, m(r.debit), m(r.credit), m(r.balance)]),
    [],
    [bold("Total"), null, null, null, null, { v: st.totalDebit, money: true, bold: true }, { v: st.totalCredit, money: true, bold: true }, null],
    [bold("Closing balance"), null, null, null, null, null, null, { v: st.closingBalance, money: true, bold: true }],
    [bold(st.closingLabel)],
  ];
  const itemRows = [
    ["Date", "Bill No", "Type", "Product", "Variant", "Qty", "Rate", "GST %", "Amount"].map(bold),
    ...st.rows.flatMap((r) =>
      r.items.map((i) => [
        r.date, r.billNo, r.type, i.name || "", i.variant || "",
        Number(i.quantity) || 0, m(Number(i.rate) || 0), Number(i.gstPercent) || 0, m(Number(i.amount) || 0),
      ]),
    ),
  ];
  return buildXlsx([
    { name: "Statement", columns: [14, 16, 16, 48, 10, 14, 14, 14], rows: statement },
    { name: "Bill items", columns: [14, 16, 16, 34, 16, 8, 12, 8, 14], rows: itemRows },
  ]);
}

export function downloadStatementXlsx(st) {
  downloadBlob(statementToXlsx(st), statementFilename(st, "xlsx"));
}

/* ---------------- Print (HTML) ---------------- */

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function statementHtml(st) {
  const cell = (v) => (v === null || v === undefined ? "—" : money(v));
  const body = st.rows
    .map(
      // Ledger lines only; a bill's items are on its own invoice.
      (r) => `<tr class="row"><td>${esc(r.date)}</td><td>${esc(r.type)}</td><td>${esc(r.billNo) || "—"}</td>
<td>${esc(r.method) || "—"}</td><td class="n">${cell(r.debit)}</td><td class="n">${cell(r.credit)}</td><td class="n b">${cell(r.balance)}</td></tr>`,
    )
    .join("");
  const party = st.party;
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(st.title)} - ${esc(party.name)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:0;font-size:11px}
  .sheet{border:1px solid #0f172a} .muted{color:#64748b}
  .title{text-align:center;font-size:16px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;padding:8px;border-bottom:1px solid #0f172a;background:#f1f5f9}
  .head{display:grid;grid-template-columns:1fr 1fr;border-bottom:1px solid #0f172a} .head>div{padding:8px 12px;line-height:1.5} .head>div+div{border-left:1px solid #0f172a}
  .label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#64748b;font-weight:700} .pname{font-size:13px;font-weight:800}
  .strip{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #0f172a} .strip>div{padding:6px 12px} .strip>div+div{border-left:1px solid #0f172a} .strip b{display:block;font-size:13px}
  table{width:100%;border-collapse:collapse} th,td{border:1px solid #94a3b8;padding:5px 6px;vertical-align:top;text-align:left}
  .main>thead th{background:#0f172a;color:#fff;font-size:9.5px;text-transform:uppercase;letter-spacing:.03em;border-color:#0f172a}
  .main{border-left:none;border-right:none} .main>tbody>tr>td:first-child,.main>thead>tr>th:first-child,.main>tfoot>tr>td:first-child{border-left:none}
  .main>tbody>tr>td:last-child,.main>thead>tr>th:last-child,.main>tfoot>tr>td:last-child{border-right:none}
  .row td{background:#fff}
  .n{text-align:right;white-space:nowrap} .c{text-align:center} .b{font-weight:700}
  .main>tfoot td{font-weight:800;background:#e2e8f0}
  .closing{padding:8px 12px;text-align:right;font-size:13px;font-weight:800;border-top:1px solid #0f172a}
  .foot{padding:6px 12px;border-top:1px solid #0f172a;font-size:9px;color:#64748b;display:flex;justify-content:space-between}
  @page{size:A4;margin:10mm} @media print{body{margin:0} tr{page-break-inside:avoid}}
</style></head><body><div class="sheet">
<div class="title">${esc(st.title)}</div>
<div class="head">
  <div><div class="label">Business</div><div class="pname">${esc(st.business.name)}</div>
    ${st.business.address ? `<div>${esc(st.business.address)}</div>` : ""}
    ${st.business.phone ? `<div>Phone: ${esc(st.business.phone)}</div>` : ""}
  </div>
  <div><div class="label">${st.title.startsWith("Supplier") ? "Supplier" : "Customer"}</div><div class="pname">${esc(party.name)}</div>
    ${party.address ? `<div>${esc(party.address)}</div>` : ""}
    ${party.phone ? `<div>Phone: ${esc(party.phone)}</div>` : ""}
    ${party.gstin ? `<div>GSTIN: <b>${esc(party.gstin)}</b></div>` : ""}
  </div>
</div>
<div class="strip">
  <div><span class="label">Period</span><b>${esc(st.period || "—")}</b></div>
  <div><span class="label">Total debit</span><b>₹${money(st.totalDebit)}</b></div>
  <div><span class="label">Total credit</span><b>₹${money(st.totalCredit)}</b></div>
  <div><span class="label">Closing balance</span><b>₹${money(st.closingBalance)}</b></div>
</div>
<table class="main"><thead><tr><th>Date</th><th>Type</th><th>Bill No</th><th>Mode</th><th class="n">Debit (₹)</th><th class="n">Credit (₹)</th><th class="n">Balance (₹)</th></tr></thead>
<tbody>${body || `<tr><td colspan="7" class="muted c">No transactions</td></tr>`}</tbody>
<tfoot><tr><td colspan="4">Total</td><td class="n">${money(st.totalDebit)}</td><td class="n">${money(st.totalCredit)}</td><td class="n">${money(st.closingBalance)}</td></tr></tfoot></table>
<div class="closing">Closing balance: ₹${money(st.closingBalance)} <span class="muted">(${esc(st.closingLabel)})</span></div>
<div class="foot"><span>Generated: ${esc(st.generatedAt)}</span><span>This is a computer-generated statement.</span></div>
</div></body></html>`;
}

/** Prints via a hidden iframe (no pop-up blockers, the app page stays as is). */
export function printStatement(st) {
  printHtml(statementHtml(st));
}

/** Prints a standalone HTML document in a hidden iframe, so only that document is printed. */
export function printHtml(html) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  const done = () => setTimeout(() => frame.remove(), 1000);
  frame.contentWindow.onafterprint = done;
  setTimeout(() => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    // Some browsers never fire afterprint; clean up anyway.
    setTimeout(done, 60000);
  }, 50);
}

/* ---------------- PDF ---------------- */

export async function downloadStatementPdf(st) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 28;
  const R = W - M;
  const CW = R - M;
  const BOTTOM = H - M - 18;
  const DARK = [15, 23, 42];
  const MUTED = [100, 116, 139];
  const GRID = [148, 163, 184];
  const font = (style = "normal", size = 8.5, color = DARK) => doc.setFont("helvetica", style).setFontSize(size).setTextColor(...color);
  const box = (x, y, w, h, fill) => {
    if (fill) doc.setFillColor(...fill).rect(x, y, w, h, "F");
    doc.setDrawColor(...GRID).setLineWidth(0.5).rect(x, y, w, h);
  };
  // Built-in PDF fonts have no ₹ glyph, so amounts use "Rs." / plain numbers under "(Rs.)" headers.
  const amt = (v) => (v === null || v === undefined ? "-" : money(v));

  // Text inside a column: left, right (num) or centred.
  const put = (text, x, w, y, align = "left") => {
    if (align === "right") doc.text(text, x + w - 4, y, { align: "right" });
    else if (align === "center") doc.text(text, x + w / 2, y, { align: "center" });
    else doc.text(text, x + 4, y);
  };
  const layout = (cols, x0, width) => {
    const fixed = cols.reduce((s, c) => s + (c.w || 0), 0);
    let x = x0;
    return cols.map((c) => {
      const w = c.w || width - fixed;
      const out = { ...c, x, w };
      x += w;
      return out;
    });
  };

  let y = M;

  /* --- title + business / party --- */
  box(M, y, CW, 24, [241, 245, 249]);
  font("bold", 13);
  doc.text(st.title.toUpperCase(), W / 2, y + 16, { align: "center" });
  y += 24;
  const partyHeading = st.title.startsWith("Supplier") ? "SUPPLIER" : "CUSTOMER";
  const left = [st.business.address, st.business.phone && `Phone: ${st.business.phone}`].filter(Boolean);
  const right = [st.party.address, st.party.phone && `Phone: ${st.party.phone}`, st.party.gstin && `GSTIN: ${st.party.gstin}`].filter(Boolean);
  const leftLines = left.flatMap((l) => doc.splitTextToSize(String(l), CW / 2 - 20));
  const rightLines = right.flatMap((l) => doc.splitTextToSize(String(l), CW / 2 - 20));
  const headH = 34 + Math.max(leftLines.length, rightLines.length, 1) * 11;
  box(M, y, CW / 2, headH);
  box(M + CW / 2, y, CW / 2, headH);
  const drawParty = (label, name, lines, x) => {
    font("bold", 7, MUTED);
    doc.text(label, x, y + 12);
    font("bold", 10.5);
    doc.text(String(name || "-"), x, y + 25);
    font("normal", 8.5);
    lines.forEach((l, i) => doc.text(l, x, y + 37 + i * 11));
  };
  drawParty("BUSINESS", st.business.name, leftLines, M + 10);
  drawParty(partyHeading, st.party.name, rightLines, M + CW / 2 + 10);
  y += headH;

  /* --- summary strip --- */
  const strip = [
    ["PERIOD", st.period || "-"],
    ["TOTAL DEBIT", `Rs. ${money(st.totalDebit)}`],
    ["TOTAL CREDIT", `Rs. ${money(st.totalCredit)}`],
    ["CLOSING BALANCE", `Rs. ${money(st.closingBalance)}`],
  ];
  const sw = CW / 4;
  strip.forEach(([label, value], i) => {
    box(M + i * sw, y, sw, 32);
    font("bold", 6.8, MUTED);
    doc.text(label, M + i * sw + 8, y + 11);
    font("bold", i === 3 ? 10 : 9);
    doc.text(doc.splitTextToSize(String(value), sw - 14)[0], M + i * sw + 8, y + 25);
  });
  y += 32 + 10;

  /* --- main ledger table --- */
  const main = layout(
    [
      { key: "date", label: "Date", w: 58 },
      { key: "type", label: "Type", w: 62 },
      { key: "billNo", label: "Bill No" },
      { key: "method", label: "Mode", w: 60 },
      { key: "debit", label: "Debit (Rs.)", w: 80, align: "right", money: true },
      { key: "credit", label: "Credit (Rs.)", w: 80, align: "right", money: true },
      { key: "balance", label: "Balance (Rs.)", w: 84, align: "right", money: true },
    ],
    M,
    CW,
  );
  const mainHeader = () => {
    doc.setFillColor(...DARK).rect(M, y, CW, 18, "F");
    font("bold", 7.5, [255, 255, 255]);
    main.forEach((c) => put(c.label.toUpperCase(), c.x, c.w, y + 12, c.align));
    y += 18;
  };
  const newPage = () => {
    doc.addPage();
    y = M;
    font("normal", 7.5, MUTED);
    doc.text(`${st.title} — ${st.party.name} (continued)`, M, y + 8);
    y += 14;
    mainHeader();
  };
  const ensure = (h) => {
    if (y + h > BOTTOM) newPage();
  };

  mainHeader();
  if (!st.rows.length) {
    box(M, y, CW, 20);
    font("normal", 8.5, MUTED);
    doc.text("No transactions", W / 2, y + 13, { align: "center" });
    y += 20;
  }

  // Ledger lines only; a bill's items are on its own invoice.
  st.rows.forEach((r) => {
    const rowH = 18;
    ensure(rowH);
    main.forEach((c) => box(c.x, y, c.w, rowH));
    main.forEach((c) => {
      font(c.key === "balance" ? "bold" : "normal", 8.5);
      put(c.money ? amt(r[c.key]) : String(r[c.key] || "-"), c.x, c.w, y + 12, c.align);
    });
    y += rowH;
  });

  /* --- totals --- */
  ensure(56);
  const totalH = 18;
  main.forEach((c) => box(c.x, y, c.w, totalH, [226, 232, 240]));
  font("bold", 8.5);
  put("TOTAL", main[0].x, main[0].w + main[1].w, y + 12);
  put(money(st.totalDebit), main[4].x, main[4].w, y + 12, "right");
  put(money(st.totalCredit), main[5].x, main[5].w, y + 12, "right");
  put(money(st.closingBalance), main[6].x, main[6].w, y + 12, "right");
  y += totalH + 8;

  box(M + CW / 2, y, CW / 2, 30, [241, 245, 249]);
  font("bold", 10.5);
  doc.text(`Closing balance: Rs. ${money(st.closingBalance)}`, R - 8, y + 13, { align: "right" });
  font("normal", 8, MUTED);
  doc.text(`(${st.closingLabel})`, R - 8, y + 24, { align: "right" });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    font("normal", 7, [148, 163, 184]);
    doc.text(`Generated: ${st.generatedAt}  ·  Computer-generated statement`, M, H - 14);
    doc.text(`Page ${p} of ${pages}`, R, H - 14, { align: "right" });
  }
  doc.save(statementFilename(st, "pdf"));
}
