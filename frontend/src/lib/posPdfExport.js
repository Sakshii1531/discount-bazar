/**
 * POS PDF Export Utility — Seller POS
 * Generates clean, branded A4 PDFs for every POS report and record:
 * sales report, single bill, returns report, return slip, online orders queue
 * and held bills. Styling matches src/lib/pdfExport.js (red brand band, dark
 * table headers) with wrapping table cells so long names never overlap.
 */

const BRAND_RED  = [220, 38, 38];     // #DC2626
const BRAND_DARK = [15, 23, 42];      // #0F172A
const GRAY_LINE  = [226, 232, 240];   // #E2E8F0
const GRAY_TEXT  = [100, 116, 139];   // #64748B
const ZEBRA      = [248, 250, 252];   // #F8FAFC
const SOFT       = [241, 245, 249];   // #F1F5F9
const GREEN      = [22, 163, 74];
const WHITE      = [255, 255, 255];
const MARGIN     = 14;
const PT_TO_MM   = 0.3528;

const METHOD_LABELS = { CASH: 'Cash', CARD: 'Card', QR: 'QR / UPI', CREDIT: 'Credit', OTHER: 'Other', SPLIT: 'Split' };
const REFUND_LABELS = { CASH: 'Cash', CARD: 'Card', QR: 'QR / UPI', CREDIT: 'Store Credit' };

/* ══════════════ TEXT & NUMBER HELPERS ══════════════ */

/** ASCII-only text so standard Helvetica never garbles output (₹ -> Rs.). */
const cleanText = (val) => {
    if (val === null || val === undefined || val === '') return '-';
    let s = String(val);
    s = s.replace(/₹\s*/g, 'Rs. ');
    s = s.replace(/[‘’]/g, "'")
         .replace(/[“”]/g, '"')
         .replace(/[–—]/g, '-')
         .replace(/…/g, '...');
    s = s.replace(/[^\x20-\x7E]/g, ' ');
    return s.replace(/\s+/g, ' ').trim() || '-';
};

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** "Rs. 1,234.50" (negative values keep a leading minus). */
const money = (v) => {
    const n = num(v);
    const abs = Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return `${n < 0 ? '-' : ''}Rs. ${abs}`;
};

const fmtDateTime = (d) => {
    const date = new Date(d);
    if (!d || isNaN(date.getTime())) return '-';
    return cleanText(date.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true,
    }));
};

const fmtDate = (d) => {
    const date = new Date(d);
    if (!d || isNaN(date.getTime())) return '-';
    return cleanText(date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }));
};

const todayKey = () => new Date().toISOString().slice(0, 10);
const safeFile = (s) => String(s || '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'record';
const methodLabel = (m) => METHOD_LABELS[String(m || '').toUpperCase()] || cleanText(m || 'Cash');
const refundLabel = (m) => REFUND_LABELS[String(m || '').toUpperCase()] || cleanText(m || '-');

/* ══════════════ LAYOUT PRIMITIVES ══════════════ */

const createDoc = async (orientation = 'portrait') => {
    const { default: jsPDF } = await import('jspdf');
    return new jsPDF({ unit: 'mm', format: 'a4', orientation });
};

const pageW = (doc) => doc.internal.pageSize.getWidth();
const pageH = (doc) => doc.internal.pageSize.getHeight();
const lineH = (fontSize) => fontSize * PT_TO_MM * 1.25;

const drawRunningHeader = (doc, title) => {
    doc.setFillColor(...BRAND_RED);
    doc.rect(0, 0, pageW(doc), 8, 'F');
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...WHITE);
    doc.text(`${cleanText(title)} (continued)`, MARGIN, 5.5);
    doc.setTextColor(...BRAND_DARK);
};

/** Adds a page when `needed` mm won't fit; returns the (possibly reset) y. */
const ensureSpace = (doc, y, needed, title) => {
    if (y + needed > pageH(doc) - 18) {
        doc.addPage();
        drawRunningHeader(doc, title);
        return 16;
    }
    return y;
};

/** Branded header band on page 1. Returns the y to continue from. */
const drawHeader = (doc, { shopName, title, subtitle }) => {
    const W = pageW(doc);
    doc.setFillColor(...BRAND_RED);
    doc.rect(0, 0, W, 30, 'F');

    doc.setTextColor(...WHITE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(cleanText(shopName || 'Discount Bazar'), MARGIN, 12);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('DISCOUNT BAZAR  |  SELLER POS', W - MARGIN, 12, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(cleanText(title), MARGIN, 23);

    if (subtitle) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text(cleanText(subtitle), W - MARGIN, 23, { align: 'right' });
    }
    doc.setTextColor(...BRAND_DARK);
    return 40;
};

/** Page footer (timestamp + page x of y) on every page — call last. */
const drawFooter = (doc, note = 'Computer generated POS document') => {
    const W = pageW(doc);
    const H = pageH(doc);
    const generatedAt = fmtDateTime(new Date());
    const total = doc.internal.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        doc.setDrawColor(...GRAY_LINE);
        doc.setLineWidth(0.3);
        doc.line(MARGIN, H - 13, W - MARGIN, H - 13);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...GRAY_TEXT);
        doc.text(`Generated: ${generatedAt}`, MARGIN, H - 8);
        doc.text(cleanText(note), W / 2, H - 8, { align: 'center' });
        doc.text(`Page ${i} of ${total}`, W - MARGIN, H - 8, { align: 'right' });
    }
    doc.setTextColor(...BRAND_DARK);
};

