import { collectServiceCalls, lastCall } from '../../../../test-utils/serviceContract';

jest.mock('@core/api/axios', () => ({
  __esModule: true,
  default: require('../../../../test-utils/serviceContract').createAxiosMock(),
}));

import mockAxios from '@core/api/axios';
import { deliveryApi } from '@modules/delivery/services/deliveryApi';
import {
  loadHandledIncomingOrderIds,
  markIncomingOrderHandled,
  HANDLED_INCOMING_ORDER_IDS_KEY,
} from '@modules/delivery/utils/deliveryHandledOrders';
import {
  saveDeliveryPartnerLocation,
  getCachedDeliveryPartnerLocation,
  getCurrentPositionWithCache,
} from '@modules/delivery/utils/deliveryLastLocation';

beforeEach(() => {
  ['get', 'post', 'put', 'patch', 'delete'].forEach((m) => mockAxios[m].mockClear());
});

describe('delivery: API service', () => {
  it('every method issues a well-formed request', async () => {
    const calls = await collectServiceCalls(deliveryApi, mockAxios);
    expect(calls.length).toBeGreaterThan(30);
    for (const call of calls) {
      expect(call.method).not.toBeNull();
      expect(call.url).toMatch(/^\//);
      expect(call.url).not.toMatch(/undefined|\/null|\[object/);
    }
  });

  it('accepts orders with an idempotency key and encodes ids', async () => {
    await deliveryApi.acceptOrder('ORD 1', 'k1');
    expect(mockAxios.put).toHaveBeenLastCalledWith('/orders/accept/ORD%201', {}, { headers: { 'Idempotency-Key': 'k1' } });
    await deliveryApi.acceptOrder('ORD2');
    expect(mockAxios.put).toHaveBeenLastCalledWith('/orders/accept/ORD2', {}, { headers: {} });
  });

  it('maps the delivery OTP workflow', async () => {
    await deliveryApi.requestDeliveryOtp('o1', { lat: 1 });
    expect(lastCall(mockAxios)).toMatchObject({ method: 'post', url: '/orders/workflow/o1/otp/request' });
    await deliveryApi.verifyDeliveryOtp('o1', { otp: '1234' });
    expect(lastCall(mockAxios)).toMatchObject({ method: 'post', url: '/orders/workflow/o1/otp/verify' });
  });

  it('posts location updates', async () => {
    await deliveryApi.postLocation({ lat: 1, lng: 2 });
    expect(mockAxios.post).toHaveBeenLastCalledWith('/delivery/location', { lat: 1, lng: 2 }, {});
  });
});

describe('delivery: handled incoming orders', () => {
  it('records ids once and survives reloads', () => {
    markIncomingOrderHandled('A');
    markIncomingOrderHandled('B');
    markIncomingOrderHandled('A');
    expect(loadHandledIncomingOrderIds()).toEqual(['B', 'A']);
    markIncomingOrderHandled(null);
    expect(loadHandledIncomingOrderIds()).toHaveLength(2);
  });

  it('migrates legacy string arrays', () => {
    sessionStorage.setItem(HANDLED_INCOMING_ORDER_IDS_KEY, JSON.stringify(['X', 'Y']));
    expect(loadHandledIncomingOrderIds()).toEqual(['X', 'Y']);
  });

  it('expires ids after a shift (12h)', () => {
    const now = Date.now();
    sessionStorage.setItem(
      HANDLED_INCOMING_ORDER_IDS_KEY,
      JSON.stringify({ ids: [{ id: 'old', ts: now - 13 * 3600000 }, { id: 'new', ts: now }] }),
    );
    expect(loadHandledIncomingOrderIds()).toEqual(['new']);
  });

  it('caps the list at 200 entries', () => {
    for (let i = 0; i < 210; i += 1) markIncomingOrderHandled(`o${i}`);
    const ids = loadHandledIncomingOrderIds();
    expect(ids).toHaveLength(200);
    expect(ids[0]).toBe('o10');
  });
});

describe('delivery: last known location', () => {
  const originalGeo = navigator.geolocation;
  afterEach(() => {
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: originalGeo });
  });

  it('saves and reads valid coordinates only', () => {
    saveDeliveryPartnerLocation('22', 75);
    expect(getCachedDeliveryPartnerLocation()).toBeNull();
    saveDeliveryPartnerLocation(22.7, 75.8);
    expect(getCachedDeliveryPartnerLocation()).toEqual(expect.objectContaining({ lat: 22.7, lng: 75.8 }));
  });

  it('ignores stale cache', () => {
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    saveDeliveryPartnerLocation(22.7, 75.8);
    spy.mockReturnValue(now + 21 * 60 * 1000);
    expect(getCachedDeliveryPartnerLocation()).toBeNull();
    expect(getCachedDeliveryPartnerLocation(0)).not.toBeNull();
    spy.mockRestore();
  });

  it('uses live GPS and stores it', () => {
    Object.defineProperty(navigator, 'geolocation', {
      configurable: true,
      value: { getCurrentPosition: (ok) => ok({ coords: { latitude: 1, longitude: 2 } }) },
    });
    const onSuccess = jest.fn();
    getCurrentPositionWithCache(onSuccess);
    expect(onSuccess).toHaveBeenCalledWith({ lat: 1, lng: 2, fromCache: false });
    expect(getCachedDeliveryPartnerLocation()).toEqual(expect.objectContaining({ lat: 1, lng: 2 }));
  });

  it('falls back to loose GPS, then cache, then hard fail', () => {
    const getCurrentPosition = jest.fn((ok, fail) => fail(new Error('denied')));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition } });

    const onSuccess = jest.fn();
    const onHardFail = jest.fn();
    getCurrentPositionWithCache(onSuccess, onHardFail);
    expect(getCurrentPosition).toHaveBeenCalledTimes(2);
    expect(onHardFail).toHaveBeenCalled();

    saveDeliveryPartnerLocation(3, 4);
    getCurrentPositionWithCache(onSuccess, onHardFail);
    expect(onSuccess).toHaveBeenCalledWith({ lat: 3, lng: 4, fromCache: true });
  });
});
