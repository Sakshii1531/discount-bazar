/**
 * Shared PDF Export Utility — Seller App
 * Uses jsPDF to generate properly formatted, branded PDF reports in simple, clear terms.
 * All seller downloads (Analytics, Orders, Withdrawals) use this for consistent output.
 */

const BRAND_RED  = [220, 38, 38];     // #DC2626
const BRAND_DARK = [15, 23, 42];      // #0F172A
const GRAY_LINE  = [226, 232, 240];   // #E2E8F0
const GRAY_TEXT  = [100, 116, 139];   // #64748B
const WHITE      = [255, 255, 255];
const MARGIN     = 16;

/**
 * Thorough text sanitizer:
 * 1. Replaces Rupee symbol (₹) with 'Rs. ' so standard Helvetica never garbles it.
 * 2. Cleans smart quotes, em dashes, ellipses into ASCII equivalents.
 * 3. Strips unprintable or non-ASCII characters that corrupt jsPDF output.
 */
const cleanText = (val) => {
    if (val === null || val === undefined) return '—';
    let s = String(val);
    s = s.replace(/₹\s*/g, 'Rs. ');
    s = s.replace(/[\u2018\u2019]/g, "'")
         .replace(/[\u201C\u201D]/g, '"')
         .replace(/[\u2013\u2014]/g, '-')
         .replace(/\u2026/g, '...');
    s = s.replace(/[^\x20-\x7E]/g, ' ');
    return s.replace(/\s+/g, ' ').trim();
};

/**
 * Format money values clearly with 'Rs. ' prefix and comma separation
 */
const formatMoney = (val) => {
    if (val === null || val === undefined || val === '') return 'Rs. 0';
    let s = String(val).replace(/₹\s*/g, '').trim();
    s = cleanText(s);
    if (!s || s === '0') return 'Rs. 0';
    if (s.startsWith('Rs.')) return s;
    return `Rs. ${s}`;
};

/** Draw the branded top header band on page 1 */
const drawHeader = (doc, title, subtitle) => {
    const W = doc.internal.pageSize.getWidth();
    // Red banner
    doc.setFillColor(...BRAND_RED);
    doc.rect(0, 0, W, 32, 'F');
    // Store brand
    doc.setFontSize(15);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...WHITE);
    doc.text('Discount Bazar', MARGIN, 13);
    // Seller tag
    doc.setFontSize(8);
    doc.setFont(undefined, 'normal');
    doc.text('SELLER PORTAL REPORT', W - MARGIN, 13, { align: 'right' });
    // Report title
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(cleanText(title), MARGIN, 25);
    // Subtitle right
    if (subtitle) {
        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');
        doc.text(cleanText(subtitle), W - MARGIN, 25, { align: 'right' });
    }
    doc.setTextColor(...BRAND_DARK);
};

/** Running header for continuation pages (page 2+) */
const drawRunningHeader = (doc, title = 'Discount Bazar Seller Portal Report') => {
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(...BRAND_RED);
    doc.rect(0, 0, W, 8, 'F');
    doc.setFontSize(7.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...WHITE);
    doc.text(`${cleanText(title)} (Continued)`, MARGIN, 5.5);
    doc.setTextColor(...BRAND_DARK);
};

/** Draw footer with page number and timestamp on every page */
const drawFooter = (doc, generatedAt) => {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const totalPages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setDrawColor(...GRAY_LINE);
        doc.setLineWidth(0.4);
        doc.line(MARGIN, H - 14, W - MARGIN, H - 14);
        doc.setFontSize(7);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...GRAY_TEXT);
        doc.text(`Generated: ${cleanText(generatedAt)}`, MARGIN, H - 8);
        doc.text(`Page ${i} of ${totalPages}`, W - MARGIN, H - 8, { align: 'right' });
        doc.setTextColor(...BRAND_DARK);
    }
};

/** Guard against orphan sections: if not enough space remains on page, create new page */
const checkPageSpace = (doc, currentY, requiredHeight = 35) => {
    const H = doc.internal.pageSize.getHeight();
    if (currentY + requiredHeight > H - 18) {
        doc.addPage();
        drawRunningHeader(doc);
        return 16;
    }
    return currentY;
};

