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

export function buildStatement({ kind, party, entries = [], balance = 0, business = {} }) {
  const rows = entries.map((e) => ({
    date: fmtDate(e.date),
    type: LEDGER_KIND_LABEL[e.kind] || e.kind || "",
    billNo: e.refNo || "",
    details: e.kind === "PAYMENT" ? e.note || "Payment" : itemSummary(e.items) || e.note || "",
    method: e.method || "",
    debit: e.effect === 1 ? round2(e.amount) : null,
    credit: e.effect === -1 ? round2(e.amount) : null,
    balance: round2(e.balance),
    items: e.kind === "PAYMENT" ? [] : e.items || [],
  }));
  // Print/PDF list each item under its bill, so the Details cell just counts them.
  rows.forEach((r) => {
    r.shortDetails = r.items.length
      ? `${r.items.length} ${r.items.length === 1 ? "item" : "items"}`
      : r.details;
  });
  const totalDebit = round2(rows.reduce((s, r) => s + (r.debit || 0), 0));
  const totalCredit = round2(rows.reduce((s, r) => s + (r.credit || 0), 0));
  return {
    title: kind === "suppliers" ? "Supplier Ledger Statement" : "Customer Ledger Statement",
    business: {
      name: business.shopName || business.name || "",
      address: typeof business.address === "string" ? business.address : "",
      phone: business.phone || "",
    },
    party: { name: party?.name || "", phone: party?.phone || "", address: party?.address || "", gstin: party?.gstin || "" },
    generatedAt: new Date().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }),
    period: rows.length ? `${rows[0].date} – ${rows[rows.length - 1].date}` : "",
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
  const cell = (v) => (v === null || v === undefined ? "—" : `₹${money(v)}`);
  const body = st.rows
    .map(
      (r) => `<tr>
  <td>${esc(r.date)}</td><td>${esc(r.type)}</td><td>${esc(r.billNo) || "—"}</td>
  <td>${esc(r.shortDetails) || "—"}${
    r.items.length
      ? `<div class="items">${r.items
          .map((i) => `${esc(i.name)}${i.variant ? ` (${esc(i.variant)})` : ""} — ${esc(i.quantity)} × ₹${money(i.rate)} = ₹${money(i.amount)}`)
          .join("<br/>")}</div>`
      : ""
  }</td>
  <td>${esc(r.method) || "—"}</td><td class="n">${cell(r.debit)}</td><td class="n">${cell(r.credit)}</td><td class="n b">${cell(r.balance)}</td>
</tr>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(st.title)} - ${esc(st.party.name)}</title>
<style>
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#0f172a;margin:24px;font-size:12px}
  h1{font-size:18px;margin:0 0 4px} .muted{color:#64748b} .head{display:flex;justify-content:space-between;gap:16px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse;margin-top:8px} th,td{border:1px solid #cbd5e1;padding:6px 8px;vertical-align:top;text-align:left}
  th{background:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:.03em} .n{text-align:right;white-space:nowrap} .b{font-weight:700}
  .items{margin-top:4px;color:#475569;font-size:10.5px} tfoot td{font-weight:700;background:#f8fafc}
  .closing{margin-top:12px;text-align:right;font-size:14px;font-weight:700} @page{size:A4;margin:12mm} @media print{body{margin:0}}
</style></head><body>
<div class="head">
  <div><h1>${esc(st.title)}</h1>
    <div><b>${esc(st.business.name)}</b></div>
    ${st.business.address ? `<div class="muted">${esc(st.business.address)}</div>` : ""}
    ${st.business.phone ? `<div class="muted">Ph: ${esc(st.business.phone)}</div>` : ""}
  </div>
  <div style="text-align:right">
    <div><b>${esc(st.party.name)}</b></div>
    ${st.party.phone ? `<div class="muted">Ph: ${esc(st.party.phone)}</div>` : ""}
    ${st.party.gstin ? `<div class="muted">GSTIN: ${esc(st.party.gstin)}</div>` : ""}
    <div class="muted">Period: ${esc(st.period || "—")}</div>
    <div class="muted">Generated: ${esc(st.generatedAt)}</div>
  </div>
</div>
<table><thead><tr><th>Date</th><th>Type</th><th>Bill No</th><th>Details</th><th>Method</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th></tr></thead>
<tbody>${body || `<tr><td colspan="8" class="muted" style="text-align:center">No transactions</td></tr>`}</tbody>
<tfoot><tr><td colspan="5">Total</td><td class="n">₹${money(st.totalDebit)}</td><td class="n">₹${money(st.totalCredit)}</td><td></td></tr></tfoot></table>
<div class="closing">Closing balance: ₹${money(st.closingBalance)} <span class="muted">(${esc(st.closingLabel)})</span></div>
</body></html>`;
}