/** Red section title with a hairline underneath. */
const drawSection = (doc, y, title, docTitle, subtitle) => {
    // Keep room for the heading plus a table header and a couple of rows.
    y = ensureSpace(doc, y, subtitle ? 42 : 36, docTitle);
    const W = pageW(doc);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...BRAND_RED);
    doc.text(cleanText(title).toUpperCase(), MARGIN, y);
    doc.setDrawColor(...GRAY_LINE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y + 1.8, W - MARGIN, y + 1.8);
    y += 6;
    if (subtitle) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(...GRAY_TEXT);
        doc.text(cleanText(subtitle), MARGIN, y);
        y += 5;
    }
    doc.setTextColor(...BRAND_DARK);
    return y;
};

/** Row(s) of stat boxes: [{ label, value, accent? }]. */
const drawStatCards = (doc, y, cards, docTitle) => {
    const W = pageW(doc);
    const perRow = W > 250 ? 5 : 4;
    const gap = 3;
    const boxW = (W - MARGIN * 2 - gap * (perRow - 1)) / perRow;
    const boxH = 15;
    for (let i = 0; i < cards.length; i += perRow) {
        y = ensureSpace(doc, y, boxH + 3, docTitle);
        cards.slice(i, i + perRow).forEach((c, j) => {
            const x = MARGIN + j * (boxW + gap);
            doc.setFillColor(...ZEBRA);
            doc.setDrawColor(...GRAY_LINE);
            doc.setLineWidth(0.3);
            doc.roundedRect(x, y, boxW, boxH, 1.5, 1.5, 'FD');
            doc.setFillColor(...(c.accent || BRAND_RED));
            doc.rect(x, y + 1.5, 0.9, boxH - 3, 'F');
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(6.8);
            doc.setTextColor(...GRAY_TEXT);
            doc.text(cleanText(c.label).toUpperCase(), x + 3.5, y + 5.2, { maxWidth: boxW - 5 });
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10.5);
            doc.setTextColor(...BRAND_DARK);
            doc.text(cleanText(c.value), x + 3.5, y + 11.5, { maxWidth: boxW - 5 });
        });
        y += boxH + 3;
    }
    doc.setTextColor(...BRAND_DARK);
    return y + 3;
};

/** Two-column label/value grid: [[label, value], ...]. */
const drawInfoGrid = (doc, y, pairs, docTitle, cols = 2) => {
    const W = pageW(doc);
    const colW = (W - MARGIN * 2) / cols;
    const labelW = Math.min(34, colW * 0.42);
    const rows = [];
    for (let i = 0; i < pairs.length; i += cols) rows.push(pairs.slice(i, i + cols));

    rows.forEach((row, r) => {
        doc.setFontSize(8.5);
        const heights = row.map(([, v]) => doc.splitTextToSize(cleanText(v), colW - labelW - 4).length);
        const h = Math.max(...heights) * lineH(8.5) + 3;
        y = ensureSpace(doc, y, h, docTitle);
        if (r % 2 === 0) {
            doc.setFillColor(...ZEBRA);
            doc.rect(MARGIN, y, W - MARGIN * 2, h, 'F');
        }
        row.forEach(([label, value], c) => {
            const x = MARGIN + c * colW;
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...GRAY_TEXT);
            doc.text(cleanText(label), x + 2.5, y + 4.2);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...BRAND_DARK);
            doc.text(doc.splitTextToSize(cleanText(value), colW - labelW - 4), x + labelW, y + 4.2);
        });
        y += h;
    });
    return y + 5;
};

/**
 * Table with wrapping cells, zebra rows, header repeated on every new page
 * and an optional bold totals row.
 * columns: [{ header, width (fraction of usable width), align }]
 */
