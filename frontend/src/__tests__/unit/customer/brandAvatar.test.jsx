import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

jest.mock('@core/api/axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(() =>
      Promise.resolve({
        data: {
          results: [
            { _id: 'b1', name: 'Tata Sampann', slug: 'tata-sampann', logo: 'https://cdn.example.com/tata.png' },
            { _id: 'b2', name: 'Fortune', slug: 'fortune', logo: '' },
          ],
        },
      }),
    ),
  },
}));

import BrandAvatar from '@modules/customer/components/shared/BrandAvatar';

describe('BrandAvatar', () => {
  it('shows the admin-uploaded logo, matching the brand name loosely', async () => {
    render(<BrandAvatar name="  tata   SAMPANN " />);
    const img = await screen.findByRole('img', { name: /logo/i });
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/tata.png');
  });

  it('falls back to the initial when the brand has no logo', async () => {
    const { container } = render(<BrandAvatar name="Fortune" />);
    await screen.findByText('F');
    expect(container.querySelector('img')).toBeNull();
  });

  it('falls back to the initial when the logo fails to load', async () => {
    render(<BrandAvatar name="Tata Sampann" />);
    fireEvent.error(await screen.findByRole('img', { name: /logo/i }));
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  it('uses an explicit logo prop without a lookup', () => {
    render(<BrandAvatar name="Other" logo="https://cdn.example.com/other.png" />);
    expect(screen.getByRole('img', { name: /logo/i })).toHaveAttribute('src', 'https://cdn.example.com/other.png');
  });
});
