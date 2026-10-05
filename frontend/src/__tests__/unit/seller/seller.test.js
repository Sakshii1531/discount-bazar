import { collectServiceCalls, lastCall } from '../../../../test-utils/serviceContract';

jest.mock('@core/api/axios', () => ({
  __esModule: true,
  default: require('../../../../test-utils/serviceContract').createAxiosMock(),
}));

import mockAxios from '@core/api/axios';
import { sellerApi } from '@modules/seller/services/sellerApi';
import { posApi } from '@modules/seller/services/posApi';
import { businessApi } from '@modules/seller/services/businessApi';
import { computePurchaseGst } from '@shared/utils/currency';

beforeEach(() => {
  ['get', 'post', 'put', 'patch', 'delete'].forEach((m) => mockAxios[m].mockClear());
});

describe.each([
  ['sellerApi', sellerApi],
  ['posApi', posApi],
  ['businessApi', businessApi],
])('seller: %s', (_name, service) => {
  it('every method issues a well-formed request', async () => {
    const calls = await collectServiceCalls(service, mockAxios);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.method).not.toBeNull();
      expect(call.url).toMatch(/^\//);
      expect(call.url).not.toMatch(/undefined|null|\[object/);
    }
  });
});

describe('seller: endpoint mapping', () => {
  it('auth & dashboard', async () => {
    await sellerApi.login({ email: 'a', password: 'b' });
    expect(lastCall(mockAxios)).toMatchObject({ method: 'post', url: '/seller/login' });
    await sellerApi.getStats('7d');
    expect(mockAxios.get).toHaveBeenLastCalledWith('/seller/stats', { params: { range: '7d' } });
  });

  it('products and stock', async () => {
    await sellerApi.getProducts({ page: 2 });
    expect(mockAxios.get).toHaveBeenLastCalledWith('/products/seller/me', { params: { page: 2 } });
    await sellerApi.updateProduct('p1', { price: 10 });
    expect(mockAxios.put).toHaveBeenLastCalledWith('/products/p1', { price: 10 });
    await sellerApi.deleteProduct('p1');
    expect(mockAxios.delete).toHaveBeenLastCalledWith('/products/p1');
    await sellerApi.adjustStock({ productId: 'p1', delta: 5 });
    expect(lastCall(mockAxios)).toMatchObject({ method: 'post', url: '/products/adjust-stock' });
  });

  it('orders and returns', async () => {
    await sellerApi.getOrderDetails('ORD/1');
    expect(mockAxios.get).toHaveBeenLastCalledWith('/orders/details/ORD%2F1');
    await sellerApi.approveReturn('o1', {});
    expect(lastCall(mockAxios)).toMatchObject({ method: 'put', url: '/orders/returns/o1/approve' });
  });

  it('POS sale sends an idempotency key', async () => {
    await posApi.createSale({ items: [] }, 'key-1');
    expect(mockAxios.post).toHaveBeenLastCalledWith(
      '/seller/pos/sale',
      { items: [] },
      { headers: { 'Idempotency-Key': 'key-1' } },
    );
    await posApi.editSale('POS#1', {});
    expect(lastCall(mockAxios).url).toBe('/seller/pos/sales/POS%231');
  });

  it('business suppliers create vs update', async () => {
    await businessApi.saveSupplier({ name: 'A' });
    expect(lastCall(mockAxios)).toMatchObject({ method: 'post', url: '/seller/business/suppliers' });
    await businessApi.saveSupplier({ name: 'A' }, 's1');
    expect(lastCall(mockAxios)).toMatchObject({ method: 'put', url: '/seller/business/suppliers/s1' });
    await businessApi.cashToday('2026-01-01');
    expect(mockAxios.get).toHaveBeenLastCalledWith('/seller/business/cash-register/today', {
      params: { date: '2026-01-01' },
    });
  });
});

describe('seller: purchase GST calculator (product form)', () => {
  it('matches the backend for exclusive and inclusive GST', () => {
    expect(computePurchaseGst('250', '12')).toEqual({ basePrice: 250, gstAmount: 30, finalPrice: 280 });
    expect(computePurchaseGst('280', '12', 'INCLUSIVE')).toEqual({ basePrice: 250, gstAmount: 30, finalPrice: 280 });
  });
});
