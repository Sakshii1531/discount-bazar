/**
 * @jest-environment-options {"url": "http://192.168.1.20:5173/"}
 */
import { resolveApiBaseUrl } from '@core/api/resolveApiBaseUrl';

describe('resolveApiBaseUrl on a LAN dev host', () => {
  it('targets the backend on port 7000 of the same host', () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    globalThis.__VITE_ENV__ = { MODE: 'development' };
    expect(resolveApiBaseUrl()).toBe('http://192.168.1.20:7000/api');
  });
});