const drawTable = (doc, y, { columns, rows, totals, docTitle, fontSize = 7.8 }) => {
    const W = pageW(doc);
    const usable = W - MARGIN * 2;
    const widths = columns.map((c) => c.width * usable);
    const lh = lineH(fontSize);

    const cellX = (i, align) => {
        const x0 = MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0);
        if (align === 'right') return x0 + widths[i] - 2;
        if (align === 'center') return x0 + widths[i] / 2;
        return x0 + 2;
    };

    const drawCells = (cells, top, bold) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        cells.forEach((lines, i) => {
            const align = columns[i].align || 'left';
            lines.forEach((line, k) => doc.text(line, cellX(i, align), top + 4 + k * lh, { align }));
        });
    };

    const split = (cells, bold) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(fontSize);
        // '' stays blank (spacer cells in totals rows); missing data shows '-'.
        return cells.map((cell, i) => doc.splitTextToSize(cell === '' ? '' : cleanText(cell), widths[i] - 4));
    };

    const drawHead = () => {
        const cells = split(columns.map((c) => c.header), true);
        const h = Math.max(...cells.map((l) => l.length)) * lh + 3.5;
        doc.setFillColor(...BRAND_DARK);
        doc.rect(MARGIN, y, usable, h, 'F');
        doc.setTextColor(...WHITE);
        drawCells(cells, y, true);
        doc.setTextColor(...BRAND_DARK);
        y += h;
    };

    y = ensureSpace(doc, y, 20, docTitle);
    drawHead();

    if (!rows.length) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(8);
        doc.setTextColor(...GRAY_TEXT);
        doc.text('No records found', MARGIN + usable / 2, y + 6, { align: 'center' });
        doc.setTextColor(...BRAND_DARK);
        return y + 12;
    }

    rows.forEach((row, idx) => {
        const cells = split(row, false);
        const h = Math.max(...cells.map((l) => l.length)) * lh + 3;
        if (y + h > pageH(doc) - 18) {
            doc.addPage();
            drawRunningHeader(doc, docTitle);
            y = 14;
            drawHead();
        }
        if (idx % 2 === 1) {
            doc.setFillColor(...ZEBRA);
            doc.rect(MARGIN, y, usable, h, 'F');
        }
        doc.setTextColor(...BRAND_DARK);
        drawCells(cells, y, false);
        doc.setDrawColor(...GRAY_LINE);
        doc.setLineWidth(0.2);
        doc.line(MARGIN, y + h, MARGIN + usable, y + h);
        y += h;
    });

    if (totals) {
        const cells = split(totals, true);
        const h = Math.max(...cells.map((l) => l.length)) * lh + 3.5;
        y = ensureSpace(doc, y, h, docTitle);
        doc.setFillColor(...SOFT);
        doc.rect(MARGIN, y, usable, h, 'F');
        doc.setDrawColor(...BRAND_DARK);
        doc.setLineWidth(0.4);
        doc.line(MARGIN, y, MARGIN + usable, y);
        drawCells(cells, y, true);
        y += h;
    }
    return y + 6;
};

/** Right-aligned totals block: [{ label, value, strong?, color? }]. */
const drawTotalsBlock = (doc, y, lines, docTitle) => {
    const W = pageW(doc);
    const boxW = 80;
    const x = W - MARGIN - boxW;
    y = ensureSpace(doc, y, lines.length * 7 + 4, docTitle);
    lines.forEach((l) => {
        if (l.strong) {
            doc.setFillColor(...BRAND_DARK);
            doc.rect(x, y - 0.5, boxW, 8, 'F');
            doc.setTextColor(...WHITE);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.text(cleanText(l.label), x + 3, y + 4.8);
            doc.text(cleanText(l.value), x + boxW - 3, y + 4.8, { align: 'right' });
            y += 9.5;
        } else {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8.5);
            doc.setTextColor(...(l.color || GRAY_TEXT));
            doc.text(cleanText(l.label), x + 3, y + 4);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...(l.color || BRAND_DARK));
            doc.text(cleanText(l.value), x + boxW - 3, y + 4, { align: 'right' });
            doc.setDrawColor(...GRAY_LINE);
            doc.setLineWidth(0.2);
            doc.line(x, y + 6.2, x + boxW, y + 6.2);
            y += 7;
        }
    });
    doc.setTextColor(...BRAND_DARK);
    return y + 4;
};

const drawNote = (doc, y, text, docTitle) => {
    y = ensureSpace(doc, y, 10, docTitle);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY_TEXT);
    const lines = doc.splitTextToSize(cleanText(text), pageW(doc) - MARGIN * 2);
    doc.text(lines, MARGIN, y);
    doc.setTextColor(...BRAND_DARK);
    return y + lines.length * lineH(7.5) + 3;
};

/* ══════════════ DATA HELPERS ══════════════ */

