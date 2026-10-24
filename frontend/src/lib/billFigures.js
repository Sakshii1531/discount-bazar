/**
 * Bill math shared by the New Sale (POS) receipt, the POS bill PDF and the
 * online order invoice, so every bill is calculated — and laid out — the same
 * way.
 *
 * POS bills: exactly the figures the receipt has always printed.
 * Online orders additionally carry delivery / handling / tip charges, a wallet
 * redemption and an online-or-COD payment, which become extra rows on the
 * same layout. Tax is never recalculated here: the stored `taxTotal` and the
 * per-line `gstPercent` snapshots decide it, and a zero tax produces no tax
 * rows at all.
 */
import { posBillCustomer } from './posCustomer';

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

export const TENDER_LABELS = { CASH: 'Cash', CARD: 'Card', QR: 'UPI', CREDIT: 'Credit', OTHER: 'Other', SPLIT: 'Split' };

/** Online orders are anything not billed at the counter. */
export const isOnlineOrder = (order) => String(order?.orderSource || 'APP').toUpperCase() !== 'POS';

const PAID_ONLINE = new Set(['PAID', 'REFUNDED']);
const COD_COLLECTED = new Set(['CASH_COLLECTED', 'PARTIALLY_REMITTED', 'COD_RECONCILED']);

function onlinePaymentState(order, payable) {
    const mode = String(order.paymentMode || (order.payment?.method === 'online' ? 'ONLINE' : 'COD')).toUpperCase();
    const status = String(order.paymentStatus || '').toUpperCase();
    const legacyDone = String(order.payment?.status || '').toLowerCase() === 'completed';
    let paid;
    if (mode === 'ONLINE') paid = PAID_ONLINE.has(status) || Boolean(order.financeFlags?.onlinePaymentCaptured) || legacyDone;
    else if (mode === 'WALLET') paid = true;
    else paid = COD_COLLECTED.has(status) || legacyDone;
    const label = mode === 'ONLINE' ? 'Online' : mode === 'WALLET' ? 'Wallet' : 'Cash';
    return { mode, label, paid: payable <= 0 || paid };
}

export function onlineBillCustomer(order) {
    const name = String(order?.address?.name || order?.customer?.name || '').trim();
    const phone = String(order?.address?.phone || order?.customer?.phone || '').trim();
    const address = [order?.address?.address, order?.address?.landmark, order?.address?.city]
        .filter((part) => typeof part === 'string' && part.trim())
        .join(', ');
    return { name: name || 'Customer', phone, address, isWalkIn: false };
}

