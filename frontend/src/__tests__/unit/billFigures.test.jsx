import React from 'react';
import { render, screen } from '@testing-library/react';
import { computeBillFigures } from '@/lib/billFigures';
import ReceiptPrint from '@/modules/seller/components/pos/ReceiptPrint';

/**
 * The New Sale receipt's original inline math (ReceiptPrint before it moved to
 * lib/billFigures). POS bills must produce exactly these figures.
 */
function legacyPosFigures(order) {
  const breakdown = order.paymentBreakdown || order.pricing || {};
  const lineItems = Array.isArray(order.items) ? order.items : [];
  const lineItemsSubtotal = lineItems.reduce((sum, item) => sum + Number(item.quantity || item.qty || 1) * Number(item.price || 0), 0);
  const subtotal = Number(breakdown.productSubtotal || breakdown.subtotal || lineItemsSubtotal);
  const taxTotal = Number(breakdown.taxTotal || 0);
  const discountTotal = Number(breakdown.discountTotal || breakdown.discount || 0);
  const isTaxInclusive = order.isTaxInclusive !== undefined ? order.isTaxInclusive : (breakdown.isTaxInclusive !== false);
  const grandTotal = Number(
    breakdown.grandTotal || breakdown.total ||
    (isTaxInclusive ? Math.max(0, subtotal - discountTotal) : Math.max(0, subtotal + taxTotal - discountTotal)),
  );
  const amountPaid = order.posAmountPaid != null ? Number(order.posAmountPaid) : grandTotal;
  const isCredit = String(order.posPaymentMethod || '').toUpperCase() === 'CREDIT';
  const balanceDue = isCredit ? Math.max(0, grandTotal - amountPaid) : 0;
  const cashTendered = order.posCashTendered != null ? Number(order.posCashTendered) : null;
  const change = !isCredit && cashTendered != null && cashTendered > grandTotal ? cashTendered - grandTotal : 0;
  const discountRatio = subtotal > 0 ? (isTaxInclusive ? grandTotal / subtotal : (subtotal - discountTotal) / subtotal) : 1;
  const gst = new Map();
  lineItems.forEach((item) => {
    const rate = Number(item.gstPercent || 0);
    if (rate <= 0) return;
    const lineTotal = Number(item.price || 0) * Number(item.quantity || item.qty || 1);
    const prev = gst.get(rate) || { taxable: 0, tax: 0 };
    if (isTaxInclusive) {
      const value = lineTotal * discountRatio;
      const taxable = (value * 100) / (100 + rate);
      gst.set(rate, { taxable: prev.taxable + taxable, tax: prev.tax + (value - taxable) });
    } else {
      const taxable = lineTotal * discountRatio;
      gst.set(rate, { taxable: prev.taxable + taxable, tax: prev.tax + (taxable * rate) / 100 });
    }
  });
  if (gst.size === 0 && taxTotal > 0) {
    const taxable = isTaxInclusive ? Math.max(0, (subtotal - discountTotal) - taxTotal) : Math.max(0, subtotal - discountTotal);
    const rate = taxable > 0 ? Math.round(((taxTotal / taxable) * 100) * 10) / 10 : Number(breakdown.taxPercent || order.taxPercent || 0);
    gst.set(rate, { taxable, tax: taxTotal });
  }
  const mrpTotal = lineItems.reduce((s, i) => s + Math.max(Number(i.mrp) || 0, Number(i.price) || 0) * Number(i.quantity || i.qty || 1), 0);
  return {
    subtotal, taxTotal, discountTotal, grandTotal, amountPaid, balanceDue, change,
    gstRows: Array.from(gst.entries()).sort((a, b) => a[0] - b[0]),
    mrpSavings: Math.round((mrpTotal - grandTotal) * 100) / 100,
  };
}