/** Draw a section heading with optional simple subtitle */
const drawSectionHeading = (doc, title, subtitle, y) => {
    y = checkPageSpace(doc, y, subtitle ? 20 : 14);
    const W = doc.internal.pageSize.getWidth();
    doc.setFillColor(248, 250, 252);
    doc.rect(MARGIN, y - 4, W - MARGIN * 2, subtitle ? 13 : 9, 'F');
    doc.setFontSize(8.5);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...BRAND_RED);
    doc.text(cleanText(title).toUpperCase(), MARGIN + 3, y + 1.5);
    if (subtitle) {
        doc.setFontSize(7);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...GRAY_TEXT);
        doc.text(cleanText(subtitle), MARGIN + 3, y + 6.5);
        doc.setTextColor(...BRAND_DARK);
        return y + 12;
    }
    doc.setTextColor(...BRAND_DARK);
    return y + 8;
};

/** Draw a light horizontal divider */
const drawDivider = (doc, y) => {
    const W = doc.internal.pageSize.getWidth();
    doc.setDrawColor(...GRAY_LINE);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y, W - MARGIN, y);
    return y + 4;
};

/** Draw a key-value row with simple terms */
const drawRow = (doc, label, value, y, highlight = false, note = '') => {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    if (y > H - 18) {
        doc.addPage();
        drawRunningHeader(doc);
        y = 16;
    }
    if (highlight) {
        doc.setFillColor(241, 245, 249);
        doc.rect(MARGIN, y - 3.5, W - MARGIN * 2, 8, 'F');
    }
    doc.setFontSize(8.5);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(...GRAY_TEXT);
    doc.text(cleanText(label), MARGIN + 3, y + 1);

    doc.setFont(undefined, 'bold');
    doc.setTextColor(...BRAND_DARK);
    const valText = cleanText(value);
    doc.text(valText, MARGIN + 70, y + 1);

    if (note) {
        doc.setFontSize(7);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...GRAY_TEXT);
        doc.text(`(${cleanText(note)})`, MARGIN + 74 + doc.getTextWidth(valText), y + 1);
        doc.setTextColor(...BRAND_DARK);
    }
    return y + 8.5;
};

/** Draw a table with auto page-break and automatic header repetition on new pages */
const drawTable = (doc, headers, rows, y, colAlignments = []) => {
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const colWidth = (W - MARGIN * 2) / headers.length;

    const renderTableHeader = (headerY) => {
        doc.setFillColor(...BRAND_DARK);
        doc.rect(MARGIN, headerY - 4, W - MARGIN * 2, 8, 'F');
        doc.setFontSize(7.5);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(...WHITE);
        headers.forEach((h, i) => {
            const align = colAlignments[i] || 'left';
            const x = align === 'right'
                ? MARGIN + (i + 1) * colWidth - 3
                : MARGIN + 3 + i * colWidth;
            doc.text(cleanText(h), x, headerY + 1, { align, maxWidth: colWidth - 4 });
        });
        doc.setTextColor(...BRAND_DARK);
        return headerY + 9;
    };

    y = renderTableHeader(y);

    // Data rows
    rows.forEach((row, rowIdx) => {
        if (y > H - 22) {
            doc.addPage();
            drawRunningHeader(doc);
            y = 16;
            y = renderTableHeader(y);
        }
        if (rowIdx % 2 === 0) {
            doc.setFillColor(248, 250, 252);
            doc.rect(MARGIN, y - 3.5, W - MARGIN * 2, 8, 'F');
        }
        doc.setFontSize(7.5);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(...BRAND_DARK);
        row.forEach((cell, i) => {
            const align = colAlignments[i] || 'left';
            const x = align === 'right'
                ? MARGIN + (i + 1) * colWidth - 3
                : MARGIN + 3 + i * colWidth;
            doc.text(cleanText(cell), x, y + 1, { align, maxWidth: colWidth - 4 });
        });
        y += 8;
    });

    return y + 3;
};

/* ══════════════ PUBLIC GENERATORS ══════════════ */

