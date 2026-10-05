import { decodeToken, isTokenExpired, getRoleFromToken } from '@core/utils/token';
import {
  normalizeStoredToken,
  getStoredAuthToken,
  hasValidStoredAuthToken,
} from '@core/utils/authStorage';
import {
  rawGet,
  rawSet,
  rawRemove,
  safeParseJson,
  getJSON,
  setJSON,
  clearByPrefix,
  clearKeys,
  evictExpiredEntries,
  ensureStorageSchema,
  clearOnLogout,
  clearAllAppStorage,
  STORAGE_KEYS,
  KEY_PREFIXES,
  STORAGE_SCHEMA_VERSION,
} from '@core/utils/storage';
import { ALL_KNOWN_KEYS } from '@core/utils/storageKeys';
import {
  ROLES,
  getActiveRole,
  setActiveRole,
  subscribeActiveRole,
  __resetActiveRoleForTests,
} from '@core/auth/activeRoleStore';
import { makeJwt } from '../../../../test-utils/jwt';

describe('core/utils/token', () => {
  it('decodes valid tokens and returns null for garbage', () => {
    const token = makeJwt({ id: 'u1', role: 'seller' });
    expect(decodeToken(token)).toEqual(expect.objectContaining({ id: 'u1', role: 'seller' }));
    expect(decodeToken('not-a-jwt')).toBeNull();
  });

  it('detects expiry', () => {
    expect(isTokenExpired(makeJwt({}, { expiresInSec: 60 }))).toBe(false);
    expect(isTokenExpired(makeJwt({}, { expiresInSec: -60 }))).toBe(true);
    expect(isTokenExpired(makeJwt({}, { expiresInSec: null }))).toBe(false);
    expect(isTokenExpired('garbage')).toBe(true);
  });

  it('reads role from token', () => {
    expect(getRoleFromToken(makeJwt({ role: 'admin' }))).toBe('admin');
    expect(getRoleFromToken('bad')).toBeNull();
  });
});

describe('core/utils/authStorage', () => {
  const token = makeJwt({ role: 'customer' });

  it.each([
    [token, token],
    [`Bearer ${token}`, token],
    [`"${token}"`, token],
    [JSON.stringify({ token }), token],
    [JSON.stringify({ result: { token } }), token],
    ['undefined', null],
    ['null', null],
    ['   ', null],
    [null, null],
  ])('normalizes %p', (raw, expected) => {
    expect(normalizeStoredToken(raw)).toBe(expected);
  });

  it('returns valid stored tokens', () => {
    localStorage.setItem(STORAGE_KEYS.AUTH_CUSTOMER, token);
    expect(getStoredAuthToken(STORAGE_KEYS.AUTH_CUSTOMER)).toBe(token);
    expect(hasValidStoredAuthToken(STORAGE_KEYS.AUTH_CUSTOMER)).toBe(true);
  });

  it('evicts expired tokens unless allowExpired', () => {
    const expired = makeJwt({}, { expiresInSec: -10 });
    localStorage.setItem(STORAGE_KEYS.AUTH_SELLER, expired);
    expect(getStoredAuthToken(STORAGE_KEYS.AUTH_SELLER, { allowExpired: true })).toBe(expired);
    expect(getStoredAuthToken(STORAGE_KEYS.AUTH_SELLER)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.AUTH_SELLER)).toBeNull();
  });
});