/** Same bill math as ReceiptPrint so the PDF always matches the printed bill. */
const billFigures = (order) => {
    const breakdown = order.paymentBreakdown || order.pricing || {};
    const items = Array.isArray(order.items) ? order.items : [];
    const qtyOf = (it) => num(it.quantity || it.qty || 1);
    const lineSum = items.reduce((s, it) => s + qtyOf(it) * num(it.price), 0);
    const subtotal = num(breakdown.productSubtotal || breakdown.subtotal || lineSum);
    const taxTotal = num(breakdown.taxTotal || 0);
    const discountTotal = num(breakdown.discountTotal || breakdown.discount || 0);
    const isTaxInclusive = order.isTaxInclusive !== undefined ? order.isTaxInclusive : (breakdown.isTaxInclusive !== false);
    const grandTotal = num(
        breakdown.grandTotal ||
        breakdown.total ||
        (isTaxInclusive ? Math.max(0, subtotal - discountTotal) : Math.max(0, subtotal + taxTotal - discountTotal))
    );
    const amountPaid = order.posAmountPaid != null ? num(order.posAmountPaid) : grandTotal;
    const isCredit = String(order.posPaymentMethod || '').toUpperCase() === 'CREDIT';
    const balanceDue = isCredit ? Math.max(0, grandTotal - amountPaid) : 0;
    const cashTendered = order.posCashTendered != null ? num(order.posCashTendered) : null;
    const change = !isCredit && cashTendered != null && cashTendered > grandTotal ? cashTendered - grandTotal : 0;
    const units = items.reduce((s, it) => s + qtyOf(it), 0);

    const ratio = subtotal > 0 ? (isTaxInclusive ? grandTotal / subtotal : (subtotal - discountTotal) / subtotal) : 1;
    const gst = new Map();
    items.forEach((it) => {
        const rate = num(it.gstPercent);
        if (rate <= 0) return;
        const lineTotal = num(it.price) * qtyOf(it);
        if (isTaxInclusive) {
            const value = lineTotal * ratio;
            const taxable = (value * 100) / (100 + rate);
            const prev = gst.get(rate) || { taxable: 0, tax: 0 };
            gst.set(rate, { taxable: prev.taxable + taxable, tax: prev.tax + (value - taxable) });
        } else {
            const taxable = lineTotal * ratio;
            const tax = (taxable * rate) / 100;
            const prev = gst.get(rate) || { taxable: 0, tax: 0 };
            gst.set(rate, { taxable: prev.taxable + taxable, tax: prev.tax + tax });
        }
    });

    // Fallback: If individual lines did not record gstPercent, use the bill-level taxTotal/taxPercent
    if (gst.size === 0 && taxTotal > 0) {
        const taxable = isTaxInclusive ? Math.max(0, (subtotal - discountTotal) - taxTotal) : Math.max(0, subtotal - discountTotal);
        const rate = taxable > 0 ? Math.round(((taxTotal / taxable) * 100) * 10) / 10 : num(breakdown.taxPercent || order.taxPercent || 0);
        gst.set(rate, { taxable, tax: taxTotal });
    }

    const gstRows = Array.from(gst.entries()).sort((a, b) => a[0] - b[0]);

    return {
        items, qtyOf, subtotal, taxTotal, discountTotal, grandTotal, amountPaid,
        isCredit, balanceDue, cashTendered, change, units, gstRows, isTaxInclusive,
    };
};

const customerOf = (o) => {
    const name = o.walkInCustomer?.name || 'Walk-in';
    return o.walkInCustomer?.phone ? `${name} (${o.walkInCustomer.phone})` : name;
};

const periodLabel = ({ from, to } = {}) => {
    if (from && to) return `${fmtDate(from)} to ${fmtDate(to)}`;
    if (from) return `From ${fmtDate(from)}`;
    if (to) return `Up to ${fmtDate(to)}`;
    return 'All dates';
};

/* ══════════════ PUBLIC GENERATORS ══════════════ */

/**
 * POS Sales Report — every bill matching the applied filters, with totals,
 * payment-mode split and item-wise sales.
 */