/**
 * Generate Analytics Report PDF.
 * Uses simple words so any seller can immediately understand all numbers and sections.
 * @param {object} statsData - Analytics data from API.
 * @returns {Promise<{blob: Blob, fileName: string}>}
 */
export const generateAnalyticsPDF = async (statsData) => {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const dateStr = new Date().toISOString().slice(0, 10);

    drawHeader(doc, 'Store Sales & Performance Report', `Date: ${dateStr}`);
    let y = 42;

    // 1. Overview in simple terms
    const ov = statsData?.overview ?? {};
    y = drawSectionHeading(
        doc,
        'Store Performance Summary',
        'Key numbers showing your overall earnings, customer orders, and visits.',
        y
    );
    [
        ['Total Sales Amount',             formatMoney(ov.totalSales),      'Total gross revenue earned'],
        ['Total Orders Received',          cleanText(ov.totalOrders),       'Customer orders placed'],
        ['Average Order Value',            formatMoney(ov.avgOrderValue),   'Average amount per order'],
        ['Order Conversion Rate',          cleanText(ov.conversionRate),    'Visitors who placed orders'],
    ].forEach(([label, val, note], i) => {
        y = drawRow(doc, label, val, y, i % 2 === 0, note);
    });
    y += 2;
    y = drawDivider(doc, y);

    // 2. Sales Trend with simple day/sales/visitor terms
    const trend = statsData?.salesTrend ?? [];
    if (trend.length) {
        y = drawSectionHeading(
            doc,
            'Day-by-Day Sales & Visitors',
            'How much your store sold and how many shoppers visited each day.',
            y
        );
        const headers = ['Day / Date', 'Total Sales (Rs.)', 'Store Visitors'];
        const rows = trend.map(d => [
            d.name || '—',
            formatMoney(d.sales),
            `${cleanText(d.traffic || 0)} visitors`
        ]);
        y = drawTable(doc, headers, rows, y, ['left', 'right', 'right']);
        y = drawDivider(doc, y);
    }

    // 3. Top Products with clear labels
    const top = statsData?.topProducts ?? [];
    if (top.length) {
        y = drawSectionHeading(
            doc,
            'Best Selling Products',
            'Your most popular products by quantity sold and total earnings.',
            y
        );
        const headers = ['Product Name', 'Quantity Sold', 'Revenue (Rs.)', 'Trend'];
        const rows = top.map(p => [
            p.name || '—',
            `${cleanText(p.sales || 0)} units`,
            formatMoney(p.revenue),
            `${cleanText(p.trend || 0)}%`
        ]);
        y = drawTable(doc, headers, rows, y, ['left', 'right', 'right', 'right']);
        y = drawDivider(doc, y);
    }

    // 4. Category breakdown in plain terms
    const cat = statsData?.categoryMix ?? [];
    if (cat.length) {
        y = drawSectionHeading(
            doc,
            'Sales by Product Category',
            'Number of items ordered by customers in each category.',
            y
        );
        const headers = ['Product Category', 'Items Sold (Quantity)'];
        const rows = cat.map(c => [
            // Capitalize category name for clean readability
            (c.subject || '—').charAt(0).toUpperCase() + (c.subject || '—').slice(1),
            `${cleanText(c.A || 0)} items ordered`
        ]);
        y = drawTable(doc, headers, rows, y, ['left', 'right']);
        y = drawDivider(doc, y);
    }

    // 5. Traffic sources in plain terms
    const traffic = statsData?.trafficSources ?? [];
    if (traffic.length) {
        y = drawSectionHeading(
            doc,
            'Where Customers Came From',
            'How shoppers reached your store (app direct visit, search, etc.).',
            y
        );
        const formatSourceLabel = (src) => {
            const s = (src || '').toLowerCase();
            if (s.includes('direct')) return 'Direct App / Web Visit (Shoppers opened app directly)';
            if (s.includes('search')) return 'Search Bar (Shoppers searched for your items)';
            if (s.includes('social')) return 'Social Links (Shared via social media / messaging)';
            return cleanText(src || 'Other Channels');
        };
        const headers = ['Customer Source / Channel', 'Total Visits'];
        const rows = traffic.map(t => [
            formatSourceLabel(t.name),
            `${cleanText(t.value || 0)} visits`
        ]);
        y = drawTable(doc, headers, rows, y, ['left', 'right']);
    }

    drawFooter(doc, generatedAt);
    return { blob: doc.output('blob'), fileName: `seller-analytics-report-${dateStr}.pdf` };
};

