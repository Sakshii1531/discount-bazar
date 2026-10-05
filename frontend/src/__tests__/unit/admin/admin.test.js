import { collectServiceCalls, lastCall } from '../../../../test-utils/serviceContract';

jest.mock('@core/api/axios', () => ({
  __esModule: true,
  default: require('../../../../test-utils/serviceContract').createAxiosMock(),
}));

import mockAxios from '@core/api/axios';
import {
  adminApi,
  adminAuthApi,
  adminUsersApi,
  adminSettingsApi,
  adminFinanceApi,
  adminCatalogApi,
  adminOrdersApi,
  adminSupportApi,
  adminDeliveryApi,
  adminContentApi,
} from '@modules/admin/services/api';
import { adminApi as legacyAdminApi } from '@modules/admin/services/adminApi';
import { adminRouteMatchesOrder } from '@shared/utils/orderStatus';

beforeEach(() => {
  ['get', 'post', 'put', 'patch', 'delete'].forEach((m) => mockAxios[m].mockClear());
});

const slices = {
  adminAuthApi,
  adminUsersApi,
  adminSettingsApi,
  adminFinanceApi,
  adminCatalogApi,
  adminOrdersApi,
  adminSupportApi,
  adminDeliveryApi,
  adminContentApi,
};

describe.each(Object.entries(slices))('admin: %s', (_name, slice) => {
  it('every method issues a well-formed request', async () => {
    const calls = await collectServiceCalls(slice, mockAxios);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.method).not.toBeNull();
      expect(call.url).toMatch(/^\//);
      expect(call.url).not.toMatch(/undefined|\/null|\[object/);
    }
  });
});

describe('admin: aggregate API', () => {
  it('legacy shim re-exports the aggregate', () => {
    expect(legacyAdminApi).toBe(adminApi);
  });

  it('aggregate exposes every slice method', () => {
    for (const slice of Object.values(slices)) {
      for (const key of Object.keys(slice)) {
        expect(typeof adminApi[key]).toBe('function');
      }
    }
  });

  it('order and return endpoints', async () => {
    await adminOrdersApi.getOrders({ status: 'pending' });
    expect(mockAxios.get).toHaveBeenLastCalledWith('/orders/seller-orders', { params: { status: 'pending' } });
    await adminOrdersApi.updateReturnQc('o1', { qcStatus: 'passed' });
    expect(lastCall(mockAxios)).toMatchObject({ method: 'put', url: '/orders/returns/o1/qc' });
  });
});

describe('admin: order sidebar filters', () => {
  const orders = [
    { id: 1, status: 'pending' },
    { id: 2, status: 'confirmed' },
    { id: 3, status: 'packed' },
    { id: 4, status: 'out_for_delivery' },
    { id: 5, status: 'delivered' },
    { id: 6, status: 'cancelled' },
    { id: 7, status: 'delivered', returnStatus: 'return_requested' },
  ];
  const ids = (route) => orders.filter((o) => adminRouteMatchesOrder(route, o)).map((o) => o.id);

  it.each([
    ['all', [1, 2, 3, 4, 5, 6, 7]],
    ['pending', [1]],
    ['processed', [2, 3]],
    ['out-for-delivery', [4]],
    ['delivered', [5, 7]],
    ['cancelled', [6]],
    ['returned', [7]],
  ])('%s → %p', (route, expected) => {
    expect(ids(route)).toEqual(expected);
  });
});