export const downloadPosSalesReportPDF = async ({ sales = [], filters = {}, shopName }) => {
    const doc = await createDoc('landscape');
    const title = 'POS Sales Report';
    let y = drawHeader(doc, { shopName, title, subtitle: `Period: ${periodLabel(filters)}` });

    const figs = sales.map((o) => ({ o, f: billFigures(o) }));
    const sum = (k) => figs.reduce((s, x) => s + x.f[k], 0);

    y = drawInfoGrid(doc, y, [
        ['Report Period', periodLabel(filters)],
        ['Search Filter', filters.search || 'None'],
        ['Total Bills', String(sales.length)],
        ['Generated On', fmtDateTime(new Date())],
    ], title);

    y = drawSection(doc, y, 'Sales Summary', title);
    y = drawStatCards(doc, y, [
        { label: 'Total Bills', value: String(sales.length) },
        { label: 'Units Sold', value: String(sum('units')) },
        { label: 'Gross Sales', value: money(sum('subtotal')) },
        { label: 'Discounts Given', value: money(sum('discountTotal')) },
        { label: 'Tax Collected', value: money(sum('taxTotal')) },
        { label: 'Net Sales', value: money(sum('grandTotal')), accent: GREEN },
        { label: 'Amount Received', value: money(sum('amountPaid')), accent: GREEN },
        { label: 'Credit Balance Due', value: money(sum('balanceDue')) },
        { label: 'Average Bill Value', value: money(sales.length ? sum('grandTotal') / sales.length : 0) },
    ], title);

    // Payment mode breakdown
    const byMode = new Map();
    figs.forEach(({ o, f }) => {
        const key = methodLabel(o.posPaymentMethod);
        const prev = byMode.get(key) || { bills: 0, amount: 0 };
        byMode.set(key, { bills: prev.bills + 1, amount: prev.amount + f.grandTotal });
    });
    const net = sum('grandTotal');
    y = drawSection(doc, y, 'Sales by Payment Mode', title);
    y = drawTable(doc, y, {
        docTitle: title,
        columns: [
            { header: 'Payment Mode', width: 0.4 },
            { header: 'Bills', width: 0.15, align: 'right' },
            { header: 'Share of Sales', width: 0.2, align: 'right' },
            { header: 'Amount', width: 0.25, align: 'right' },
        ],
        rows: Array.from(byMode.entries())
            .sort((a, b) => b[1].amount - a[1].amount)
            .map(([mode, v]) => [mode, String(v.bills), `${net ? ((v.amount / net) * 100).toFixed(1) : '0.0'}%`, money(v.amount)]),
        totals: ['Total', String(sales.length), net ? '100.0%' : '0.0%', money(net)],
    });

    // Bill-wise register
    y = drawSection(doc, y, 'Bill-wise Sales Register', title, 'Every POS bill in the selected period, newest first.');
    y = drawTable(doc, y, {
        docTitle: title,
        columns: [
            { header: '#', width: 0.035, align: 'center' },
            { header: 'Bill No.', width: 0.12 },
            { header: 'Date & Time', width: 0.135 },
            { header: 'Customer', width: 0.15 },
            { header: 'Units', width: 0.05, align: 'right' },
            { header: 'Payment', width: 0.075 },
            { header: 'Subtotal', width: 0.095, align: 'right' },
            { header: 'Discount', width: 0.085, align: 'right' },
            { header: 'Tax', width: 0.075, align: 'right' },
            { header: 'Net Total', width: 0.1, align: 'right' },
            { header: 'Balance Due', width: 0.08, align: 'right' },
        ],
        rows: figs.map(({ o, f }, i) => [
            String(i + 1),
            `#${o.orderId}${Array.isArray(o.posEdits) && o.posEdits.length ? ' (edited)' : ''}`,
            fmtDateTime(o.createdAt),
            customerOf(o),
            String(f.units),
            methodLabel(o.posPaymentMethod),
            money(f.subtotal),
            money(f.discountTotal),
            money(f.taxTotal),
            money(f.grandTotal),
            f.balanceDue > 0 ? money(f.balanceDue) : '-',
        ]),
        totals: [
            '', 'TOTAL', '', `${sales.length} bill(s)`, String(sum('units')), '',
            money(sum('subtotal')), money(sum('discountTotal')), money(sum('taxTotal')),
            money(net), money(sum('balanceDue')),
        ],
    });

    // Item-wise sales
    const byItem = new Map();
    figs.forEach(({ f }) => {
        f.items.forEach((it) => {
            const name = it.name || it.productName || 'Item';
            const variant = it.variantSlot || it.variantSku || '';
            const key = `${name}::${variant}`;
            const prev = byItem.get(key) || { name, variant, qty: 0, amount: 0 };
            const q = f.qtyOf(it);
            byItem.set(key, { ...prev, qty: prev.qty + q, amount: prev.amount + q * num(it.price) });
        });
    });
    const itemRows = Array.from(byItem.values()).sort((a, b) => b.amount - a.amount);
    y = drawSection(doc, y, 'Item-wise Sales', title, 'Quantity and value sold per product (at billed rate, before bill discount).');
    drawTable(doc, y, {
        docTitle: title,
        columns: [
            { header: '#', width: 0.05, align: 'center' },
            { header: 'Product', width: 0.45 },
            { header: 'Variant', width: 0.18 },
            { header: 'Qty Sold', width: 0.12, align: 'right' },
            { header: 'Sales Value', width: 0.2, align: 'right' },
        ],
        rows: itemRows.map((r, i) => [String(i + 1), r.name, r.variant || '-', String(r.qty), money(r.amount)]),
        totals: ['', 'TOTAL', '', String(itemRows.reduce((s, r) => s + r.qty, 0)), money(itemRows.reduce((s, r) => s + r.amount, 0))],
    });

    drawFooter(doc);
    doc.save(`pos-sales-report-${todayKey()}.pdf`);
};

