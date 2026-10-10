import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

jest.mock('@modules/customer/services/customerApi', () => ({
  customerApi: { getProductRecommendations: jest.fn() },
}));
jest.mock('@modules/customer/context/LocationContext', () => ({
  useLocation: () => ({ currentLocation: { latitude: 22.7, longitude: 75.8 } }),
}));
// The card has its own tests; here we only need to know what was rendered.
jest.mock('@modules/customer/components/shared/ProductCard', () => ({
  __esModule: true,
  default: ({ product }) => <div data-testid="card">{product.name}</div>,
}));

import { customerApi } from '@modules/customer/services/customerApi';
import ProductRecommendations from '@modules/customer/components/shared/ProductRecommendations';
import {
  getDisplayPricing,
  parsePackSize,
  getUnitPriceLabel,
  toCardProduct,
} from '@modules/customer/utils/productPricing';
import { brandPath } from '@modules/customer/utils/catalogLinks';

describe('getDisplayPricing', () => {
  it('uses the sale price only when it is set and lower than the list price', () => {
    expect(getDisplayPricing({ price: 200, salePrice: 150 })).toEqual({
      sellingPrice: 150, listPrice: 200, savings: 50, discountPercent: 25,
    });
    expect(getDisplayPricing({ price: 200, salePrice: 0 })).toEqual({
      sellingPrice: 200, listPrice: null, savings: 0, discountPercent: 0,
    });
    expect(getDisplayPricing({ price: 200, salePrice: 250 }).sellingPrice).toBe(200);
    expect(getDisplayPricing(null).sellingPrice).toBe(0);
  });

  it('shapes products for ProductCard like the existing listings do', () => {
    const card = toCardProduct({ _id: 'p1', price: 120, salePrice: 99, mainImage: 'img.jpg' });
    expect(card).toEqual(expect.objectContaining({ id: 'p1', price: 99, originalPrice: 120, image: 'img.jpg' }));
  });
});

describe('pack size and unit price', () => {
  it.each([
    ['1 L', { amount: 1000, base: 'ml' }],
    ['500g', { amount: 500, base: 'g' }],
    ['2 x 200 ml', { amount: 400, base: 'ml' }],
    ['1.5 kg', { amount: 1500, base: 'g' }],
    ['6 pcs', { amount: 6, base: 'pc' }],
  ])('reads %s', (label, expected) => {
    expect(parsePackSize(label)).toEqual(expected);
  });

  it.each(['', 'Family pack', '1 bottle', 'approx 1kg', null])('does not guess for %p', (label) => {
    expect(parsePackSize(label)).toBeNull();
  });

  it('formats a per-quantity price only when the pack size is known', () => {
    expect(getUnitPriceLabel(185, '1 L')).toBe('₹185.00/L');
    expect(getUnitPriceLabel(45, '200 g')).toBe('₹22.50/100 g');
    expect(getUnitPriceLabel(60, '6 pcs')).toBe('₹10.00/pc');
    expect(getUnitPriceLabel(60, '1 pc')).toBe('');
    expect(getUnitPriceLabel(60, 'Family pack')).toBe('');
    expect(getUnitPriceLabel(0, '1 L')).toBe('');
  });
});

const product = (name) => ({ _id: name, name, price: 100, salePrice: 90, mainImage: 'x.jpg' });

const CurrentPath = () => <div data-testid="path">{decodeURIComponent(useLocation().pathname)}</div>;
const renderRecommendations = () =>
  render(
    <MemoryRouter initialEntries={['/product/p0']}>
      <Routes>
        <Route path="*" element={<><ProductRecommendations productId="p0" /><CurrentPath /></>} />
      </Routes>
    </MemoryRouter>,
  );

describe('ProductRecommendations', () => {
  beforeEach(() => jest.clearAllMocks());

  it('labels sections by the data behind them', async () => {
    customerApi.getProductRecommendations.mockResolvedValue({
      data: {
        success: true,
        result: {
          similar: { items: [product('Dhara Mustard Oil')] },
          topInCategory: { basis: 'sales', scope: { name: 'Oil & Ghee' }, items: [product('Saffola Gold')] },
          brandsInCategory: { scope: { name: 'Mustard Oil' }, items: [{ name: 'Fortune', productCount: 3 }] },
          alsoBought: { source: 'co_purchase', items: [product('Aashirvaad Atta')] },
          errors: [],
        },
      },
    });
    renderRecommendations();

    expect(await screen.findByText('Similar products')).toBeInTheDocument();
    expect(screen.getByText('Top products in Oil & Ghee')).toBeInTheDocument();
    expect(screen.getByText('Brands in Mustard Oil')).toBeInTheDocument();
    expect(screen.getByText('People also bought')).toBeInTheDocument();
    expect(customerApi.getProductRecommendations).toHaveBeenCalledWith('p0', { lat: 22.7, lng: 75.8 });

    fireEvent.click(screen.getByRole('button', { name: /Fortune/ }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/brand/Fortune'));
    expect(brandPath('Tata Sampann')).toBe('/brand/Tata%20Sampann');
  });

  it('never presents fallback data as sales or co-purchase data, and hides empty sections', async () => {
    customerApi.getProductRecommendations.mockResolvedValue({
      data: {
        success: true,
        result: {
          similar: { items: [] },
          topInCategory: { basis: 'catalog', scope: { name: 'Oil & Ghee' }, items: [product('Saffola Gold')] },
          brandsInCategory: { scope: null, items: [] },
          alsoBought: { source: 'related_category', items: [product('Rajdhani Besan')] },
          errors: [],
        },
      },
    });
    renderRecommendations();

    expect(await screen.findByText('More in Oil & Ghee')).toBeInTheDocument();
    expect(screen.getByText('You might also like')).toBeInTheDocument();
    expect(screen.queryByText(/Top products/)).not.toBeInTheDocument();
    expect(screen.queryByText('People also bought')).not.toBeInTheDocument();
    expect(screen.queryByText('Similar products')).not.toBeInTheDocument();
    expect(screen.queryByText(/Brands in/)).not.toBeInTheDocument();
  });

  it('shows a retry instead of breaking the page when the request fails', async () => {
    customerApi.getProductRecommendations
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        data: { success: true, result: { similar: { items: [product('Dhara Mustard Oil')] } } },
      });
    renderRecommendations();

    fireEvent.click(await screen.findByRole('button', { name: /Retry/ }));
    expect(await screen.findByText('Dhara Mustard Oil')).toBeInTheDocument();
  });
});
