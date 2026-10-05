import { renderHook } from '@testing-library/react';
import { collectServiceCalls, lastCall } from '../../../../test-utils/serviceContract';

jest.mock('@core/api/axios', () => ({
  __esModule: true,
  default: require('../../../../test-utils/serviceContract').createAxiosMock(),
}));

import mockAxios from '@core/api/axios';
import {
  shiftHex,
  mixHexWithWhite,
  buildSearchBarBackgroundColor,
  buildHeaderGradient,
  buildMiniCartColor,
  buildMiniCartGradient,
} from '@modules/customer/utils/headerTheme';
import { resolveOrderIdentifiers, useOrderIdentifiers } from '@modules/customer/hooks/useOrderIdentifiers';
import { customerApi } from '@modules/customer/services/customerApi';
import { clearAllCache } from '@core/api/dedupe';

beforeEach(() => {
  clearAllCache();
  Object.values(mockAxios).forEach((fn) => typeof fn?.mockClear === 'function' && fn.mockClear());
});

describe('customer: header theme colours', () => {
  it('shifts hex channels with clamping and short hex support', () => {
    expect(shiftHex('#000000', 16)).toBe('#101010');
    expect(shiftHex('#fff', 10)).toBe('#ffffff');
    expect(shiftHex('#808080', -300)).toBe('#000000');
    expect(shiftHex('var(--primary)', 10)).toBe('var(--primary)');
    expect(shiftHex('#12345', 10)).toBe('#12345');
  });

  it('mixes with white', () => {
    expect(mixHexWithWhite('#000000', 0)).toBe('#000000');
    expect(mixHexWithWhite('#000000', 1)).toBe('#ffffff');
    expect(mixHexWithWhite('#000', 0.5)).toBe('#808080');
    expect(mixHexWithWhite('red', 0.5)).toBe('#f8fafc');
  });

  it('builds gradients and pill colours', () => {
    expect(buildHeaderGradient('#336699')).toMatch(/^linear-gradient\(to bottom, #[0-9a-f]{6} 0%/);
    expect(buildMiniCartGradient('#336699')).toMatch(/^linear-gradient\(135deg/);
    expect(buildMiniCartColor('#336699')).toMatch(/^#[0-9a-f]{6}$/);
    expect(buildSearchBarBackgroundColor('#000000')).toBe('#b3b3b3');
    expect(buildSearchBarBackgroundColor()).toBe('#f8fafc');
  });
});

describe('customer: order identifiers', () => {
  it('prefers the canonical orderId for realtime rooms', () => {
    const order = { orderId: 'ORD-1', checkoutGroupId: 'GRP-1', _id: 'm1' };
    expect(resolveOrderIdentifiers(order, 'GRP-1')).toEqual({
      canonicalOrderId: 'ORD-1',
      lookupId: 'ORD-1',
      identifiers: ['GRP-1', 'ORD-1', 'm1'],
      extraRoomId: 'ORD-1',
    });
  });

  it('falls back to route param before order loads', () => {
    expect(resolveOrderIdentifiers(null, ' ORD-9 ')).toEqual({
      canonicalOrderId: 'ORD-9',
      lookupId: 'ORD-9',
      identifiers: ['ORD-9'],
      extraRoomId: '',
    });
    expect(resolveOrderIdentifiers(null, '').canonicalOrderId).toBeNull();
  });

  it('hook exposes a ref that tracks identifiers', () => {
    const { result, rerender } = renderHook(({ order }) => useOrderIdentifiers('GRP-1', order), {
      initialProps: { order: null },
    });
    expect(result.current.identifiersRef.current).toEqual(['GRP-1']);
    rerender({ order: { orderId: 'ORD-1' } });
    expect(result.current.identifiersRef.current).toEqual(['GRP-1', 'ORD-1']);
  });
});

describe('customer: API service', () => {
  it('every method issues a well-formed request', async () => {
    const calls = await collectServiceCalls(customerApi, mockAxios);
    expect(calls.length).toBeGreaterThan(20);
    for (const call of calls) {
      expect(call.url).toMatch(/^\//);
      expect(call.url).not.toMatch(/undefined|null|\[object/);
    }
  });

  it('hits the expected cart and auth endpoints', async () => {
    await customerApi.verifyOtp({ phone: '1', otp: '1234' });
    expect(lastCall(mockAxios)).toMatchObject({ method: 'post', url: '/customer/verify-otp' });

    await customerApi.addToCart({ productId: 'p', quantity: 1 });
    expect(lastCall(mockAxios)).toMatchObject({ method: 'post', url: '/cart/add' });

    mockAxios.delete.mockClear();
    await customerApi.removeFromCart('p1', ' 500g ');
    expect(mockAxios.delete).toHaveBeenCalledWith('/cart/remove/p1', { params: { variantSku: '500g' } });
    await customerApi.removeFromCart('p1');
    expect(mockAxios.delete).toHaveBeenLastCalledWith('/cart/remove/p1', { params: {} });
  });

  it('sends idempotency keys on order creation', async () => {
    await customerApi.createOrder({ a: 1 }, 'idem-1');
    expect(mockAxios.post).toHaveBeenLastCalledWith(
      '/orders',
      { a: 1 },
      expect.objectContaining({ headers: { 'Idempotency-Key': 'idem-1' } }),
    );
  });

  it('caches GETs and invalidates the cart cache after mutations', async () => {
    await customerApi.getCart();
    await customerApi.getCart();
    expect(mockAxios.get).toHaveBeenCalledTimes(1);
    await customerApi.addToCart({ productId: 'p', quantity: 1 });
    await customerApi.getCart();
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
  });

  it('invalidates profile cache on update', async () => {
    await customerApi.getProfile();
    await customerApi.updateProfile({ name: 'x' });
    await customerApi.getProfile();
    expect(mockAxios.get).toHaveBeenCalledTimes(2);
  });
});