/** Single POS bill / invoice as an A4 PDF. */
export const downloadPosBillPDF = async ({ order, shopName, seller = {}, heading = 'Tax Invoice' }) => {
    if (!order) return;
    const doc = await createDoc('portrait');
    const sellerInfo = seller || order.seller || {};
    const store = shopName || sellerInfo.shopName || sellerInfo.name || 'Store';
    const title = `${heading} - Bill #${order.orderId}`;
    const f = billFigures(order);
    let y = drawHeader(doc, { shopName: store, title: heading, subtitle: `Bill No: #${order.orderId}` });

    const address = [sellerInfo.address, sellerInfo.city, sellerInfo.pincode].filter(Boolean).join(', ');
    const paidAt = order.deliveredAt || order.createdAt;

    y = drawSection(doc, y, 'Bill Details', title);
    y = drawInfoGrid(doc, y, [
        ['Bill No.', `#${order.orderId}`],
        ['Date & Time', fmtDateTime(paidAt)],
        ['Customer', order.walkInCustomer?.name || 'Walk-in Customer'],
        ['Customer Phone', order.walkInCustomer?.phone || '-'],
        ['Store', store],
        ['Cashier', sellerInfo.name || '-'],
        ['Store Address', address || '-'],
        ['Store Phone', sellerInfo.phone ? `+91 ${sellerInfo.phone}` : '-'],
        ...(sellerInfo.gstNumber ? [['GSTIN', sellerInfo.gstNumber], ['Payment Mode', methodLabel(order.posPaymentMethod)]] : [['Payment Mode', methodLabel(order.posPaymentMethod)]]),
    ], title);

    y = drawSection(doc, y, 'Items Purchased', title);
    y = drawTable(doc, y, {
        docTitle: title,
        columns: [
            { header: '#', width: 0.05, align: 'center' },
            { header: 'Item', width: 0.38 },
            { header: 'Variant', width: 0.13 },
            { header: 'GST %', width: 0.1, align: 'center' },
            { header: 'Qty', width: 0.08, align: 'right' },
            { header: 'Rate', width: 0.12, align: 'right' },
            { header: 'Amount', width: 0.14, align: 'right' },
        ],
        rows: f.items.map((it, i) => [
            String(i + 1),
            it.name || it.productName || 'Item',
            it.variantSlot || it.variantSku || '-',
            it.gstPercent ? `${it.gstPercent}%` : (f.gstRows.length === 1 ? `${f.gstRows[0][0]}%` : '-'),
            String(f.qtyOf(it)),
            money(it.price),
            money(f.qtyOf(it) * num(it.price)),
        ]),
        totals: ['', `Total (${f.items.length} item${f.items.length === 1 ? '' : 's'})`, '', '', String(f.units), '', money(f.subtotal)],
    });

    const couponCode = order.couponSnapshot?.code || order.couponCode || '';
    const taxableTotal = f.gstRows.reduce((s, [, r]) => s + r.taxable, 0);
    const gstTotal = f.gstRows.reduce((s, [, r]) => s + r.tax, 0) || f.taxTotal;

    y = drawTotalsBlock(doc, y, [
        { label: f.isTaxInclusive ? 'Subtotal (Gross)' : 'Subtotal', value: money(f.subtotal) },
        ...(f.isTaxInclusive && (gstTotal > 0 || f.taxTotal > 0) ? [
            { label: 'Taxable Base Value', value: money(taxableTotal || (f.subtotal - gstTotal)) },
            { label: 'CGST Amount', value: money(gstTotal / 2) },
            { label: 'SGST Amount', value: money(gstTotal / 2) },
        ] : []),
        ...(!f.isTaxInclusive && f.taxTotal > 0 ? [
            { label: 'CGST Amount', value: `+ ${money(f.taxTotal / 2)}` },
            { label: 'SGST Amount', value: `+ ${money(f.taxTotal / 2)}` },
            { label: 'Total Tax / GST', value: `+ ${money(f.taxTotal)}` },
        ] : []),
        ...(f.discountTotal > 0 ? [{ label: `Discount${couponCode ? ` (${couponCode})` : ''}`, value: `- ${money(f.discountTotal)}`, color: GREEN }] : []),
        { label: f.isTaxInclusive ? 'TOTAL AMOUNT (Incl. GST)' : 'TOTAL AMOUNT', value: money(f.grandTotal), strong: true },
    ], title);

    if (f.gstRows.length) {
        y = drawSection(doc, y, f.isTaxInclusive ? 'GST Summary (included in price)' : 'GST Summary', title);
        const gstTotal = f.gstRows.reduce((s, [, r]) => s + r.tax, 0);
        y = drawTable(doc, y, {
            docTitle: title,
            columns: [
                { header: 'GST Rate', width: 0.16 },
                { header: 'Taxable Value', width: 0.24, align: 'right' },
                { header: 'CGST', width: 0.2, align: 'right' },
                { header: 'SGST', width: 0.2, align: 'right' },
                { header: 'Total Tax', width: 0.2, align: 'right' },
            ],
            rows: f.gstRows.map(([rate, r]) => [`${rate}%`, money(r.taxable), money(r.tax / 2), money(r.tax / 2), money(r.tax)]),
            totals: ['Total', money(f.gstRows.reduce((s, [, r]) => s + r.taxable, 0)), money(gstTotal / 2), money(gstTotal / 2), money(gstTotal)],
        });
    }

    const splits = Array.isArray(order.posPayments) ? order.posPayments : [];
    y = drawSection(doc, y, 'Payment Details', title);
    y = drawInfoGrid(doc, y, [
        ['Payment Mode', methodLabel(order.posPaymentMethod)],
        ['Payment Status', f.isCredit && f.balanceDue > 0 ? 'PARTIALLY PAID' : 'PAID'],
        ...splits.map((p) => [`Paid by ${methodLabel(p.method)}`, money(p.amount)]),
        ['Amount Paid', money(f.amountPaid)],
        ...(f.cashTendered != null ? [['Cash Received', money(f.cashTendered)]] : []),
        ...(f.balanceDue > 0 ? [['Balance Due', money(f.balanceDue)]] : []),
        ...(f.change > 0 ? [['Change Returned', money(f.change)]] : []),
    ], title);

    if (Array.isArray(order.posEdits) && order.posEdits.length) {
        y = drawNote(doc, y, `Note: this bill was edited ${order.posEdits.length} time(s) after the sale.`, title);
    }
    drawNote(doc, y + 2, 'Thank you for shopping with us! This is a computer generated invoice and does not require a signature.', title);

    drawFooter(doc, 'Computer generated POS invoice');
    doc.save(`pos-bill-${safeFile(order.orderId)}.pdf`);
};

