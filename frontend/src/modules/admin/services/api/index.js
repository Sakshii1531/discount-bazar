/**
 * Aggregate barrel that reassembles the original `adminApi` shape from the
 * per-domain slices introduced in refactor P4.5.
 *
 * Consumers who only need one slice (e.g. orders) should prefer importing
 * directly:
 *
 *   import { adminOrdersApi } from '../services/api/ordersApi';
 *
 * Consumers who relied on the original `import { adminApi } from
 * '../services/adminApi'` continue to work unchanged — the legacy entry-point
 * at `../adminApi.js` re-exports the aggregate from here.
 */

import { adminAuthApi } from './authApi';
import { adminUsersApi } from './usersApi';
import { adminSettingsApi } from './settingsApi';
import { adminFinanceApi } from './financeApi';
import { adminCatalogApi } from './catalogApi';
import { adminOrdersApi } from './ordersApi';
import { adminSupportApi } from './supportApi';
import { adminDeliveryApi } from './deliveryApi';
import { adminContentApi } from './contentApi';

export {
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

/**
 * Aggregate `adminApi` matching the original flat-object shape. Preserves
 * every existing call-site like `adminApi.getOrders(...)`.
 */
export const adminApi = {
    ...adminAuthApi,
    ...adminUsersApi,
    ...adminSettingsApi,
    ...adminFinanceApi,
    ...adminCatalogApi,
    ...adminOrdersApi,
    ...adminSupportApi,
    ...adminDeliveryApi,
    ...adminContentApi,
};

export default adminApi;
