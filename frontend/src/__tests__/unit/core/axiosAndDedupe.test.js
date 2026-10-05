import axios from 'axios';
import { makeJwt } from '../../../../test-utils/jwt';

jest.mock('axios', () => {
  const instance = {
    get: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return { __esModule: true, default: { create: jest.fn(() => instance) }, __instance: instance };
});

import { STORAGE_KEYS } from '@core/utils/storage';
import { setActiveRole, __resetActiveRoleForTests } from '@core/auth/activeRoleStore';

let requestInterceptor;
let responseErrorInterceptor;
let instance;
let dedupe;

beforeAll(async () => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  await import('@core/api/axios');
  dedupe = await import('@core/api/dedupe');
  instance = axios.create();
  requestInterceptor = instance.interceptors.request.use.mock.calls[0][0];
  responseErrorInterceptor = instance.interceptors.response.use.mock.calls[0][1];
});

beforeEach(() => {
  __resetActiveRoleForTests();
  window.history.pushState({}, '', '/');
});

const run = (url, data) => requestInterceptor({ url, headers: {}, data });

describe('axios request interceptor: picks the right portal token', () => {
  const tokens = {
    customer: makeJwt({ role: 'customer' }),
    seller: makeJwt({ role: 'seller' }),
    admin: makeJwt({ role: 'admin' }),
    delivery: makeJwt({ role: 'delivery' }),
  };

  beforeEach(() => {
    localStorage.setItem(STORAGE_KEYS.AUTH_CUSTOMER, tokens.customer);
    localStorage.setItem(STORAGE_KEYS.AUTH_SELLER, tokens.seller);
    localStorage.setItem(STORAGE_KEYS.AUTH_ADMIN, tokens.admin);
    localStorage.setItem(STORAGE_KEYS.AUTH_DELIVERY, tokens.delivery);
  });

  it('uses the active role token', () => {
    setActiveRole('seller');
    expect(run('/orders/seller-orders').headers.Authorization).toBe(`Bearer ${tokens.seller}`);
  });

  it('uses the URL portal when browsing /admin', () => {
    window.history.pushState({}, '', '/admin/dashboard');
    expect(run('/products').headers.Authorization).toBe(`Bearer ${tokens.admin}`);
  });

  it('falls back to URL-prefixed tokens', () => {
    localStorage.removeItem(STORAGE_KEYS.AUTH_CUSTOMER);
    setActiveRole('customer');
    expect(run('/delivery/profile').headers.Authorization).toBe(`Bearer ${tokens.delivery}`);
  });

  it('falls back to the legacy token key', () => {
    localStorage.clear();
    const legacy = makeJwt({ role: 'customer' });
    localStorage.setItem(STORAGE_KEYS.AUTH_LEGACY, legacy);
    expect(run('/anything').headers.Authorization).toBe(`Bearer ${legacy}`);
  });

  it('sends no header when nobody is logged in', () => {
    localStorage.clear();
    expect(run('/categories').headers.Authorization).toBeUndefined();
  });

  it('never sends expired tokens', () => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.AUTH_CUSTOMER, makeJwt({}, { expiresInSec: -5 }));
    expect(run('/cart').headers.Authorization).toBeUndefined();
  });

  it('drops Content-Type for multipart uploads', () => {
    const headers = { 'Content-Type': 'application/json' };
    const cfg = requestInterceptor({ url: '/products', headers, data: new FormData() });
    expect(cfg.headers['Content-Type']).toBeUndefined();
  });
});

describe('axios response interceptor', () => {
  it('keeps tokens on 401 and rejects', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(STORAGE_KEYS.AUTH_CUSTOMER, makeJwt({}));
    const error = { config: { url: '/cart' }, response: { status: 401 } };
    await expect(responseErrorInterceptor(error)).rejects.toBe(error);
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_CUSTOMER)).not.toBeNull();
    warn.mockRestore();
  });

  it('dispatches app:offline only when the device is offline', async () => {
    const listener = jest.fn();
    window.addEventListener('app:offline', listener);
    await expect(responseErrorInterceptor({ config: {} })).rejects.toBeDefined();
    expect(listener).not.toHaveBeenCalled();
    const spy = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(responseErrorInterceptor({ config: {} })).rejects.toBeDefined();
    expect(listener).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    window.removeEventListener('app:offline', listener);
  });
});

describe('core/api/dedupe', () => {
  beforeEach(() => {
    dedupe.clearAllCache();
    instance.get.mockReset();
  });

  it('dedupes concurrent requests and caches the result', async () => {
    instance.get.mockResolvedValue({ data: 1 });
    const [a, b] = await Promise.all([dedupe.getWithDedupe('/x', { p: 1 }), dedupe.getWithDedupe('/x', { p: 1 })]);
    expect(a).toBe(b);
    await dedupe.getWithDedupe('/x', { p: 1 });
    expect(instance.get).toHaveBeenCalledTimes(1);
  });

  it('treats param order as the same key', async () => {
    instance.get.mockResolvedValue({ data: 1 });
    await dedupe.getWithDedupe('/y', { a: 1, b: 2 });
    await dedupe.getWithDedupe('/y', { b: 2, a: 1 });
    expect(instance.get).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh and invalidateCache bypass the cache', async () => {
    instance.get.mockResolvedValue({ data: 1 });
    await dedupe.getWithDedupe('/z');
    await dedupe.getWithDedupe('/z', {}, { forceRefresh: true });
    expect(instance.get).toHaveBeenCalledTimes(2);
    dedupe.invalidateCache('/z');
    await dedupe.getWithDedupe('/z');
    expect(instance.get).toHaveBeenCalledTimes(3);
    dedupe.invalidateCache(/^\/z/);
    await dedupe.getWithDedupe('/z');
    expect(instance.get).toHaveBeenCalledTimes(4);
  });

  it('expires after ttl', async () => {
    instance.get.mockResolvedValue({ data: 1 });
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    await dedupe.getWithDedupe('/t', {}, { ttl: 1000 });
    spy.mockReturnValue(now + 1500);
    await dedupe.getWithDedupe('/t', {}, { ttl: 1000 });
    expect(instance.get).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('does not cache failures', async () => {
    instance.get.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ data: 2 });
    await expect(dedupe.getWithDedupe('/f')).rejects.toThrow('down');
    await expect(dedupe.getWithDedupe('/f')).resolves.toEqual({ data: 2 });
  });
});