/** Prints via a hidden iframe (no pop-up blockers, the app page stays as is). */
export function printStatement(st) {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  Object.assign(frame.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(statementHtml(st));
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
  const M = 32;
  // Built-in PDF fonts have no ₹ glyph, so amounts use "Rs.".
  const amt = (v) => (v === null || v === undefined ? "-" : money(v));
  const cols = [
    { key: "date", label: "Date", w: 62 },
    { key: "type", label: "Type", w: 62 },
    { key: "billNo", label: "Bill No", w: 64 },
    { key: "details", label: "Details", w: 150 },
    { key: "debit", label: "Debit", w: 66, num: true },
    { key: "credit", label: "Credit", w: 66, num: true },
    { key: "balance", label: "Balance", w: W - 2 * M - 470, num: true },
  ];
  let y = M;

  doc.setFont("helvetica", "bold").setFontSize(15).text(st.title, M, y);
  doc.setFont("helvetica", "normal").setFontSize(9);
  y += 16;
  const left = [st.business.name, st.business.address, st.business.phone && `Ph: ${st.business.phone}`].filter(Boolean);
  const right = [
    st.party.name,
    st.party.phone && `Ph: ${st.party.phone}`,
    st.party.gstin && `GSTIN: ${st.party.gstin}`,
    `Period: ${st.period || "-"}`,
    `Generated: ${st.generatedAt}`,
  ].filter(Boolean);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i]) doc.text(String(left[i]).slice(0, 70), M, y);
    if (right[i]) doc.text(String(right[i]), W - M, y, { align: "right" });
    y += 12;
  }
  y += 6;

  const header = () => {
    doc.setFillColor(241, 245, 249).rect(M, y - 10, W - 2 * M, 16, "F");
    doc.setFont("helvetica", "bold").setFontSize(8);
    let x = M;
    cols.forEach((c) => {
      doc.text(c.label.toUpperCase(), c.num ? x + c.w - 4 : x + 4, y + 1, c.num ? { align: "right" } : undefined);
      x += c.w;
    });
    y += 14;
    doc.setFont("helvetica", "normal").setFontSize(8.5);
  };
  header();

  st.rows.forEach((r) => {
    const detailLines = doc.splitTextToSize(r.shortDetails || "-", cols[3].w - 8);
    const itemLines = r.items.flatMap((i) =>
      doc.splitTextToSize(`${i.name}${i.variant ? ` (${i.variant})` : ""}: ${i.quantity} x ${money(i.rate)} = ${money(i.amount)}`, W - 2 * M - 70),
    );
    const height = Math.max(detailLines.length, 1) * 10 + (itemLines.length ? itemLines.length * 9 + 4 : 0) + 6;
    if (y + height > H - M - 40) {
      doc.addPage();
      y = M + 10;
      header();
    }
    let x = M;
    cols.forEach((c) => {
      if (c.key === "details") {
        doc.text(detailLines, x + 4, y);
      } else if (c.num) {
        doc.text(amt(r[c.key]), x + c.w - 4, y, { align: "right" });
      } else {
        doc.text(String(r[c.key] || "-"), x + 4, y);
      }
      x += c.w;
    });
    let yy = y + Math.max(detailLines.length, 1) * 10;
    if (itemLines.length) {
      doc.setTextColor(100, 116, 139).setFontSize(7.5);
      doc.text(itemLines, M + 70, yy);
      doc.setTextColor(15, 23, 42).setFontSize(8.5);
      yy += itemLines.length * 9 + 4;
    }
    doc.setDrawColor(226, 232, 240).line(M, yy - 6, W - M, yy - 6);
    y = yy + 6;
  });

  if (y > H - M - 50) {
    doc.addPage();
    y = M + 10;
  }
  doc.setFont("helvetica", "bold").setFontSize(9);
  doc.text(`Total debit: Rs. ${money(st.totalDebit)}    Total credit: Rs. ${money(st.totalCredit)}`, W - M, y + 6, { align: "right" });
  doc.setFontSize(11).text(`Closing balance: Rs. ${money(st.closingBalance)} (${st.closingLabel})`, W - M, y + 24, { align: "right" });

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p += 1) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(148, 163, 184);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 16, { align: "right" });
    doc.setTextColor(15, 23, 42);
  }
  doc.save(statementFilename(st, "pdf"));
}
