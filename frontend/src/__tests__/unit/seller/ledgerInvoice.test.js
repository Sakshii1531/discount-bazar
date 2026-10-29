import { jsPDF } from 'jspdf';
import {
  buildLedgerInvoice,
  buildPurchaseBillInvoice,
  amountInWords,
  invoiceHtml,
  invoiceFilename,
  downloadInvoicePdf,
  hasInvoice,
} from '@modules/seller/utils/ledgerInvoice';

const business = {
  shopName: 'Discount Bazaar', address: 'Main Road', city: 'Tral', state: 'Jammu And Kashmir', pincode: '192123',
  phone: '9697036736', bankDetails: { bankName: 'J&K Bank', accountNumber: '0123456789', ifsc: 'JAKA0TRAL01', upiId: 'shop@upi' },
};

const sale = {
  _id: 's1', date: '2026-10-22', kind: 'SALE', refModel: 'Order', refId: 'o1', refNo: 'ORD-ABC123', method: '', effect: 1, amount: 210,
  bill: { subtotal: 220, discount: 10, tax: 10.48, total: 210, taxInclusive: true },
  items: [
    { name: 'Exo Ginger Bar', quantity: 2, rate: 10, gstPercent: 18, amount: 20, taxInclusive: true },
    { name: 'Basmati Rice', variant: '1kg', quantity: 1, rate: 200, gstPercent: 5, amount: 200, taxInclusive: true },
  ],
};
const payment = { _id: 'p1', kind: 'PAYMENT', refModel: 'Order', refId: 'o1', effect: -1, amount: 60, items: [] };

describe('buildLedgerInvoice (customer sale)', () => {
  const inv = buildLedgerInvoice({
    kind: 'customers', entry: sale, entries: [sale, payment], party: { name: 'Sakshi', phone: '9876500011' }, business,
  });

  it('is a tax invoice billed by the shop to the customer', () => {
    expect(inv.title).toBe('Tax Invoice');
    expect(inv.billedBy.name).toBe('Discount Bazaar');
    expect(inv.billedBy.address).toBe('Main Road, Tral, Jammu And Kashmir, PIN 192123');
    expect(inv.billedTo).toEqual(expect.objectContaining({ name: 'Sakshi', phone: '9876500011' }));
    expect(inv.showBank).toBe(true);
  });

  it('splits inclusive prices into taxable value + CGST/SGST per line and per rate', () => {
    expect(inv.items[0]).toEqual(expect.objectContaining({ taxable: 16.95, cgst: 1.53, sgst: 1.52, total: 20 }));
    expect(inv.items[1]).toEqual(expect.objectContaining({ taxable: 190.48, cgst: 4.76, sgst: 4.76, total: 200 }));
    expect(inv.gstRows.map((r) => [r.rate, r.taxable, r.tax])).toEqual([[5, 190.48, 9.52], [18, 16.95, 3.05]]);
  });

  it('reconciles to the posted bill: discount, round-off, paid and balance due', () => {
    const value = (label) => inv.totals.find((t) => t.label === label)?.value;
    expect(value('Less: Discount')).toBe(-10);
    expect(value('Round off')).toBeUndefined();
    expect(inv.grandTotal).toBe(210);
    expect(inv.payment).toEqual([{ label: 'Paid', value: 60 }, { label: 'Balance due', value: 150 }]);
    expect(inv.amountInWords).toBe('Rupees Two Hundred Ten Only');
  });

  it('prints as a standalone invoice document', () => {
    const html = invoiceHtml(inv);
    expect(html).toContain('Tax Invoice');
    expect(html).toContain('Amount in words');
    expect(html).toContain('Authorised Signatory');
    expect(invoiceFilename(inv, 'pdf')).toBe('Tax_Invoice_ORD-ABC123_Sakshi.pdf');
  });

  it('lists every item with its posted amount and reconciles via discount', () => {
    expect(inv.simple).toBe(true);
    expect(inv.items.map((i) => [i.name, i.quantity, i.rate, i.amount])).toEqual([['Exo Ginger Bar', 2, 10, 20], ['Basmati Rice', 1, 200, 200]]);
    expect(inv.simpleTotals).toEqual([{ label: 'Less: Discount', value: -10 }]);
    const html = invoiceHtml(inv);
    expect(html).toContain('Bill total (2 items)');
    expect(html).not.toContain('GST summary');
    expect(html).not.toContain('Balance due');
  });
});

describe('supplier invoices', () => {
  it('a purchase bill is billed by the supplier to the shop', () => {
    const inv = buildPurchaseBillInvoice(
      {
        billNo: 'INV-9', billDate: '2026-10-20', total: 315, gstTotal: 15, subtotal: 300, amountPaid: 100,
        supplier: { name: 'Big Distributor', gstin: '01ABCDE1234F1Z5' },
        items: [{ name: 'Tea', quantity: 10, cost: 30, gstPercent: 5, purchaseGstType: 'EXCLUSIVE', lineTotal: 315 }],
      },
      business,
    );
    expect(inv.billedBy).toEqual(expect.objectContaining({ name: 'Big Distributor', gstin: '01ABCDE1234F1Z5' }));
    expect(inv.billedTo.name).toBe('Discount Bazaar');
    expect(inv.items[0]).toEqual(expect.objectContaining({ taxable: 300, cgst: 7.5, sgst: 7.5, total: 315 }));
    expect(inv.payment[1].value).toBe(215);
  });

  it('payments have no invoice', () => {
    expect(hasInvoice(payment)).toBe(false);
    expect(hasInvoice(sale)).toBe(true);
  });
});

describe('amountInWords', () => {
  it('uses Indian numbering with paise', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only');
    expect(amountInWords(1234567.5)).toBe('Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Fifty Paise Only');
    expect(amountInWords(10000000)).toBe('Rupees One Crore Only');
  });
});

describe('downloadInvoicePdf', () => {
  it('renders a PDF without errors', async () => {
    let saved = null;
    const original = jsPDF.API.save;
    jsPDF.API.save = function save(name) {
      saved = { name, bytes: this.output('arraybuffer').byteLength, doc: this };
    };
    try {
      const inv = buildLedgerInvoice({ kind: 'customers', entry: sale, entries: [sale, payment], party: { name: 'Sakshi' }, business });
      await downloadInvoicePdf(inv);
      expect(saved.name).toBe('Tax_Invoice_ORD-ABC123_Sakshi.pdf');
      expect(saved.bytes).toBeGreaterThan(1000);
      if (process.env.INVOICE_PDF_OUT) {
        // eslint-disable-next-line no-undef
        require('fs').writeFileSync(process.env.INVOICE_PDF_OUT, Buffer.from(saved.doc.output('arraybuffer')));
      }
    } finally {
      jsPDF.API.save = original;
    }
  });
});

describe('voided ledger rows', () => {
  it('do not count a voided payment (and its reversal) as paid against the bill', () => {
    const voided = { ...payment, _id: 'p0', amount: 100, voided: true };
    const reversal = { ...voided, _id: 'p0r', effect: 1, reverses: 'p0' };
    const inv = buildLedgerInvoice({
      kind: 'customers', entry: sale, entries: [sale, voided, reversal, payment], party: { name: 'Sakshi' }, business,
    });
    const plain = buildLedgerInvoice({
      kind: 'customers', entry: sale, entries: [sale, payment], party: { name: 'Sakshi' }, business,
    });
    expect(inv).toEqual(plain);
  });
});
