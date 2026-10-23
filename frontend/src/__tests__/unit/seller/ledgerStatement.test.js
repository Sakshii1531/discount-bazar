import { buildStatement, balanceLabel, statementHtml, statementFilename } from '@modules/seller/utils/ledgerStatement';
import { zipStore } from '@shared/utils/xlsxWriter';

const entries = [
  {
    _id: '1', date: '2026-10-01', kind: 'SALE', refModel: 'Order', refNo: 'POS-1', effect: 1, amount: 500, balance: 500,
    items: [
      { name: 'Milk', variant: '1L', quantity: 2, rate: 50, gstPercent: 5, amount: 100 },
      { name: 'Rice', quantity: 1, rate: 400, amount: 400 },
    ],
  },
  { _id: '2', date: '2026-10-05', kind: 'PAYMENT', method: 'UPI', effect: -1, amount: 150, balance: 350, items: [] },
];

describe('buildStatement', () => {
  const st = buildStatement({
    kind: 'customers',
    party: { name: 'Ravi <Kirana>', phone: '9876500001' },
    entries,
    balance: 350,
    business: { shopName: 'Main Mart', phone: '8000000000' },
  });

  it('keeps chronological rows with debit/credit split, items and running balance', () => {
    expect(st.title).toBe('Customer Ledger Statement');
    expect(st.rows.map((r) => [r.type, r.billNo, r.debit, r.credit, r.balance])).toEqual([
      ['Sale', 'POS-1', 500, null, 500],
      ['Payment', '', null, 150, 350],
    ]);
    expect(st.rows[0].details).toBe('Milk (1L) x2, Rice x1');
    expect(st.rows[0].shortDetails).toBe('2 items');
    expect(st.rows[1].items).toEqual([]);
    expect(st.totalDebit).toBe(500);
    expect(st.totalCredit).toBe(150);
    expect(st.closingBalance).toBe(350);
    expect(st.closingLabel).toBe('Receivable from customer');
  });

  it('escapes party data in the printable statement', () => {
    const html = statementHtml(st);
    expect(html).toContain('Ravi &lt;Kirana&gt;');
    expect(html).not.toContain('<Kirana>');
    expect(html).toContain('Closing balance: ₹350.00');
  });

  it('builds a safe file name', () => {
    expect(statementFilename(st, 'pdf')).toMatch(/^Customer_Ledger_Statement_Ravi_Kirana_\d{4}-\d{2}-\d{2}\.pdf$/);
  });
});

describe('balanceLabel', () => {
  it.each([
    ['suppliers', 100, 'Payable to supplier'],
    ['suppliers', -20, 'Advance with supplier'],
    ['customers', -5, 'Advance from customer'],
    ['customers', 0, 'Settled'],
  ])('%s %p', (kind, bal, label) => expect(balanceLabel(kind, bal)).toBe(label));
});

describe('xlsx zip container', () => {
  it('writes valid ZIP local headers and end-of-central-directory', async () => {
    const data = new TextEncoder().encode('hello');
    const blob = zipStore([{ name: 'a.txt', data }]);
    const buf = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsArrayBuffer(blob);
    });
    const bytes = new Uint8Array(buf);
    // PK\x03\x04 at the start, PK\x05\x06 in the last 22 bytes.
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([...bytes.slice(-22, -18)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
    // CRC32("hello") = 0x3610a686, stored little-endian at offset 14.
    expect([...bytes.slice(14, 18)]).toEqual([0x86, 0xa6, 0x10, 0x36]);
  });
});

describe('downloadStatementPdf', () => {
  it('renders the bordered ledger statement', async () => {
    const { jsPDF } = await import('jspdf');
    const { downloadStatementPdf } = await import('@modules/seller/utils/ledgerStatement');
    const names = [
      ['NIVEA Body Lotion Shea Smooth', 'Shea Smooth', 6, 81.41], ['NIVEA Body Lotion Body Milk', 'Body Milk', 6, 60.17],
      ['NIVEA Natural Glow Smooth Skin 72h deodrant', '50ml', 3, 165.26], ['NIVEA Natural Glow Smooth Skin 72h deodrant', '25ml', 3, 82.96],
      ['NIVEA Pearl & Beauty Radiance 72h deodrant', '50ml', 3, 165.26], ['NIVEA Pearl & Beauty Radiance 72h deodrant', '25ml', 3, 82.96],
      ['NIVEA Soft Moisturizing Cream', '50ml', 4, 109.02], ['NIVEA Soft hydration + serum infused gel', '100ml', 4, 225.84],
    ];
    const items = names.map(([name, variant, quantity, rate]) => ({ name, variant, quantity, rate, gstPercent: 18, amount: Math.round(quantity * rate * 100) / 100 }));
    const st = buildStatement({
      kind: 'suppliers',
      party: { name: 'AL HAYAT ENTERPRISES', phone: '7006412475' },
      entries: [{ _id: 'b1', date: '2026-10-18', kind: 'PURCHASE', refNo: '10590', effect: 1, amount: 3678.24, balance: 3678.24, items }],
      balance: 3678.24,
      business: { shopName: 'Discount Bazaar', address: 'Tral', pincode: '192123', phone: '7051894355' },
    });
    let saved = null;
    const original = jsPDF.API.save;
    jsPDF.API.save = function save(name) { saved = { name, doc: this }; };
    try {
      await downloadStatementPdf(st);
      expect(saved.name).toMatch(/^Supplier_Ledger_Statement_AL_HAYAT_ENTERPRISES_.*\.pdf$/);
      if (process.env.STATEMENT_PDF_OUT) {
        // eslint-disable-next-line no-undef
        require('fs').writeFileSync(process.env.STATEMENT_PDF_OUT, Buffer.from(saved.doc.output('arraybuffer')));
      }
    } finally {
      jsPDF.API.save = original;
    }
  });
});