export function computeBillFigures(order) {
    const breakdown = order.paymentBreakdown || order.pricing || {};
    const pricing = order.pricing || {};
    const items = Array.isArray(order.items) ? order.items : [];
    const qtyOf = (it) => num(it.quantity || it.qty || 1);
    const lineItemsSubtotal = items.reduce((s, it) => s + qtyOf(it) * num(it.price), 0);
    const subtotal = num(breakdown.productSubtotal || breakdown.subtotal || lineItemsSubtotal);
    const taxTotal = num(breakdown.taxTotal || 0);
    const discountTotal = num(breakdown.discountTotal || breakdown.discount || 0);
    const online = isOnlineOrder(order);
    // Online checkout always adds tax on top of the item prices
    // (subtotal × tax rate, see checkoutPricingService); the schema's
    // isTaxInclusive default only describes POS bills.
    const isTaxInclusive = online
        ? false
        : order.isTaxInclusive !== undefined ? order.isTaxInclusive : (breakdown.isTaxInclusive !== false);

    // Online-only charges, as frozen on the order at checkout.
    const charges = online
        ? [
            { key: 'delivery', label: 'Delivery Fee', value: num(breakdown.deliveryFeeCharged ?? pricing.deliveryFee) },
            { key: 'handling', label: 'Handling Fee', value: num(breakdown.handlingFeeCharged ?? pricing.platformFee) },
            { key: 'tip', label: 'Delivery Partner Tip', value: num(breakdown.tipTotal ?? pricing.tip) },
        ].filter((c) => c.value > 0)
        : [];
    const chargesTotal = charges.reduce((s, c) => s + c.value, 0);
    const walletAmount = online ? num(breakdown.walletAmount || pricing.walletAmount) : 0;

    const storedTotal = num(
        breakdown.grandTotal ||
        breakdown.total ||
        (isTaxInclusive ? Math.max(0, subtotal - discountTotal) : Math.max(0, subtotal + taxTotal - discountTotal)) + chargesTotal,
    );
    // Newer online orders store grandTotal net of the wallet part; the bill
    // total is the full order value either way.
    const grandTotal = online && breakdown.walletNettedInGrandTotal ? storedTotal + walletAmount : storedTotal;
    // Goods value only (fees excluded) — drives the GST split and MRP savings.
    const merchandiseTotal = Math.max(0, grandTotal - chargesTotal);

    let amountPaid;
    let isCredit = false;
    let balanceDue = 0;
    let cashTendered = null;
    let change = 0;
    let tenderLines;
    let payment = null;
    if (online) {
        const payable = Math.max(0, grandTotal - walletAmount);
        payment = onlinePaymentState(order, payable);
        tenderLines = [
            ...(walletAmount > 0 ? [{ method: 'WALLET', label: 'Wallet', amount: walletAmount }] : []),
            ...(payable > 0 ? [{ method: payment.mode, label: payment.label, amount: payable }] : []),
        ];
        amountPaid = walletAmount + (payment.paid ? payable : 0);
        // A cancelled order is never owed.
        const cancelled = String(order.status || '').toLowerCase() === 'cancelled';
        balanceDue = cancelled ? 0 : Math.max(0, grandTotal - amountPaid);
    } else {
        amountPaid = order.posAmountPaid != null ? num(order.posAmountPaid) : grandTotal;
        isCredit = String(order.posPaymentMethod || '').toUpperCase() === 'CREDIT';
        balanceDue = isCredit ? Math.max(0, grandTotal - amountPaid) : 0;
        cashTendered = order.posCashTendered != null ? num(order.posCashTendered) : null;
        change = !isCredit && cashTendered != null && cashTendered > grandTotal ? cashTendered - grandTotal : 0;
        const paymentMethod = String(order.posPaymentMethod || 'CASH').toUpperCase();
        const methodLabel = TENDER_LABELS[paymentMethod] || paymentMethod;
        const splitPayments = Array.isArray(order.posPayments) ? order.posPayments : [];
        tenderLines = splitPayments.length
            ? splitPayments.map((p) => ({ method: p.method, label: TENDER_LABELS[p.method] || p.method, amount: num(p.amount) }))
            : isCredit
                ? amountPaid > 0
                    ? [{ method: 'CASH', label: 'Cash', amount: amountPaid }]
                    : []
                : [{ method: paymentMethod, label: methodLabel, amount: grandTotal }];
    }

    // Bill discount is spread across lines before splitting each rate into
    // taxable value + CGST/SGST (intra-state sale).
    const ratio = subtotal > 0 ? (isTaxInclusive ? merchandiseTotal / subtotal : (subtotal - discountTotal) / subtotal) : 1;
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
    // Lines without a gstPercent: fall back to the bill-level taxTotal.
    if (gst.size === 0 && taxTotal > 0) {
        const taxable = isTaxInclusive ? Math.max(0, (subtotal - discountTotal) - taxTotal) : Math.max(0, subtotal - discountTotal);
        const rate = taxable > 0 ? Math.round(((taxTotal / taxable) * 100) * 10) / 10 : num(breakdown.taxPercent || order.taxPercent || 0);
        gst.set(rate, { taxable, tax: taxTotal });
    }
    const gstRows = Array.from(gst.entries()).sort((a, b) => a[0] - b[0]);

    const units = items.reduce((s, it) => s + qtyOf(it), 0);
    const unitMrp = (it) => Math.max(num(it?.mrp), num(it?.price));
    const mrpTotal = items.reduce((s, it) => s + unitMrp(it) * qtyOf(it), 0);

    const customer = online ? onlineBillCustomer(order) : { ...posBillCustomer(order, 'Walk-in Customer'), address: '' };
    const modeParts = [...tenderLines, ...(isCredit && balanceDue > 0 ? [{ label: 'Credit', amount: balanceDue }] : [])];

    return {
        online,
        items,
        qtyOf,
        unitMrp,
        lineItemsSubtotal,
        subtotal,
        taxTotal,
        discountTotal,
        isTaxInclusive,
        charges,
        walletAmount,
        grandTotal,
        merchandiseTotal,
        amountPaid,
        isCredit,
        balanceDue,
        cashTendered,
        change,
        tenderLines,
        modeParts,
        payment,
        units,
        mrpTotal,
        mrpSavings: Math.round((mrpTotal - merchandiseTotal) * 100) / 100,
        gstRows,
        customer,
        status: String(order.status || '').toLowerCase(),
    };
}
