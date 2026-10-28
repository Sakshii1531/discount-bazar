import React from 'react';
import { render, screen } from '@testing-library/react';
import { posVariantLabel } from '@/modules/seller/utils/variantLabel';
import ProductGrid from '@/modules/seller/components/pos/ProductGrid';

describe('posVariantLabel (POS card and cart size text)', () => {
  it('uses a real variant name', () => {
    const product = { name: 'Rice', variants: [{ name: '1 kg', sku: 'R1' }] };
    expect(posVariantLabel(product, product.variants[0])).toBe('1 kg');
  });

  it('skips placeholder names in favour of size / colour or product weight', () => {
    const tshirt = { name: 'Tee', variants: [{ name: 'Default', size: 'M', colour: 'Red', sku: 'T1' }] };
    expect(posVariantLabel(tshirt, tshirt.variants[0])).toBe('M · Red');
    const soap = { name: 'Soap', weight: '100 g', variants: [{ name: 'Soap', sku: 'S1' }] };
    expect(posVariantLabel(soap, soap.variants[0])).toBe('100 g');
    const plain = { name: 'Pen', weight: '10 g', variants: [] };
    expect(posVariantLabel(plain, null)).toBe('10 g');
  });

  it('keeps variants of one product distinguishable instead of repeating the product weight', () => {
    const oil = {
      name: 'Oil',
      weight: '1 L',
      variants: [{ name: '', sku: 'OIL-A' }, { name: '', sku: 'OIL-B' }],
    };
    expect(posVariantLabel(oil, oil.variants[0])).toBe('OIL-A');
    expect(posVariantLabel(oil, oil.variants[1])).toBe('OIL-B');
  });

  it('shows the same text on the product card', () => {
    const soap = { _id: 'p1', name: 'Soap', weight: '100 g', price: 40, stock: 5, variants: [{ name: 'Default', sku: 'S1', stock: 5 }] };
    render(<ProductGrid products={[soap]} isLoading={false} onAddProduct={() => {}} />);
    expect(screen.getByText(posVariantLabel(soap, soap.variants[0]))).toBeInTheDocument();
  });
});