const posBase = {
  orderId: 'POS-1',
  orderSource: 'POS',
  createdAt: '2026-10-20T10:00:00.000Z',
  items: [
    { name: 'Milk', quantity: 2, price: 50, mrp: 60, gstPercent: 5 },
    { name: 'Soap', quantity: 1, price: 118, mrp: 120, gstPercent: 18 },
  ],
};

const POS_CASES = {
  inclusiveWithDiscount: { ...posBase, posPaymentMethod: 'CASH', posCashTendered: 300, paymentBreakdown: { productSubtotal: 218, discountTotal: 18, grandTotal: 200, isTaxInclusive: true } },
  exclusiveBillLevelTax: { ...posBase, items: [{ name: 'Rice', quantity: 1, price: 100 }], isTaxInclusive: false, posPaymentMethod: 'CARD', paymentBreakdown: { productSubtotal: 100, taxTotal: 12, grandTotal: 112, isTaxInclusive: false } },
  creditPartial: { ...posBase, posPaymentMethod: 'CREDIT', posAmountPaid: 50, paymentBreakdown: { productSubtotal: 218, grandTotal: 218 } },
  split: { ...posBase, posPaymentMethod: 'SPLIT', posPayments: [{ method: 'CASH', amount: 100 }, { method: 'QR', amount: 118 }], paymentBreakdown: { productSubtotal: 218, grandTotal: 218 } },
  noTax: { ...posBase, items: [{ name: 'Pen', quantity: 3, price: 10 }], posPaymentMethod: 'CASH', paymentBreakdown: { productSubtotal: 30, grandTotal: 30 } },
  legacyPricingOnly: { ...posBase, posPaymentMethod: 'CASH', pricing: { subtotal: 218, total: 218 } },
};

describe('computeBillFigures — New Sale (POS) bills are unchanged', () => {
  it.each(Object.entries(POS_CASES))('%s matches the original receipt math', (_name, order) => {
    const f = computeBillFigures(order);
    const legacy = legacyPosFigures(order);
    expect(f.online).toBe(false);
    expect(f.charges).toEqual([]);
    for (const key of Object.keys(legacy)) {
      expect([key, f[key]]).toEqual([key, legacy[key]]);
    }
  });
});

const onlineOrder = (overrides = {}) => ({
  orderId: 'ORD-9',
  orderSource: 'APP',
  createdAt: '2026-10-21T09:30:00.000Z',
  status: 'delivered',
  paymentMode: 'ONLINE',
  paymentStatus: 'PAID',
  address: { name: 'Asha', phone: '9876500001', address: '12 MG Road', city: 'Indore' },
  items: [{ name: 'Milk', quantity: 2, price: 50, mrp: 60 }],
  paymentBreakdown: {
    productSubtotal: 100,
    deliveryFeeCharged: 30,
    handlingFeeCharged: 5,
    tipTotal: 0,
    taxTotal: 0,
    discountTotal: 10,
    grandTotal: 125,
    isTaxInclusive: true,
  },
  ...overrides,
});