describe('core/utils/storage', () => {
  it('raw helpers read/write/remove', () => {
    expect(rawSet('k', 'v')).toBe(true);
    expect(rawGet('k')).toBe('v');
    expect(rawRemove('k')).toBe(true);
    expect(rawGet('k')).toBeNull();
    expect(rawGet('')).toBeNull();
    expect(rawSet('s', '1', { storage: 'session' })).toBe(true);
    expect(sessionStorage.getItem('s')).toBe('1');
  });

  it('safeParseJson handles bad input', () => {
    expect(safeParseJson('{"a":1}')).toEqual({ a: 1 });
    expect(safeParseJson('{bad', 'fb')).toBe('fb');
    expect(safeParseJson('undefined', 0)).toBe(0);
    expect(safeParseJson(null, [])).toEqual([]);
  });

  it('getJSON/setJSON round trip', () => {
    setJSON('obj', { a: 1 });
    expect(getJSON('obj')).toEqual({ a: 1 });
    expect(getJSON('missing', 'fb')).toBe('fb');
  });

  it('getJSON drops corrupted values and returns the fallback', () => {
    localStorage.setItem('broken', '{oops');
    expect(getJSON('broken', 'fallback')).toBe('fallback');
    expect(localStorage.getItem('broken')).toBeNull();
  });

  it('honours TTL envelopes', () => {
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    setJSON('ttl', 'value', { ttlMs: 1000 });
    expect(getJSON('ttl')).toBe('value');
    spy.mockReturnValue(now + 2000);
    expect(getJSON('ttl', 'expired')).toBe('expired');
    expect(localStorage.getItem('ttl')).toBeNull();
    spy.mockRestore();
  });

  it('evictExpiredEntries removes only expired envelopes', () => {
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    setJSON('old', 1, { ttlMs: 10 });
    setJSON('fresh', 2, { ttlMs: 100000 });
    setJSON('plain', 3);
    spy.mockReturnValue(now + 50);
    expect(evictExpiredEntries('local')).toBe(1);
    expect(localStorage.getItem('old')).toBeNull();
    expect(getJSON('fresh')).toBe(2);
    expect(getJSON('plain')).toBe(3);
    spy.mockRestore();
  });

  it('clearByPrefix and clearKeys', () => {
    rawSet('push:fcm-token:customer', 'a');
    rawSet('push:fcm-token:seller', 'b');
    rawSet('keep', 'c');
    expect(clearByPrefix('push:fcm-token:')).toBe(2);
    expect(rawGet('keep')).toBe('c');
    expect(clearByPrefix('')).toBe(0);
    rawSet('x', '1');
    rawSet('y', '1');
    expect(clearKeys(['x', 'y'])).toBe(2);
  });

  it('ensureStorageSchema wipes known keys once per version', () => {
    rawSet(STORAGE_KEYS.CART, '[1]');
    rawSet('third-party', 'keep');
    ensureStorageSchema();
    expect(rawGet(STORAGE_KEYS.CART)).toBeNull();
    expect(rawGet('third-party')).toBe('keep');
    rawSet(STORAGE_KEYS.CART, '[2]');
    ensureStorageSchema();
    expect(rawGet(STORAGE_KEYS.CART)).toBe('[2]');
    expect(rawGet('turbocart:storage_schema_version')).toBe(String(STORAGE_SCHEMA_VERSION));
  });

  it('clearOnLogout removes sensitive data but keeps other roles', () => {
    rawSet(STORAGE_KEYS.AUTH_SELLER, 'seller-token');
    rawSet(`${KEY_PREFIXES.PUSH_FCM_TOKEN}customer`, 'fcm');
    rawSet(`${KEY_PREFIXES.SUPPORT_UNREAD}customer:u1`, '3');
    rawSet(STORAGE_KEYS.RECIPIENT_ADDRESS, 'addr');
    rawSet(STORAGE_KEYS.RECENT_SEARCHES, '[]');
    rawSet(STORAGE_KEYS.CART, '[]');
    rawSet(STORAGE_KEYS.LOCATION, '{}');

    clearOnLogout({ role: 'customer', userId: 'u1' });

    expect(rawGet(STORAGE_KEYS.AUTH_SELLER)).toBe('seller-token');
    expect(rawGet(`${KEY_PREFIXES.PUSH_FCM_TOKEN}customer`)).toBeNull();
    expect(rawGet(`${KEY_PREFIXES.SUPPORT_UNREAD}customer:u1`)).toBeNull();
    expect(rawGet(STORAGE_KEYS.RECIPIENT_ADDRESS)).toBeNull();
    expect(rawGet(STORAGE_KEYS.CART)).toBeNull();
    expect(rawGet(STORAGE_KEYS.LOCATION)).toBe('{}');
  });

  it('clearOnLogout for delivery wipes rider GPS', () => {
    rawSet(STORAGE_KEYS.DELIVERY_LAST_LOCATION, '{}');
    clearOnLogout({ role: 'delivery' });
    expect(rawGet(STORAGE_KEYS.DELIVERY_LAST_LOCATION)).toBeNull();
  });

  it('clearAllAppStorage removes every known key', () => {
    ALL_KNOWN_KEYS.forEach((k) => rawSet(k, 'x'));
    clearAllAppStorage();
    ALL_KNOWN_KEYS.forEach((k) => expect(rawGet(k)).toBeNull());
  });
});

describe('core/auth/activeRoleStore', () => {
  beforeEach(() => {
    __resetActiveRoleForTests();
    window.history.pushState({}, '', '/');
  });

  it('defaults to customer and infers portal from URL', () => {
    expect(getActiveRole()).toBe(ROLES.CUSTOMER);
    window.history.pushState({}, '', '/admin/dashboard');
    expect(getActiveRole()).toBe(ROLES.ADMIN);
    window.history.pushState({}, '', '/seller');
    expect(getActiveRole()).toBe(ROLES.SELLER);
    window.history.pushState({}, '', '/delivery/orders');
    expect(getActiveRole()).toBe(ROLES.DELIVERY);
  });

  it('URL portal wins over the stored role', () => {
    setActiveRole(ROLES.SELLER);
    expect(getActiveRole()).toBe(ROLES.SELLER);
    window.history.pushState({}, '', '/admin');
    expect(getActiveRole()).toBe(ROLES.ADMIN);
  });

  it('notifies subscribers once per change and survives throwing listeners', () => {
    const listener = jest.fn();
    subscribeActiveRole(() => {
      throw new Error('boom');
    });
    const unsubscribe = subscribeActiveRole(listener);
    setActiveRole(ROLES.ADMIN);
    setActiveRole(ROLES.ADMIN);
    setActiveRole(null);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setActiveRole(ROLES.SELLER);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