/** POS Returns & Refunds report. */
export const downloadPosReturnsReportPDF = async ({ returns = [], shopName }) => {
    const doc = await createDoc('landscape');
    const title = 'POS Returns & Refunds Report';
    let y = drawHeader(doc, { shopName, title, subtitle: `${returns.length} return(s)` });

    const unitsOf = (r, cond) => (r.items || [])
        .filter((it) => !cond || it.condition === cond)
        .reduce((s, it) => s + num(it.quantity), 0);
    const totalRefund = returns.reduce((s, r) => s + num(r.refundTotal), 0);
    const units = returns.reduce((s, r) => s + unitsOf(r), 0);
    const good = returns.reduce((s, r) => s + unitsOf(r, 'good'), 0);
    const damaged = returns.reduce((s, r) => s + unitsOf(r, 'damaged'), 0);
    const dates = returns.map((r) => new Date(r.createdAt).getTime()).filter((t) => !isNaN(t));

    y = drawInfoGrid(doc, y, [
        ['Period Covered', dates.length ? `${fmtDate(Math.min(...dates))} to ${fmtDate(Math.max(...dates))}` : '-'],
        ['Generated On', fmtDateTime(new Date())],
    ], title);

    y = drawSection(doc, y, 'Returns Summary', title);
    y = drawStatCards(doc, y, [
        { label: 'Total Returns', value: String(returns.length) },
        { label: 'Units Returned', value: String(units) },
        { label: 'Restocked (Good)', value: String(good), accent: GREEN },
        { label: 'Damaged Units', value: String(damaged) },
        { label: 'Total Refunded', value: money(totalRefund), accent: GREEN },
    ], title);

    const byMode = new Map();
    returns.forEach((r) => {
        const key = refundLabel(r.refundMethod);
        const prev = byMode.get(key) || { count: 0, amount: 0 };
        byMode.set(key, { count: prev.count + 1, amount: prev.amount + num(r.refundTotal) });
    });
    y = drawSection(doc, y, 'Refunds by Mode', title);
    y = drawTable(doc, y, {
        docTitle: title,
        columns: [
            { header: 'Refund Mode', width: 0.45 },
            { header: 'Returns', width: 0.2, align: 'right' },
            { header: 'Amount Refunded', width: 0.35, align: 'right' },
        ],
        rows: Array.from(byMode.entries()).map(([m, v]) => [m, String(v.count), money(v.amount)]),
        totals: ['Total', String(returns.length), money(totalRefund)],
    });

    y = drawSection(doc, y, 'Return Register', title, 'Every processed return, newest first.');
    drawTable(doc, y, {
        docTitle: title,
        columns: [
            { header: '#', width: 0.04, align: 'center' },
            { header: 'Date & Time', width: 0.135 },
            { header: 'Against Bill', width: 0.12 },
            { header: 'Items Returned (Qty x Item - Condition)', width: 0.305 },
            { header: 'Units', width: 0.06, align: 'right' },
            { header: 'Refund Mode', width: 0.09 },
            { header: 'Reason', width: 0.13 },
            { header: 'Refund', width: 0.12, align: 'right' },
        ],
        rows: returns.map((r, i) => [
            String(i + 1),
            fmtDateTime(r.createdAt),
            `#${r.orderId}`,
            (r.items || []).map((it) => `${it.quantity} x ${it.productName || 'Item'}${it.variantSlot ? ` (${it.variantSlot})` : ''} - ${it.condition === 'damaged' ? 'Damaged' : 'Good'}`).join('; '),
            String(unitsOf(r)),
            refundLabel(r.refundMethod),
            r.reason || '-',
            money(r.refundTotal),
        ]),
        totals: ['', 'TOTAL', `${returns.length} return(s)`, '', String(units), '', '', money(totalRefund)],
    });

    drawFooter(doc);
    doc.save(`pos-returns-report-${todayKey()}.pdf`);
};

/** Single return / refund slip. */
export const downloadPosReturnSlipPDF = async ({ ret, shopName, seller = {} }) => {
    if (!ret) return;
    const doc = await createDoc('portrait');
    const store = shopName || seller.shopName || seller.name || 'Store';
    const heading = 'Return / Refund Slip';
    const title = `${heading} - Bill #${ret.orderId}`;
    const items = Array.isArray(ret.items) ? ret.items : [];
    let y = drawHeader(doc, { shopName: store, title: heading, subtitle: `Against Bill: #${ret.orderId}` });

    y = drawSection(doc, y, 'Return Details', title);
    y = drawInfoGrid(doc, y, [
        ['Against Bill', `#${ret.orderId}`],
        ['Date & Time', fmtDateTime(ret.createdAt)],
        ['Refund Mode', refundLabel(ret.refundMethod)],
        ['Store', store],
        ['Reason', ret.reason || '-'],
        ...(seller.gstNumber ? [['GSTIN', seller.gstNumber]] : []),
    ], title);

    y = drawSection(doc, y, 'Items Returned', title);
    y = drawTable(doc, y, {
        docTitle: title,
        columns: [
            { header: '#', width: 0.06, align: 'center' },
            { header: 'Item', width: 0.34 },
            { header: 'Variant', width: 0.13 },
            { header: 'Condition', width: 0.15 },
            { header: 'Qty', width: 0.08, align: 'right' },
            { header: 'Unit Price', width: 0.12, align: 'right' },
            { header: 'Refund', width: 0.12, align: 'right' },
        ],
        rows: items.map((it, i) => [
            String(i + 1),
            it.productName || 'Item',
            it.variantSlot || '-',
            it.condition === 'damaged' ? 'Damaged' : 'Good (Restocked)',
            String(it.quantity),
            money(it.unitPrice),
            money(Math.round(num(it.refundAmount))),
        ]),
        totals: ['', 'Total', '', '', String(items.reduce((s, it) => s + num(it.quantity), 0)), '', money(Math.round(num(ret.refundTotal)))],
    });

    y = drawTotalsBlock(doc, y, [
        { label: 'Refund Mode', value: refundLabel(ret.refundMethod) },
        { label: 'TOTAL REFUND', value: money(Math.round(num(ret.refundTotal))), strong: true },
    ], title);
    drawNote(doc, y, 'Good items are restocked; damaged items are logged for audit. Computer generated return slip.', title);

    drawFooter(doc, 'Computer generated return slip');
    doc.save(`pos-return-slip-${safeFile(ret.orderId)}-${safeFile(String(ret._id || '').slice(-6) || todayKey())}.pdf`);
};

