import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('@core/context/SettingsContext', () => ({
  useSettings: () => ({
    settings: { deliveryPricingMode: 'fixed_price', fixedDeliveryFee: 10, globalDeliveryTimeMinutes: 15, zeroDeliveryTimeMessage: 'Same Day Delivery' },
  }),
}));

import { parseCsv, csvToObjects, toCsv } from '@modules/seller/utils/csv';
import { formatDeliveryFeeLabel } from '@modules/customer/utils/deliveryLabels';
import ProductDeliverySettings from '@modules/seller/components/product/ProductDeliverySettings';

describe('CSV parsing for bulk upload', () => {
  it('handles quotes, commas, escaped quotes, CRLF and a BOM', () => {
    const text = '﻿name,description,price\r\n"Tea, 250g","He said ""strong""",100\r\nMilk,"line1\nline2",55\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'description', 'price'],
      ['Tea, 250g', 'He said "strong"', '100'],
      ['Milk', 'line1\nline2', '55'],
    ]);
  });

  it('maps rows to objects by header and trims cells', () => {
    expect(csvToObjects('name, price \n Tea , 10\nMilk,')).toEqual([
      { name: 'Tea', price: '10' },
      { name: 'Milk', price: '' },
    ]);
  });

  it('round-trips values that need quoting', () => {
    const rows = [['a,b', 'say "hi"', 'plain']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('formatDeliveryFeeLabel', () => {
  it.each([
    [30, '₹30 delivery'],
    [12.5, '₹12.50 delivery'],
    [0, 'Free delivery'],
    [undefined, ''],
    ['abc', ''],
  ])('%p -> %p', (fee, label) => expect(formatDeliveryFeeLabel(fee)).toBe(label));
});

describe('ProductDeliverySettings (seller form)', () => {
  const setup = (props = {}) => {
    const onChange = jest.fn();
    render(<ProductDeliverySettings fee="" minutes="" onChange={onChange} {...props} />);
    return onChange;
  };

  it('previews what customers will see (global + product)', () => {
    setup({ fee: '20', minutes: '20' });
    expect(screen.getByText(/Customers will see: ₹30 delivery · 35 mins/)).toBeInTheDocument();
  });

  it('shows the platform values when the product adds nothing', () => {
    setup({ fee: '', minutes: '' });
    expect(screen.getByText(/₹10 delivery · 15 mins/)).toBeInTheDocument();
  });

  it('hides preview line when showPreview is false', () => {
    setup({ showPreview: false });
    expect(screen.queryByText(/Customers will see:/)).not.toBeInTheDocument();
  });

  it('blocks negative signs and fractional minutes while typing', () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText('Product delivery fee'), { target: { value: '-12.345' } });
    expect(onChange).toHaveBeenLastCalledWith({ productDeliveryFee: '12.34' });
    fireEvent.change(screen.getByLabelText('Product delivery time'), { target: { value: '-7.5' } });
    expect(onChange).toHaveBeenLastCalledWith({ productDeliveryTimeMinutes: '7' });
  });
});