/**
 * Generate Orders Export PDF (landscape for wide table).
 * Clean plain English terms for orders list.
 * @param {Array} orders - Filtered orders array.
 * @returns {Promise<{blob: Blob, fileName: string}>}
 */
export const generateOrdersPDF = async (orders) => {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
    const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const dateStr = new Date().toISOString().slice(0, 10);

    drawHeader(doc, `Orders History Report (${orders.length} Total Orders)`, `Date: ${dateStr}`);
    let y = 42;

    y = drawSectionHeading(
        doc,
        'Customer Orders List',
        'Complete breakdown of orders, customer contacts, amounts, and statuses.',
        y
    );
    const headers = ['Order ID', 'Customer Name', 'Phone Number', 'Date & Time', 'Total Amount', 'Order Status', 'Payment Method'];
    const rows = orders.map(o => [
        String(o.id ?? '').slice(-10),
        o.customer?.name ?? 'Customer',
        o.customer?.phone ?? '—',
        `${o.date ?? ''} ${o.time ?? ''}`.trim() || '—',
        formatMoney(o.total),
        (o.status ?? 'Pending').toUpperCase(),
        (o.payment ?? 'COD').toUpperCase(),
    ]);
    y = drawTable(doc, headers, rows, y, ['left', 'left', 'left', 'left', 'right', 'left', 'left']);

    drawFooter(doc, generatedAt);
    return { blob: doc.output('blob'), fileName: `seller-orders-report-${dateStr}.pdf` };
};

/**
 * Generate Withdrawal Receipt PDF for a single payout item.
 * Clean plain English terms for withdrawal confirmation.
 * @param {object} item - Withdrawal transaction object.
 * @returns {Promise<{blob: Blob, fileName: string}>}
 */
export const generateWithdrawalReceiptPDF = async (item) => {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const generatedAt = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    const id = item.id || item.ref || item.reference || 'withdrawal';

    drawHeader(doc, 'Earnings Withdrawal Receipt', `Date: ${generatedAt}`);
    let y = 42;

    y = drawSectionHeading(
        doc,
        'Withdrawal Transaction Details',
        'Official record of payment transfer requested from your seller balance.',
        y
    );
    const details = [
        ['Transaction Reference ID', id,                                                        'Unique payment reference'],
        ['Transfer Status',          (item.status ?? 'PENDING').toUpperCase(),                 'Current payout status'],
        ['Request Date',             cleanText(item.date ?? '—'),                               'Date requested'],
        ['Request Time',             cleanText(item.time ?? '—'),                               'Time of request'],
        ['Payout Amount',            formatMoney(Math.abs(item.amount ?? 0)),                   'Amount sent to your bank'],
        ['Payout Destination',       cleanText(item.customer ?? 'Bank Transfer (Account)'),     'Receiving account or method'],
    ];
    if (item.reason) {
        details.push(['Seller Notes / Remarks', cleanText(item.reason), 'Note added with request']);
    }

    details.forEach(([label, val, note], i) => {
        y = drawRow(doc, label, val, y, i % 2 === 0, note);
    });

    y += 6;
    y = drawDivider(doc, y);

    // Status stamp badge
    const W = doc.internal.pageSize.getWidth();
    const statusStr = (item.status ?? 'PENDING').toUpperCase();
    const isComplete = statusStr === 'COMPLETED';
    const stampColor = isComplete ? [22, 163, 74] : [220, 38, 38];
    doc.setDrawColor(...stampColor);
    doc.setLineWidth(1.1);
    doc.roundedRect(W / 2 - 28, y, 56, 12, 2.5, 2.5, 'S');
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(...stampColor);
    doc.text(statusStr, W / 2, y + 8, { align: 'center' });
    doc.setTextColor(...BRAND_DARK);

    drawFooter(doc, generatedAt);
    return { blob: doc.output('blob'), fileName: `seller-withdrawal-${id}.pdf` };
};
