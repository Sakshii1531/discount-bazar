import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

jest.mock('@modules/admin/services/adminApi', () => ({
  adminApi: { getProducts: jest.fn(), getProduct: jest.fn(() => Promise.resolve({ data: {} })) },
}));

import ExperienceBannerCarousel, {
  resolveBannerTarget,
} from '@modules/customer/components/experience/ExperienceBannerCarousel';
import BannerLinkPicker, { isBannerLinkComplete } from '@modules/admin/components/BannerLinkPicker';

describe('resolveBannerTarget', () => {
  it.each([
    [{ linkType: 'none', linkValue: 'x' }, null],
    [{ linkType: 'category', linkValue: '' }, null],
    [{ linkType: 'category', linkValue: 'c1' }, { path: '/category/c1' }],
    [{ linkType: 'subcategory', linkValue: 'c1/s1' }, { path: '/category/c1', state: { activeSubcategoryId: 's1' } }],
    [{ linkType: 'subcategory', linkValue: 'c1' }, { path: '/category/c1' }],
    [{ linkType: 'product', linkValue: 'p1' }, { path: '/product/p1' }],
    [{ linkType: 'header', linkValue: 'h1' }, { path: '/', state: { activeHeaderId: 'h1' } }],
    [{ linkType: 'url', linkValue: 'https://x.com' }, { external: 'https://x.com' }],
    [{ linkType: 'url', linkValue: 'javascript:alert(1)' }, null],
  ])('%j', (banner, expected) => {
    expect(resolveBannerTarget(banner)).toEqual(expected);
  });
});

describe('isBannerLinkComplete', () => {
  it('validates per link type', () => {
    expect(isBannerLinkComplete({ linkType: 'none' })).toBe(true);
    expect(isBannerLinkComplete({ linkType: 'category', linkValue: '' })).toBe(false);
    expect(isBannerLinkComplete({ linkType: 'category', linkValue: 'c1' })).toBe(true);
    expect(isBannerLinkComplete({ linkType: 'subcategory', linkValue: 's1' })).toBe(false);
    expect(isBannerLinkComplete({ linkType: 'subcategory', linkValue: 'c1/s1' })).toBe(true);
    expect(isBannerLinkComplete({ linkType: 'url', linkValue: 'example' })).toBe(false);
    expect(isBannerLinkComplete({ linkType: 'url', linkValue: 'https://example.com' })).toBe(true);
  });
});

const Where = () => {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}|{JSON.stringify(loc.state)}</div>;
};

describe('ExperienceBannerCarousel', () => {
  const renderAt = (items) =>
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<ExperienceBannerCarousel section={{ title: '' }} items={items} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );

  it('shows the title and subtitle on the banner', () => {
    renderAt([{ imageUrl: 'a.png', title: 'Mega Sale', subtitle: 'Up to 50% off' }]);
    expect(screen.getByText('Mega Sale')).toBeInTheDocument();
    expect(screen.getByText('Up to 50% off')).toBeInTheDocument();
  });

  it('opens the linked subcategory when tapped', () => {
    renderAt([{ imageUrl: 'a.png', title: 'Fruits', linkType: 'subcategory', linkValue: 'c1/s1' }]);
    fireEvent.click(screen.getByRole('link', { name: 'Fruits' }));
    expect(screen.getByTestId('where').textContent).toBe('/category/c1|{"activeSubcategoryId":"s1"}');
  });

  it('is not clickable without a link', () => {
    renderAt([{ imageUrl: 'a.png', title: 'Plain' }]);
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('BannerLinkPicker', () => {
  const tree = [
    { _id: 'h1', name: 'Grocery', children: [{ _id: 'c1', name: 'Fruits', children: [{ _id: 's1', name: 'Apples' }] }] },
  ];

  it('builds a subcategory link from two dropdowns', () => {
    const onChange = jest.fn();
    const { rerender } = render(<BannerLinkPicker tree={tree} linkType="subcategory" linkValue="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Parent category'), { target: { value: 'c1' } });
    rerender(<BannerLinkPicker tree={tree} linkType="subcategory" linkValue="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Subcategory'), { target: { value: 's1' } });
    expect(onChange).toHaveBeenLastCalledWith({ linkType: 'subcategory', linkValue: 'c1/s1' });
  });

  it('shows what the banner opens', () => {
    render(<BannerLinkPicker tree={tree} linkType="category" linkValue="c1" onChange={() => {}} />);
    expect(screen.getByText('✓ Opens: Fruits')).toBeInTheDocument();
  });
});
