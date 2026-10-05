/**
 * @jest-environment-options {"url": "https://discountbazaar.co.in/"}
 */
import { resolveApiBaseUrl, resolveSocketBaseUrl } from '@core/api/resolveApiBaseUrl';

describe('resolveApiBaseUrl on the production domain', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    globalThis.__VITE_ENV__ = { MODE: 'production' };
  });

  it('uses same-origin /api when no env URL was baked into the build', () => {
    expect(resolveApiBaseUrl()).toBe('https://discountbazaar.co.in/api');
    expect(resolveSocketBaseUrl()).toBe('https://discountbazaar.co.in');
  });

  it('still honours an explicit VITE_API_URL', () => {
    globalThis.__VITE_ENV__ = { VITE_API_URL: 'https://api.discountbazaar.co.in/api' };
    expect(resolveApiBaseUrl()).toBe('https://api.discountbazaar.co.in/api');
  });
});