describe('computeBillFigures — online orders', () => {
  it('adds the order charges and keeps tax at zero when none applies', () => {
    const f = computeBillFigures(onlineOrder());
    expect(f.online).toBe(true);
    expect(f.charges.map((c) => [c.label, c.value])).toEqual([['Delivery Fee', 30], ['Handling Fee', 5]]);
    expect(f.grandTotal).toBe(125);
    expect(f.merchandiseTotal).toBe(90);
    expect(f.gstRows).toEqual([]);
    expect(f.amountPaid).toBe(125);
    expect(f.balanceDue).toBe(0);
    expect(f.tenderLines).toEqual([{ method: 'ONLINE', label: 'Online', amount: 125 }]);
    // MRP savings are on goods only, never on fees.
    expect(f.mrpSavings).toBe(30);
  });

  it('splits wallet + COD and shows the cash as due until collected', () => {
    const f = computeBillFigures(onlineOrder({
      paymentMode: 'COD',
      paymentStatus: 'PENDING_CASH_COLLECTION',
      paymentBreakdown: { productSubtotal: 100, deliveryFeeCharged: 30, grandTotal: 90, walletAmount: 40, walletNettedInGrandTotal: true },
    }));
    expect(f.grandTotal).toBe(130);
    expect(f.tenderLines).toEqual([
      { method: 'WALLET', label: 'Wallet', amount: 40 },
      { method: 'COD', label: 'Cash', amount: 90 },
    ]);
    expect(f.amountPaid).toBe(40);
    expect(f.balanceDue).toBe(90);
  });

  it('treats online tax as added on top even with the stored default (inclusive) flags', () => {
    // As saved by checkout: tax = subtotal × rate, no isTaxInclusive set, so the
    // schema default `true` is present on the order.
    const order = onlineOrder({
      isTaxInclusive: true,
      paymentBreakdown: { productSubtotal: 100, deliveryFeeCharged: 30, taxTotal: 5, grandTotal: 135, isTaxInclusive: true },
    });
    const f = computeBillFigures(order);
    expect(f.isTaxInclusive).toBe(false);
    expect(f.gstRows).toEqual([[5, { taxable: 100, tax: 5 }]]);
    // Gross + tax + fees reconciles to the stored total.
    expect(f.subtotal + f.taxTotal + f.charges.reduce((s, c) => s + c.value, 0) - f.discountTotal).toBe(f.grandTotal);
  });

  it('never shows a cancelled order as owed', () => {
    const f = computeBillFigures(onlineOrder({
      status: 'cancelled',
      paymentMode: 'COD',
      paymentStatus: 'PENDING_CASH_COLLECTION',
    }));
    expect(f.balanceDue).toBe(0);
  });

  it('keeps the GST split on goods only (fees excluded) when tax applies', () => {
    const f = computeBillFigures(onlineOrder({
      paymentBreakdown: { productSubtotal: 100, deliveryFeeCharged: 30, taxTotal: 18, grandTotal: 148, isTaxInclusive: false },
      isTaxInclusive: false,
    }));
    expect(f.gstRows).toHaveLength(1);
    expect(f.gstRows[0][1].tax).toBe(18);
    expect(f.gstRows[0][1].taxable).toBe(100);
  });
});

describe('ReceiptPrint for an online order', () => {
  it('uses the New Sale layout, shows the charges and hides a zero tax row', () => {
    render(<ReceiptPrint order={onlineOrder()} shopName="Main Mart" seller={{ shopName: 'Main Mart' }} heading="Tax Invoice" onClose={() => {}} />);
    expect(screen.getByText('TAX INVOICE')).toBeInTheDocument();
    expect(screen.getByText('Gross Rate')).toBeInTheDocument();
    expect(screen.getByText('Delivery Fee')).toBeInTheDocument();
    expect(screen.getByText('Handling Fee')).toBeInTheDocument();
    expect(screen.getByText('Customer Name : Asha')).toBeInTheDocument();
    expect(screen.getByText('Address : 12 MG Road, Indore')).toBeInTheDocument();
    expect(screen.queryByText(/GST/)).toBeNull();
    expect(screen.queryByText('TAXABLE')).toBeNull();
    expect(screen.queryByText(/^Tax$/i)).toBeNull();
  });

  it('shows the GST row when the order carries tax', () => {
    // Stored flags as checkout leaves them (schema default inclusive).
    const order = onlineOrder({
      paymentBreakdown: { productSubtotal: 100, deliveryFeeCharged: 30, taxTotal: 18, grandTotal: 148, isTaxInclusive: true },
    });
    render(<ReceiptPrint order={order} shopName="Main Mart" seller={{}} heading="Tax Invoice" onClose={() => {}} />);
    expect(screen.getByText('GST (CGST + SGST)')).toBeInTheDocument();
    expect(screen.getByText('TAXABLE')).toBeInTheDocument();
  });
});