/** Online orders queue shown on the POS counter. */
export const downloadPosOnlineOrdersPDF = async ({ orders = [], filterLabel = 'All', shopName }) => {
    const doc = await createDoc('landscape');
    const title = 'Online Orders Queue';
    let y = drawHeader(doc, { shopName, title, subtitle: `View: ${filterLabel}` });

    const statusOf = (o) => {
        const ws = String(o.workflowStatus || '').toUpperCase();
        const st = String(o.status || '').toLowerCase();
        const base = ws === 'SELLER_PENDING' || (!ws && st === 'pending')
            ? 'Needs Acceptance'
            : st === 'packed' ? 'Packed' : 'Needs Packing';
        return ws === 'DELIVERY_ASSIGNED' ? `${base} (Rider Assigned)` : base;
    };
    const amountOf = (o) => num(o.paymentBreakdown?.grandTotal || o.pricing?.total || 0);
    const total = orders.reduce((s, o) => s + amountOf(o), 0);
    const packed = orders.filter((o) => String(o.status || '').toLowerCase() === 'packed').length;

    y = drawSection(doc, y, 'Queue Summary', title);
    y = drawStatCards(doc, y, [
        { label: 'Orders in View', value: String(orders.length) },
        { label: 'To Pack', value: String(orders.length - packed) },
        { label: 'Packed & Ready', value: String(packed), accent: GREEN },
        { label: 'Total Order Value', value: money(total), accent: GREEN },
    ], title);

    y = drawSection(doc, y, 'Orders', title);
    drawTable(doc, y, {
        docTitle: title,
        columns: [
            { header: '#', width: 0.04, align: 'center' },
            { header: 'Order ID', width: 0.13 },
            { header: 'Placed At', width: 0.13 },
            { header: 'Customer', width: 0.14 },
            { header: 'Items (Qty x Item)', width: 0.32 },
            { header: 'Status', width: 0.13 },
            { header: 'Amount', width: 0.11, align: 'right' },
        ],
        rows: orders.map((o, i) => [
            String(i + 1),
            `#${o.orderId}`,
            fmtDateTime(o.createdAt),
            o.shippingAddress?.fullName || o.customer?.name || o.user?.name || '-',
            (o.items || []).map((it) => `${it.quantity} x ${it.name || 'Item'}${it.variantSlot ? ` (${it.variantSlot})` : ''}`).join('; '),
            statusOf(o),
            money(amountOf(o)),
        ]),
        totals: ['', 'TOTAL', '', `${orders.length} order(s)`, '', '', money(total)],
    });

    drawFooter(doc);
    doc.save(`pos-online-orders-${todayKey()}.pdf`);
};

/** Held (parked) bills on this till. */
export const downloadPosHeldBillsPDF = async ({ bills = [], shopName }) => {
    const doc = await createDoc('portrait');
    const title = 'Held Bills';
    let y = drawHeader(doc, { shopName, title, subtitle: `${bills.length} held bill(s)` });

    const total = bills.reduce((s, b) => s + num(b.total), 0);
    const unitsOf = (b) => (b.cart || []).reduce((s, l) => s + num(l.quantity), 0);

    y = drawSection(doc, y, 'Summary', title);
    y = drawStatCards(doc, y, [
        { label: 'Held Bills', value: String(bills.length) },
        { label: 'Total Units', value: String(bills.reduce((s, b) => s + unitsOf(b), 0)) },
        { label: 'Total Value', value: money(total), accent: GREEN },
    ], title);

    bills.forEach((b, i) => {
        y = drawSection(doc, y, `Held Bill ${i + 1} - ${fmtDateTime(b.at)}`, title);
        y = drawTable(doc, y, {
            docTitle: title,
            columns: [
                { header: '#', width: 0.07, align: 'center' },
                { header: 'Item', width: 0.4 },
                { header: 'Variant', width: 0.15 },
                { header: 'Qty', width: 0.1, align: 'right' },
                { header: 'Rate', width: 0.13, align: 'right' },
                { header: 'Amount', width: 0.15, align: 'right' },
            ],
            rows: (b.cart || []).map((l, k) => [
                String(k + 1), l.name, l.variantLabel || '-', String(l.quantity), money(l.price), money(num(l.price) * num(l.quantity)),
            ]),
            totals: [
                '', num(b.taxAmount) > 0 ? `Total (incl. tax ${money(b.taxAmount)})` : 'Total', '',
                String(unitsOf(b)), '', money(b.total),
            ],
        });
    });

    drawFooter(doc);
    doc.save(`pos-held-bills-${todayKey()}.pdf`);
};
